/**
 * Contrato de los modos de cámara. Ver docs/ARQUITECTURA.md §9.
 * Cada modo escribe `rig.position`, `rig.target` y `rig.clearance` en `update`.
 */
import type { CameraRig } from './CameraRig';

export interface NavigationMode {
  readonly name: 'orbit' | 'freefly' | 'travel';
  enter(rig: CameraRig): void;
  update(rig: CameraRig, dt: number): void;
  exit(rig: CameraRig): void;
}
