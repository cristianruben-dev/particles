/**
 * Posiciones verdaderas (km) y de escena (float64) de todos los cuerpos. Ver docs/ARQUITECTURA.md §4.3.
 */
import { eclToScene, length3d } from '../astro/frames';
import { positionRelativeToParent } from '../astro/ephemeris';
import type { CelestialBody } from '../bodies/CelestialBody';
import type { ScaleSystem } from '../scale/ScaleSystem';

/**
 * `bodies` debe venir ordenado con cada padre antes que sus hijos.
 * Cada hijo se coloca en la dirección real respecto a su padre, a la distancia
 * `scale.localDistance(padre, d)`.
 */
export function layoutSystem(bodies: readonly CelestialBody[], timeMs: number, scale: ScaleSystem): void {
  for (const body of bodies) {
    body.sceneRadius = scale.radius(body.data.radiusKm);
    const parent = body.parent;
    if (!parent) {
      Object.assign(body.positionKm, { x: 0, y: 0, z: 0 });
      Object.assign(body.sceneD, { x: 0, y: 0, z: 0 });
      continue;
    }

    const rel = positionRelativeToParent(body.data, timeMs);
    body.positionKm.x = parent.positionKm.x + rel.x;
    body.positionKm.y = parent.positionKm.y + rel.y;
    body.positionKm.z = parent.positionKm.z + rel.z;

    const d = length3d(rel);
    const k = scale.localDistance(parent.data, d) / d;
    const dir = eclToScene(rel);
    body.sceneD.x = parent.sceneD.x + dir.x * k;
    body.sceneD.y = parent.sceneD.y + dir.y * k;
    body.sceneD.z = parent.sceneD.z + dir.z * k;
  }
}
