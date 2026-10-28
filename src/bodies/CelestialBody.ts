/**
 * Contrato común de todos los cuerpos. Ver docs/ARQUITECTURA.md §8.
 */
import type { Color, Object3D, PerspectiveCamera, Quaternion, Vector3, WebGPURenderer } from 'three/webgpu';
import type { BodyData, BodyId } from '../astro/bodies';
import type { Vec3d } from '../astro/frames';
import type { FloatingOrigin } from '../core/FloatingOrigin';
import type { ScaleSystem } from '../scale/ScaleSystem';

export interface FrameContext {
  /** Fecha simulada (ms Unix). */
  timeMs: number;
  /** Segundos reales desde el frame anterior. */
  dt: number;
  /** Segundos simulados por segundo real (0 en pausa). */
  timeRate: number;
  scale: ScaleSystem;
  origin: FloatingOrigin;
  /** Para lanzar pasadas compute por frame. */
  renderer: WebGPURenderer;
  /** Dirección (mundo) del rayo bajo el cursor desde la cámara, o null si no está sobre el canvas. */
  pointer: Vector3 | null;
  /** Reloj real en segundos (para animaciones y la perturbación). */
  nowSeconds: number;
  /** Cámara (en el origen; para el frustum de la superficie). */
  camera: PerspectiveCamera;
  /** Otro cuerpo de la escena (para las sombras de eclipse). */
  body(id: BodyId): CelestialBody | undefined;
}

export interface CelestialBody {
  readonly data: BodyData;
  readonly parent: CelestialBody | null;
  /** Raíz del cuerpo en la escena; el origen flotante mueve solo esto. */
  readonly object3d: Object3D;

  /** Posición verdadera heliocéntrica, eclíptica J2000 (km). La escribe `layoutSystem`. */
  readonly positionKm: Vec3d;
  /** Posición en espacio de escena (float64). La escribe `layoutSystem`. */
  readonly sceneD: Vec3d;
  /** Radio en unidades de escena. */
  sceneRadius: number;
  /** Radio en pantalla (px CSS) en el último frame. */
  readonly screenRadiusPx: number;

  /** Partículas activas (para el HUD y el presupuesto). */
  readonly particleCount: number;
  /** Se resuelve cuando la vista previa está horneada y subida. */
  readonly ready: Promise<void>;

  /** Orientación de la fecha (polo y giro). Antes que la cámara: a ras de suelo, ella depende del giro. */
  orient(timeMs: number): void;
  update(ctx: FrameContext): void;
  /** El cuerpo enfocado carga su detalle completo aunque aún se vea pequeño (§6.3). */
  setFocused(focused: boolean): void;

  /** ¿Se puede bajar hasta el suelo? (§7) */
  readonly landable: boolean;
  /** Altura del suelo (km sobre el radio medio) bajo una dirección de escena desde el centro. */
  groundHeightKm(dir: Vec3d): number;
  /** Orientación del grupo que gira con el cuerpo (en ejes de escena). */
  readonly spinQuaternion: Quaternion;
  /** Fondo visto desde la cámara: cielo, suelo, vertical y caída del horizonte (0 = espacio). */
  readonly sky: { color: Color; ground: Color; up: Vector3; dip: number; amount: number };
  dispose(): void;
}
