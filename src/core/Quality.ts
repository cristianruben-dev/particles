/**
 * Perfiles de calidad, detección del equipo y ajuste automático. Ver docs/ARQUITECTURA.md §12.
 *
 * - Lo que cuesta de verdad es el relleno de píxeles: la densidad de píxeles (×4 de coste de
 *   1 a 2) y la separación entre partículas (su número va con 1/separación²).
 * - En caliente: densidad de píxeles, separación, resolución del bloom y desenfoque de los
 *   paneles. El pool de la superficie se lee al crear cada superficie (en el siguiente
 *   descenso). El MSAA solo al recargar: el pase de escena lo fija al compilarse.
 * - En «auto» se parte de lo detectado y solo se baja (nunca se sube) si el tiempo de frame
 *   es malo de forma sostenida, y solo con la página visible: con el panel oculto o con
 *   frames avanzados a mano el medidor no mide nada real.
 */

export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';
export type QualityChoice = QualityLevel | 'auto';

export interface QualityProfile {
  level: QualityLevel;
  name: string;
  /** Qué cambia, para la UI. */
  summary: string;
  /** Densidad de píxeles máxima (la del dispositivo si es menor). */
  pixelRatio: number;
  /** Separación entre partículas en pantalla (px CSS). */
  spacingPx: number;
  /** Huecos del pool de superficie (chunks de 80×80). */
  surfaceChunks: number;
  /** Resolución del bloom respecto a la pantalla. */
  bloomScale: number;
  /** Antialias multimuestra del pase de escena (al recargar). */
  msaa: boolean;
  /** Paneles de cristal con desenfoque del fondo (recomponen cada frame). */
  glass: boolean;
}

export const QUALITY_LEVELS: readonly QualityLevel[] = ['low', 'medium', 'high', 'ultra'];

export const QUALITY_PROFILES: Record<QualityLevel, QualityProfile> = {
  low: {
    level: 'low', name: 'Baja', summary: 'Resolución 1×, partículas más separadas, sin antialias',
    pixelRatio: 1, spacingPx: 3.4, surfaceChunks: 320, bloomScale: 0.25, msaa: false, glass: false,
  },
  medium: {
    level: 'medium', name: 'Media', summary: 'Resolución 1,5×, algo menos de partículas',
    pixelRatio: 1.5, spacingPx: 3, surfaceChunks: 448, bloomScale: 0.35, msaa: true, glass: true,
  },
  high: {
    level: 'high', name: 'Alta', summary: 'Resolución nativa hasta 2×, el aspecto de referencia',
    pixelRatio: 2, spacingPx: 2.6, surfaceChunks: 576, bloomScale: 0.5, msaa: true, glass: true,
  },
  ultra: {
    level: 'ultra', name: 'Ultra', summary: 'Resolución nativa hasta 3× y más partículas',
    pixelRatio: 3, spacingPx: 2.2, surfaceChunks: 800, bloomScale: 0.5, msaa: true, glass: true,
  },
};

/** Lo que se sabe del equipo antes de crear el renderer. */
export interface DeviceInfo {
  webgpu: boolean;
  /** Fabricante y arquitectura de la GPU, si el navegador los da. */
  gpu: string;
  /** Nivel recomendado. */
  recommended: QualityLevel;
}

const STORAGE_KEY = 'particles.quality';
/** Nombres aceptados en `?quality=` (en español o en inglés). */
const URL_NAMES: Record<string, QualityLevel> = {
  baja: 'low', low: 'low', media: 'medium', medium: 'medium', alta: 'high', high: 'high', ultra: 'ultra',
};

interface AdapterInfo {
  vendor?: string;
  architecture?: string;
  description?: string;
}

export async function detectDevice(): Promise<DeviceInfo> {
  const nav = navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ info?: AdapterInfo } | null> } };
  let adapter: { info?: AdapterInfo } | null = null;
  try {
    adapter = (await nav.gpu?.requestAdapter()) ?? null;
  } catch {
    adapter = null;
  }
  const info: AdapterInfo = adapter?.info ?? {};
  const vendor = (info.vendor ?? '').toLowerCase();
  const gpu = [info.vendor, info.architecture].filter(Boolean).join(' · ') || info.description || (adapter ? 'GPU' : 'WebGL2');

  const coarse = matchMedia('(pointer: coarse)').matches;
  const small = Math.min(screen.width, screen.height) < 820;
  const cores = navigator.hardwareConcurrency || 8;
  let recommended: QualityLevel;
  if (!adapter || (coarse && small)) recommended = 'low';
  else if (/nvidia|amd|ati/.test(vendor)) recommended = 'ultra';
  else if (/intel/.test(vendor) || cores <= 4) recommended = 'medium';
  else if (/qualcomm|arm|mali|adreno/.test(vendor)) recommended = 'low';
  else recommended = 'high'; // Apple Silicon y desconocidas: el objetivo de §12.
  return { webgpu: adapter !== null, gpu, recommended };
}

/** Ventana de medida del ajuste automático (s) y umbral: mediana por debajo de ~42 fps. */
const WINDOW_SECONDS = 3;
const SLOW_FRAME_MS = 1000 / 42;
/** Tras arrancar o cambiar de perfil se compilan shaders y se hornea: no se mide. */
const SETTLE_SECONDS = 6;

export class Quality {
  choice: QualityChoice;
  level: QualityLevel;
  /** Fijado por la URL: sin ajuste automático ni guardado. */
  readonly pinned: boolean;
  /** Perfil con el que arrancó el renderer (el MSAA no cambia sin recargar). */
  readonly startupMsaa: boolean;

  private readonly listeners = new Set<(p: QualityProfile, reason: 'user' | 'auto') => void>();
  private samples: number[] = [];
  private windowSeconds = 0;
  private settle = SETTLE_SECONDS;
  private slowWindows = 0;

  constructor(readonly device: DeviceInfo) {
    const fromUrl = URL_NAMES[new URLSearchParams(location.search).get('quality')?.toLowerCase() ?? ''] as QualityLevel | undefined;
    this.pinned = fromUrl !== undefined;
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(STORAGE_KEY);
    } catch {
      stored = null;
    }
    const choice: QualityChoice = fromUrl ?? (stored === 'auto' || (stored && stored in QUALITY_PROFILES) ? (stored as QualityChoice) : 'auto');
    this.choice = choice;
    this.level = choice === 'auto' ? device.recommended : choice;
    this.startupMsaa = this.profile.msaa;
  }

  get profile(): QualityProfile {
    return QUALITY_PROFILES[this.level];
  }

  /** ¿Hace falta recargar para que el perfil actual se aplique del todo? */
  get needsReload(): boolean {
    return this.profile.msaa !== this.startupMsaa;
  }

  onChange(fn: (p: QualityProfile, reason: 'user' | 'auto') => void): void {
    this.listeners.add(fn);
  }

  set(choice: QualityChoice): void {
    this.choice = choice;
    if (!this.pinned) {
      try {
        localStorage.setItem(STORAGE_KEY, choice);
      } catch {
        // Sin almacenamiento (modo privado): vale para esta sesión.
      }
    }
    this.apply(choice === 'auto' ? this.device.recommended : choice, 'user');
  }

  /** Vuelve a esperar antes de medir (al levantarse la pantalla de carga). */
  restartMeasure(): void {
    this.samples = [];
    this.windowSeconds = 0;
    this.slowWindows = 0;
    this.settle = SETTLE_SECONDS;
  }

  /**
   * Una muestra por frame del bucle real (requestAnimationFrame). Devuelve true si ha
   * bajado de nivel.
   */
  sample(frameMs: number, dt: number): boolean {
    if (this.choice !== 'auto' || this.pinned || document.visibilityState !== 'visible') return false;
    if (this.settle > 0) {
      this.settle -= dt;
      return false;
    }
    // Tirones sueltos (compilar un shader, subir un nivel de detalle): no cuentan.
    if (frameMs < 250) this.samples.push(frameMs);
    this.windowSeconds += dt;
    if (this.windowSeconds < WINDOW_SECONDS) return false;

    const sorted = this.samples.sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    this.samples = [];
    this.windowSeconds = 0;
    this.slowWindows = median > SLOW_FRAME_MS ? this.slowWindows + 1 : 0;
    const index = QUALITY_LEVELS.indexOf(this.level);
    if (this.slowWindows >= 2 && index > 0) {
      this.apply(QUALITY_LEVELS[index - 1], 'auto');
      return true;
    }
    return false;
  }

  private apply(level: QualityLevel, reason: 'user' | 'auto'): void {
    this.level = level;
    this.samples = [];
    this.windowSeconds = 0;
    this.slowWindows = 0;
    this.settle = SETTLE_SECONDS;
    for (const fn of this.listeners) fn(this.profile, reason);
  }
}

/** Historial de tiempos de frame para el medidor de la UI. */
export class FrameStats {
  readonly history = new Float32Array(120);
  private head = 0;
  fps = 60;
  frameMs = 16.7;

  push(frameMs: number): void {
    this.history[this.head] = frameMs;
    this.head = (this.head + 1) % this.history.length;
    // Media exponencial del tiempo de frame (más estable que la de los fps).
    this.frameMs += (frameMs - this.frameMs) * 0.05;
    this.fps = 1000 / this.frameMs;
  }

  /** Muestras de la más antigua a la más reciente. */
  *ordered(): Generator<number> {
    const n = this.history.length;
    for (let i = 0; i < n; i++) yield this.history[(this.head + i) % n];
  }
}
