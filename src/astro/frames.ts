/**
 * Marcos de referencia y vectores float64. Ver docs/ARQUITECTURA.md §4 y §5.
 *
 * - "Eclíptico": J2000, x hacia el punto vernal, z hacia el polo norte de la eclíptica.
 * - "Escena": ejes de Three.js (y arriba). Conversión: (x, y, z)ecl → (x, z, −y).
 */
import { DEG } from './units';

/** Vector en float64. No usar THREE.Vector3 para la "verdad" de la simulación. */
export interface Vec3d {
  x: number;
  y: number;
  z: number;
}

/** Oblicuidad de la eclíptica J2000 (rad). */
export const OBLIQUITY_J2000 = 23.4392911 * DEG;

export const vec3d = (x = 0, y = 0, z = 0): Vec3d => ({ x, y, z });

export const length3d = (v: Vec3d): number => Math.hypot(v.x, v.y, v.z);

/** Eclíptico → ejes de escena. */
export const eclToScene = (v: Vec3d): Vec3d => ({ x: v.x, y: v.z, z: -v.y });

/** Ecuatorial J2000 → eclíptico J2000 (rotación −ε alrededor de x). */
export function equatorialToEcliptic(v: Vec3d): Vec3d {
  const c = Math.cos(OBLIQUITY_J2000), s = Math.sin(OBLIQUITY_J2000);
  return { x: v.x, y: v.y * c + v.z * s, z: -v.y * s + v.z * c };
}

/** Ascensión recta / declinación (rad) → vector unitario ecuatorial. */
export function raDecToVector(ra: number, dec: number): Vec3d {
  const cd = Math.cos(dec);
  return { x: cd * Math.cos(ra), y: cd * Math.sin(ra), z: Math.sin(dec) };
}
