/**
 * Constelaciones en el motor (§15): qué se dibuja (guardado en las preferencias), la carga,
 * la constelación bajo el ratón, la seleccionada y los nombres. Lo que mueve la cámara
 * («mirar hacia») lo hace `Engine` con `direction`.
 */
import type * as THREE from 'three/webgpu';
import { constellationAt, loadConstellations, type SkyData } from '../astro/constellations';
import { eclToScene, eclipticToEquatorial, equatorialToEcliptic, raDecToVector, sceneToEcl, type Vec3d } from '../astro/frames';
import { DEG } from '../astro/units';
import { ConstellationSky, constellationLook, type SkyOverlay } from '../bodies/Constellations';
import { loadStarCatalog } from '../bodies/Starfield';
import { ConstellationLabels } from '../ui/ConstellationLabels';
import type { SettingsToggle } from '../ui/SettingsPanel';

type Layer = keyof SkyOverlay | 'names' | 'stars';

/** [clave en `localStorage`, por defecto, texto, tecla]. */
const LAYERS: Record<Layer, [string, boolean, string, string?]> = {
  figures: ['constellations', true, 'Figuras de las constelaciones', 'K'],
  borders: ['boundaries', false, 'Límites de las constelaciones', 'B'],
  names: ['constellationNames', true, 'Nombres de las constelaciones'],
  stars: ['starNames', true, 'Nombres de las estrellas brillantes'],
  ecliptic: ['ecliptic', false, 'Eclíptica (el camino del Sol)'],
  equator: ['equator', false, 'Ecuador celeste'],
};

/** Lo que el motor sabe del cielo en este frame. */
export interface SkyFrame {
  dt: number;
  camera: THREE.PerspectiveCamera;
  width: number;
  height: number;
  /** Como `starLook.brightness`: de día, en la totalidad y lejos del Sol se apagan. */
  brightness: number;
  /** false cuando las estrellas de Yale ya no se dibujan (lejos del Sol). */
  visible: boolean;
  /** A ras de suelo: vertical del lugar y coseno del horizonte. */
  sky: { amount: number; up: Vec3d; dip: number };
  /** Los cuerpos: sus discos tapan los nombres del cielo. */
  bodies: readonly { object3d: THREE.Object3D; screenRadiusPx: number }[];
  /** Campo de visión vertical (grados): con zoom, las figuras se dibujan más llenas. */
  fov: number;
  /** Segundos de reloj real (para el centelleo). */
  seconds: number;
}

export class SkyController {
  data: SkyData | null = null;
  /** Seleccionada (ficha abierta), −1 si ninguna. */
  selected = -1;
  /** Bajo el cursor en el cielo, sobre un nombre y sobre una tarjeta del menú. */
  private pointerHover = -1;
  private labelHover = -1;
  private menuHover = -1;
  private sky: ConstellationSky | null = null;
  private labels: ConstellationLabels | null = null;
  private readonly on: Record<Layer, boolean>;
  /** Interruptores para el panel (y los dos primeros, para los ajustes). */
  readonly toggles: SettingsToggle[];

  constructor(private readonly scene: THREE.Scene, private readonly onPick: (index: number) => void) {
    this.on = Object.fromEntries((Object.keys(LAYERS) as Layer[]).map((l) => [l, read(LAYERS[l][0]) ?? LAYERS[l][1]])) as Record<Layer, boolean>;
    this.toggles = (Object.keys(LAYERS) as Layer[]).map((l) => ({
      id: LAYERS[l][0],
      label: LAYERS[l][2],
      key: LAYERS[l][3],
      get: () => this.on[l],
      set: (on: boolean) => this.set(l, on),
    }));
  }

  /** Datos, catálogo de estrellas, líneas y nombres. */
  async load(hudEl: HTMLElement): Promise<SkyData> {
    const [data, catalog] = await Promise.all([loadConstellations(), loadStarCatalog()]);
    this.data = data;
    this.sky = new ConstellationSky(data, catalog);
    this.scene.add(this.sky.group);
    this.labels = new ConstellationLabels(hudEl, data, this.onPick, (i) => (this.labelHover = i));
    return data;
  }

  get(layer: Layer): boolean {
    return this.on[layer];
  }

  set(layer: Layer, on: boolean): void {
    this.on[layer] = on;
    write(LAYERS[layer][0], on);
  }

  toggle(layer: Layer): void {
    this.set(layer, !this.on[layer]);
  }

  /** ¿Se ve algo en lo que mirar con el ratón? (figuras o límites). */
  get interactive(): boolean {
    return this.data !== null && (this.on.figures || this.on.borders) && constellationLook.brightness.value > 0.15;
  }

  /** Constelación en una dirección de escena (unitaria), o −1. */
  at(dir: Vec3d): number {
    return this.data ? constellationAt(this.data, eclipticToEquatorial(sceneToEcl(dir))) : -1;
  }

  /** Hay una constelación bajo el cursor (en el cielo): se puede pulsar. */
  get hovering(): boolean {
    return this.pointerHover >= 0;
  }

  /** Tarjeta del menú bajo el ratón: se ilumina en el cielo. */
  setMenuHover(index: number): void {
    this.menuHover = index;
  }

  /** El cursor sobre el cielo (dirección de escena), o null fuera, arrastrando o sobre un cuerpo. */
  setPointer(dir: Vec3d | null): void {
    this.pointerHover = dir && this.interactive ? this.at(dir) : -1;
  }

  /**
   * Nombre de la constelación en la que se ve `to` desde `from` (posiciones en km, marco
   * eclíptico): con km verdaderos, no en escena, que en la escala comprimida tuerce las direcciones.
   */
  seenFrom(from: Vec3d, to: Vec3d): string | null {
    return this.nameAt(eclipticToEquatorial({ x: to.x - from.x, y: to.y - from.y, z: to.z - from.z }));
  }

  /** Nombre de la constelación en una dirección ecuatorial J2000, o null. */
  nameAt(equatorial: Vec3d): string | null {
    if (!this.data) return null;
    const i = constellationAt(this.data, equatorial);
    return i >= 0 ? this.data.constellations[i].name : null;
  }

  /** Centro de la figura para mirarla (unitaria, ejes de escena). */
  direction(index: number): Vec3d {
    const [ra, dec] = this.data!.constellations[index].figure.center;
    return eclToScene(equatorialToEcliptic(raDecToVector(ra * DEG, dec * DEG)));
  }

  /** Altura sobre el horizonte (grados) a ras de suelo, o null en órbita. */
  altitude(index: number, sky: { amount: number; up: Vec3d }): number | null {
    if (!this.data || sky.amount < 0.5) return null;
    const d = this.direction(index);
    return Math.asin(Math.max(-1, Math.min(1, d.x * sky.up.x + d.y * sky.up.y + d.z * sky.up.z))) / DEG;
  }

  /** Partículas que se dibujan (para el HUD). */
  get particleCount(): number {
    return this.sky?.particleCount ?? 0;
  }

  update(f: SkyFrame): void {
    if (!this.sky || !this.labels) return;
    const look = constellationLook;
    look.brightness.value = f.brightness;
    const hover = this.labelHover >= 0 ? this.labelHover : this.menuHover >= 0 ? this.menuHover : this.pointerHover;
    look.hover.value = hover;
    look.selected.value = this.selected;
    const zoom = Math.min(1, Math.max(0, (42 - f.fov) / 12));
    this.sky.update(f.dt, this.on, f.visible, zoom * zoom * (3 - 2 * zoom), f.seconds);
    this.labels.update(f.camera, f.width, f.height, {
      // De día (brillo 0,05) los nombres no se ven: se apagan antes que las líneas.
      fade: f.visible ? Math.min(1, Math.max(0, (f.brightness - 0.1) * 2)) : 0,
      // Con las figuras apagadas (K), tampoco los nombres: solo el de la seleccionada.
      names: this.on.names && this.on.figures,
      stars: this.on.stars && this.on.figures,
      hover,
      selected: this.selected,
      sky: f.sky,
      bodies: f.bodies,
    });
  }
}

function read(key: string): boolean | null {
  try {
    const v = localStorage.getItem(`particles.${key}`);
    return v === null ? null : v === '1';
  } catch {
    return null;
  }
}

function write(key: string, on: boolean): void {
  try {
    localStorage.setItem(`particles.${key}`, on ? '1' : '0');
  } catch {
    // Sin almacenamiento: vale para esta sesión.
  }
}
