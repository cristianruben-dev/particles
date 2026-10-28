/**
 * Posición de cada cuerpo relativa a su padre y rotación propia. Ver docs/ARQUITECTURA.md §5.
 */
import { BODIES, type BodyData } from './bodies';
import type { Vec3d } from './frames';
import { heliocentricPosition } from './kepler';
import { moonGeocentricPosition } from './moon';
import { primeMeridian } from './orientation';
import { satellitePosition } from './satellites';
import { daysSinceJ2000 } from './units';

/** Posición relativa al cuerpo padre, eclíptica J2000 (km). El Sol devuelve (0,0,0). */
export function positionRelativeToParent(body: BodyData, timeMs: number): Vec3d {
  if (body.id === 'moon') return moonGeocentricPosition(timeMs);
  if (body.orbit) return heliocentricPosition(body.orbit, timeMs);
  if (body.satellite && body.parent) return satellitePosition(body.satellite, BODIES[body.parent], timeMs);
  return { x: 0, y: 0, z: 0 };
}

const TWO_PI = Math.PI * 2;

/**
 * Tiempo sidéreo medio de Greenwich (rad, en [0, 2π)).
 * Es el ángulo del meridiano de Greenwich respecto al punto vernal: la rotación de la Tierra.
 */
export function greenwichMeanSiderealTime(timeMs: number): number {
  const d = daysSinceJ2000(timeMs);
  // Reducido en float64 antes de cualquier uso en GPU.
  const deg = (280.46061837 + 360.98564736629 * d) % 360;
  return ((deg < 0 ? deg + 360 : deg) / 360) * TWO_PI;
}

/**
 * Ángulo de giro propio (rad, en [0, 2π)) alrededor del polo, medido desde el nodo Q
 * (ver astro/orientation.ts). La Tierra usa el tiempo sidéreo: su nodo Q está en
 * RA 90°, así que el giro es GMST − 90°.
 */
export function spinAngle(body: BodyData, timeMs: number): number {
  if (body.id === 'earth') {
    const a = greenwichMeanSiderealTime(timeMs) - Math.PI / 2;
    return a < 0 ? a + TWO_PI : a;
  }
  return primeMeridian(body.pole, timeMs);
}
