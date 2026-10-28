/**
 * Cámara con posición en espacio de escena (float64). Ver docs/ARQUITECTURA.md §9 y §4.2.
 *
 * La cámara de Three.js nunca se mueve de (0,0,0): solo rota. Su posición "real"
 * es `origin.cameraScene`, que el origen flotante resta a todo lo demás.
 */
import * as THREE from 'three/webgpu';
import { vec3d, type Vec3d } from '../astro/frames';
import type { FloatingOrigin } from '../core/FloatingOrigin';
import type { ScaleSystem } from '../scale/ScaleSystem';
import type { NavigationMode } from './NavigationMode';

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  /** Punto al que mira la cámara (escena, float64). */
  readonly target: Vec3d = vec3d();
  /** Distancia en escena hasta la superficie más cercana (para el plano cercano). */
  clearance = 1;

  private mode: NavigationMode | null = null;

  constructor(
    aspect: number,
    readonly origin: FloatingOrigin,
    readonly scale: ScaleSystem,
  ) {
    this.camera = new THREE.PerspectiveCamera(50, aspect, 0.01, 1e10);
  }

  /** Posición de la cámara en escena (la del origen flotante). */
  get position(): Vec3d {
    return this.origin.cameraScene;
  }

  setMode(mode: NavigationMode): void {
    this.mode?.exit(this);
    this.mode = mode;
    mode.enter(this);
  }

  update(dt: number): void {
    this.mode?.update(this, dt);

    const p = this.position;
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.target.x - p.x, this.target.y - p.y, this.target.z - p.z);

    // Plano cercano proporcional a la distancia a la superficie: precisión de profundidad
    // donde importa. TODO(fase 3): tener en cuenta todos los cuerpos, no solo el enfocado.
    const near = Math.min(10, Math.max(1e-4, this.clearance * 0.05));
    if (Math.abs(near - this.camera.near) / this.camera.near > 0.05) {
      this.camera.near = near;
      this.camera.updateProjectionMatrix();
    }
  }
}
