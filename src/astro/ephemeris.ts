/**
 * Posición de cada cuerpo relativa a su padre y orientación. Ver docs/ARQUITECTURA.md §5.
 */
import type { BodyData } from './bodies';
import type { Vec3d } from './frames';
import { heliocentricPosition } from './kepler';
import { moonGeocentricPosition } from './moon';
import { daysSinceJ2000 } from './units';

/** Posición relativa al cuerpo padre, eclíptica J2000 (km). El Sol devuelve (0,0,0). */
export function positionRelativeToParent(body: BodyData, timeMs: number): Vec3d {
  if (body.id === 'moon') return moonGeocentricPosition(timeMs);
  if (body.orbit) return heliocentricPosition(body.orbit, timeMs);
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
 * Ángulo de rotación propia (rad, en [0, 2π)) para cuerpos sin modelo específico.
 * TODO(fase 2): usar W0 y polos de la IAU (WGCCRE) para cada cuerpo.
 */
export function genericRotationAngle(body: BodyData, timeMs: number): number {
  const periodDays = body.rotationPeriodH / 24;
  const turns = (daysSinceJ2000(timeMs) / periodDays) % 1;
  return (turns < 0 ? turns + 1 : turns) * TWO_PI;
}
