/**
 * Viaje cinematográfico hacia un cuerpo. Ver docs/ARQUITECTURA.md §9.
 *
 * En la fase 1 la transición entre cuerpos la hace `OrbitMode.focusOn`.
 */
import type { CelestialBody } from '../bodies/CelestialBody';
import type { CameraRig } from './CameraRig';
import type { NavigationMode } from './NavigationMode';

export class TravelMode implements NavigationMode {
  readonly name = 'travel';

  constructor(readonly target: CelestialBody, readonly onArrive: () => void) {}

  enter(_rig: CameraRig): void {}

  update(_rig: CameraRig, _dt: number): void {
    // TODO(fase 2): trayectoria con despegue y llegada visibles a escala de sistema.
    // TODO(fase 4): exponer la velocidad para el efecto warp de postfx.
  }

  exit(_rig: CameraRig): void {}
}
