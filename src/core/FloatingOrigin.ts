/**
 * Render relativo a la cámara. Ver docs/ARQUITECTURA.md §4.2.
 *
 * La cámara de Three.js vive siempre en (0,0,0). Cada objeto se coloca en
 * (posEscena − posCámaraEscena), restado en float64 antes de pasar a float32.
 * Las posiciones de escena (float64) las calcula `SystemLayout` con `ScaleSystem`.
 */
import type { Object3D } from 'three/webgpu';
import type { Vec3d } from '../astro/frames';

export class FloatingOrigin {
  /** Posición de la cámara en espacio de escena (float64). */
  readonly cameraScene: Vec3d = { x: 0, y: 0, z: 0 };

  place(object: Object3D, scene: Vec3d): void {
    object.position.set(
      scene.x - this.cameraScene.x,
      scene.y - this.cameraScene.y,
      scene.z - this.cameraScene.z,
    );
  }
}
