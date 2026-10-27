/**
 * Contrato común de todos los cuerpos. Ver docs/ARQUITECTURA.md §8.
 */
import type { Object3D, Vector3, WebGPURenderer } from 'three/webgpu';
import type { BodyData } from '../astro/bodies';
import type { Vec3d } from '../astro/frames';
import type { FloatingOrigin } from '../core/FloatingOrigin';
import type { LodLevel } from '../particles/LodManager';
import type { ScaleSystem } from '../scale/ScaleSystem';

export interface FrameContext {
  /** Fecha simulada (ms Unix). */
  timeMs: number;
  /** Segundos reales desde el frame anterior. */
  dt: number;
  scale: ScaleSystem;
  origin: FloatingOrigin;
  /** Para lanzar pasadas compute por frame. */
  renderer: WebGPURenderer;
  /** Dirección (mundo) del rayo bajo el cursor desde la cámara, o null si no está sobre el canvas. */
  pointer: Vector3 | null;
  /** Reloj real en segundos (para animaciones y la perturbación). */
  nowSeconds: number;
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

  /** Partículas activas (para el HUD y el presupuesto). */
  readonly particleCount: number;
  /** Se resuelve cuando las partículas están horneadas y subidas. */
  readonly ready: Promise<void>;

  update(ctx: FrameContext): void;
  setLod(level: LodLevel): void;
  dispose(): void;
}
