/**
 * API del horneado de partículas (lado hilo principal). Ver docs/ARQUITECTURA.md §6.2.
 */

export interface BakeTexture {
  url: string;
  /** 1 = canal rojo (gris), 3 = RGB. */
  channels: 1 | 3;
  /** true = convertir sRGB → lineal (color). false = valores crudos (alturas, máscaras). */
  srgb: boolean;
  /** Longitud este (grados) del borde izquierdo del mapa. Por defecto −180 (lon 0° en el centro). */
  leftLon?: number;
}

export type BakeDistribution =
  /** Fibonacci con orden estratificado: uniforme y cualquier prefijo también lo es. */
  | { kind: 'progressive' }
  /** Muestreo por rechazo según el brillo de una textura (p. ej. nubes). */
  | { kind: 'density'; texture: string; gamma: number; threshold: number };

/**
 * Ruido fractal (fBm de ruido de valor, 0–1) en cada punto, para cuerpos sin textura
 * o para dar turbulencia a las bandas. `stretch` > 1 estira los rasgos en longitud.
 */
export interface BakeNoise {
  scale: number;
  stretch: number;
  octaves: number;
}

export interface BakeRequest {
  id: number;
  count: number;
  seed: number;
  distribution: BakeDistribution;
  textures: Record<string, BakeTexture>;
  /** Si se pide, `samples.noise` trae un valor por punto. */
  noise?: BakeNoise;
}

export interface BakeResult {
  id: number;
  /** count × vec4: dirección unitaria xyz + aleatorio estable en w. */
  directions: Float32Array;
  /** count × channels por textura. */
  samples: Record<string, Float32Array>;
}

/** Varios workers: cada cuerpo se hornea en paralelo. */
const POOL_SIZE = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));

interface PoolWorker {
  worker: Worker;
  pending: number;
}

const pool: PoolWorker[] = [];
let nextId = 0;
const resolvers = new Map<number, (r: BakeResult) => void>();

function leastBusyWorker(): PoolWorker {
  if (pool.length < POOL_SIZE) {
    const entry: PoolWorker = {
      worker: new Worker(new URL('./bake.worker.ts', import.meta.url), { type: 'module' }),
      pending: 0,
    };
    entry.worker.addEventListener('message', (e: MessageEvent<BakeResult>) => {
      entry.pending--;
      resolvers.get(e.data.id)?.(e.data);
      resolvers.delete(e.data.id);
    });
    pool.push(entry);
    return entry;
  }
  return pool.reduce((a, b) => (b.pending < a.pending ? b : a));
}

export function bakeSphere(request: Omit<BakeRequest, 'id'>): Promise<BakeResult> {
  const id = nextId++;
  return new Promise((resolve) => {
    resolvers.set(id, resolve);
    const entry = leastBusyWorker();
    entry.pending++;
    entry.worker.postMessage({ ...request, id });
  });
}
