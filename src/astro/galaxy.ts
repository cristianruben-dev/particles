/**
 * Dónde está el Sol en la Vía Láctea. Ver docs/ARQUITECTURA.md §14.3.
 */
import { galacticToScene, type Vec3d } from './frames';
import { PC_KM } from './units';

export const KPC_KM = 1000 * PC_KM;

/** Distancia del Sol a Sagitario A* (GRAVITY 2019), kpc. */
export const SUN_R0_KPC = 8.178;
/** Altura del Sol sobre el plano de la galaxia (Bennett y Bovy 2019), kpc. */
export const SUN_Z0_KPC = 0.0208;

/**
 * Centro galáctico respecto al Sol (km, ejes de escena). Con el Sol 21 pc sobre el plano, el
 * centro queda a b = −0,15° (Sagitario A* está a −0,05°: la diferencia no se ve).
 */
export const GALACTIC_CENTER_KM: Vec3d = (() => {
  const v = galacticToScene({ x: SUN_R0_KPC, y: 0, z: -SUN_Z0_KPC });
  return { x: v.x * KPC_KM, y: v.y * KPC_KM, z: v.z * KPC_KM };
})();

/** Polo norte galáctico (unitario, ejes de escena). */
export const GALACTIC_NORTH: Vec3d = galacticToScene({ x: 0, y: 0, z: 1 });
/** Dirección del centro galáctico (l = 0°, b = 0°; unitaria, ejes de escena). */
export const GALACTIC_CENTER_DIR: Vec3d = galacticToScene({ x: 1, y: 0, z: 0 });
