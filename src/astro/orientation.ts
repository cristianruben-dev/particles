/**
 * Orientación de los cuerpos según la IAU (polo + meridiano principal). Ver docs/ARQUITECTURA.md §5.
 *
 * Marco del cuerpo (antes de girar): eje x hacia el nodo Q (donde el ecuador del cuerpo
 * cruza el ecuador ICRF subiendo, en RA = α0 + 90°), eje y hacia el polo norte y z = x × y.
 * El giro propio W, alrededor de y, lleva x al meridiano principal (lon 0°). Con la
 * convención de texturas (este = −z local) los ángulos son longitudes este.
 */
import type { PoleData } from './bodies';
import { equatorialToEcliptic, raDecToVector, type Vec3d } from './frames';
import { DEG, daysSinceJ2000, julianCenturiesSinceJ2000 } from './units';

export interface BodyFrame {
  /** Polo norte (eclíptica J2000, unitario). */
  pole: Vec3d;
  /** Nodo Q del ecuador del cuerpo sobre el ecuador ICRF (eclíptica J2000, unitario). */
  node: Vec3d;
}

/** Plano con polo en (ra, dec) del ICRF (grados) → polo y nodo en la eclíptica J2000. */
export function planeFrame(raDeg: number, decDeg: number): BodyFrame {
  const ra = raDeg * DEG;
  return {
    pole: equatorialToEcliptic(raDecToVector(ra, decDeg * DEG)),
    node: equatorialToEcliptic({ x: -Math.sin(ra), y: Math.cos(ra), z: 0 }),
  };
}

export function bodyFrame(p: PoleData, timeMs: number): BodyFrame {
  const T = julianCenturiesSinceJ2000(timeMs);
  return planeFrame(p.ra + p.raRate * T, p.dec + p.decRate * T);
}

/** Ángulo del meridiano principal W (rad, en [0, 2π)), reducido en float64. */
export function primeMeridian(p: PoleData, timeMs: number): number {
  const deg = (p.w0 + p.wRate * daysSinceJ2000(timeMs)) % 360;
  return ((deg < 0 ? deg + 360 : deg) * Math.PI) / 180;
}

export const cross3d = (a: Vec3d, b: Vec3d): Vec3d => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
