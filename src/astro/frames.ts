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

/** Ejes de escena → eclíptico (la inversa de `eclToScene`). */
export const sceneToEcl = (v: Vec3d): Vec3d => ({ x: v.x, y: -v.z, z: v.y });

/** Ecuatorial J2000 → eclíptico J2000 (rotación −ε alrededor de x). */
export function equatorialToEcliptic(v: Vec3d): Vec3d {
  const c = Math.cos(OBLIQUITY_J2000), s = Math.sin(OBLIQUITY_J2000);
  return { x: v.x, y: v.y * c + v.z * s, z: -v.y * s + v.z * c };
}

/** Eclíptico J2000 → ecuatorial J2000 (la inversa de `equatorialToEcliptic`). */
export function eclipticToEquatorial(v: Vec3d): Vec3d {
  const c = Math.cos(OBLIQUITY_J2000), s = Math.sin(OBLIQUITY_J2000);
  return { x: v.x, y: v.y * c - v.z * s, z: v.y * s + v.z * c };
}

/** Ascensión recta / declinación (rad) → vector unitario ecuatorial. */
export function raDecToVector(ra: number, dec: number): Vec3d {
  const cd = Math.cos(dec);
  return { x: cd * Math.cos(ra), y: cd * Math.sin(ra), z: Math.sin(dec) };
}

/** Vector ecuatorial → ascensión recta (0–2π) y declinación (rad). */
export function vectorToRaDec(v: Vec3d): [number, number] {
  const ra = Math.atan2(v.y, v.x);
  return [ra < 0 ? ra + 2 * Math.PI : ra, Math.atan2(v.z, Math.hypot(v.x, v.y))];
}

/** Matriz 3×3 por filas. */
export type Matrix3 = readonly [readonly [number, number, number], readonly [number, number, number], readonly [number, number, number]];

export const applyMatrix = (m: Matrix3, v: Vec3d): Vec3d => ({
  x: m[0][0] * v.x + m[0][1] * v.y + m[0][2] * v.z,
  y: m[1][0] * v.x + m[1][1] * v.y + m[1][2] * v.z,
  z: m[2][0] * v.x + m[2][1] * v.y + m[2][2] * v.z,
});

/** B1875.0 (JD 2405889,258550475), en siglos julianos desde J2000: la época de los límites de las constelaciones. */
export const B1875_CENTURIES = (2405889.258550475 - 2451545) / 36525;

/**
 * Precesión IAU 1976 (Lieske 1977) del ecuador y el equinoccio de J2000 a `t` siglos
 * julianos: r(t) = P · r(J2000). La misma fórmula que en `scripts/build-constellations.mjs`.
 */
export function precessionMatrix(t: number): Matrix3 {
  const as = DEG / 3600;
  const zeta = (2306.2181 * t + 0.30188 * t * t + 0.017998 * t ** 3) * as;
  const z = (2306.2181 * t + 1.09468 * t * t + 0.018203 * t ** 3) * as;
  const theta = (2004.3109 * t - 0.42665 * t * t - 0.041833 * t ** 3) * as;
  const cz = Math.cos(zeta), sz = Math.sin(zeta), cZ = Math.cos(z), sZ = Math.sin(z), ct = Math.cos(theta), st = Math.sin(theta);
  return [
    [cz * ct * cZ - sz * sZ, -sz * ct * cZ - cz * sZ, -st * cZ],
    [cz * ct * sZ + sz * cZ, -sz * ct * sZ + cz * cZ, -st * sZ],
    [cz * st, -sz * st, ct],
  ];
}

/**
 * Ecuatorial J2000 (ICRS) → galáctico: filas = ejes galácticos (x al centro, z al polo
 * norte) en ecuatoriales. Matriz de Hipparcos (ESA 1997, vol. 1, §1.5.3): polo norte
 * galáctico en AR 192,85948°, Dec +27,12825° y longitud del polo celeste 122,93192°. Ver §14.3.
 */
const EQ_TO_GAL = [
  [-0.0548755604162154, -0.873437090234885, -0.4838350155487132],
  [0.4941094278755837, -0.4448296299600112, 0.7469822444972189],
  [-0.8676661490190047, -0.1980763734312015, 0.4559837761750669],
] as const;

export function equatorialToGalactic(v: Vec3d): Vec3d {
  const [a, b, c] = EQ_TO_GAL;
  return {
    x: a[0] * v.x + a[1] * v.y + a[2] * v.z,
    y: b[0] * v.x + b[1] * v.y + b[2] * v.z,
    z: c[0] * v.x + c[1] * v.y + c[2] * v.z,
  };
}

/** Galáctico → ecuatorial J2000 (la traspuesta). */
export function galacticToEquatorial(v: Vec3d): Vec3d {
  const [a, b, c] = EQ_TO_GAL;
  return {
    x: a[0] * v.x + b[0] * v.y + c[0] * v.z,
    y: a[1] * v.x + b[1] * v.y + c[1] * v.z,
    z: a[2] * v.x + b[2] * v.y + c[2] * v.z,
  };
}

/** Longitud y latitud galácticas (rad) → vector unitario galáctico. */
export function lbToVector(l: number, b: number): Vec3d {
  const cb = Math.cos(b);
  return { x: cb * Math.cos(l), y: cb * Math.sin(l), z: Math.sin(b) };
}

/** Galáctico → ejes de escena (por el ecuatorial y la eclíptica, como las estrellas). */
export const galacticToScene = (v: Vec3d): Vec3d => eclToScene(equatorialToEcliptic(galacticToEquatorial(v)));
