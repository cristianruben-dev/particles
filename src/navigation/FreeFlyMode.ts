/**
 * Vuelo libre 6DOF con velocidad adaptativa. Ver docs/ARQUITECTURA.md §9.
 */
import type { CameraRig } from './CameraRig';
import type { NavigationMode } from './NavigationMode';

export class FreeFlyMode implements NavigationMode {
  readonly name = 'freefly';

  enter(_rig: CameraRig): void {
    // TODO(fase 4): pointer lock + WASD/QE.
  }

  update(_rig: CameraRig, _dt: number): void {
    // TODO(fase 4): velocidad ∝ distancia al cuerpo más cercano; Shift multiplica; colisión suave.
  }

  exit(_rig: CameraRig): void {}
}
