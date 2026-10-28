/**
 * Posición de cada cuerpo relativa a su padre y rotación propia. Ver docs/ARQUITECTURA.md §5.
 */
import { BODIES, type BodyData, type BodyId } from './bodies';
import type { Vec3d } from './frames';
import { cometElementsAt, cometPosition } from './comets';
import { issGeocentricPosition } from './iss';
import { heliocentricPosition } from './kepler';
import { moonGeocentricPosition } from './moon';
import { bodyFrame, cross3d, primeMeridian } from './orientation';
import { satellitePosition } from './satellites';
import { daysSinceJ2000, julianCenturiesSinceJ2000, terrestrialTimeMs } from './units';

/** Masa de la Tierra / masa de la Luna: la Tierra está a 1/(1 + 81,3) de la Luna del baricentro. */
const EARTH_MOON_MASS_RATIO = 81.30057;

/**
 * Posición relativa al cuerpo padre, eclíptica J2000 (km). El Sol devuelve (0,0,0).
 * `timeMs` en UTC; las efemérides se evalúan en tiempo terrestre (ΔT).
 */
export function positionRelativeToParent(body: BodyData, timeMs: number): Vec3d {
  // SGP4 va en UTC.
  if (body.id === 'iss') return issGeocentricPosition(timeMs);
  const tt = terrestrialTimeMs(timeMs);
  if (body.id === 'moon') return moonGeocentricPosition(tt);
  if (body.id === 'earth' && body.orbit) {
    // Los elementos de JPL son los del baricentro Tierra-Luna, a ~4.700 km del centro de la Tierra.
    const emb = heliocentricPosition(body.orbit, tt);
    const moon = moonGeocentricPosition(tt);
    const k = 1 / (1 + EARTH_MOON_MASS_RATIO);
    return { x: emb.x - moon.x * k, y: emb.y - moon.y * k, z: emb.z - moon.z * k };
  }
  if (body.orbit) return heliocentricPosition(body.orbit, tt);
  if (body.comet) return cometPosition(cometElementsAt(body.comet, tt), tt);
  if (body.satellite && body.parent) return satellitePosition(body.satellite, BODIES[body.parent], tt);
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
 * (ver astro/orientation.ts). La Tierra usa el tiempo sidéreo, que se mide desde el
 * equinoccio de la fecha: su nodo Q sobre el ecuador J2000 está en RA 90° − ζ y, sobre el
 * ecuador de la fecha, a 90° + z del equinoccio (precesión IAU 1976), así que el giro es
 * GMST − 90° − z. Sin la precesión, en 2026 el meridiano de Greenwich quedaba 0,34° al este.
 */
export function spinAngle(body: BodyData, timeMs: number): number {
  if (body.id === 'earth') {
    const T = julianCenturiesSinceJ2000(timeMs);
    const z = ((2306.2181 + 1.09468 * T) * T * Math.PI) / (180 * 3600);
    const a = (greenwichMeanSiderealTime(timeMs) - Math.PI / 2 - z) % TWO_PI;
    return a < 0 ? a + TWO_PI : a;
  }
  return primeMeridian(body.pole, timeMs);
}

/** Posición heliocéntrica, eclíptica J2000 (km): la suma de las posiciones relativas hasta el Sol. */
export function heliocentricKm(id: BodyId, timeMs: number): Vec3d {
  const out = { x: 0, y: 0, z: 0 };
  for (let body: BodyData | undefined = BODIES[id]; body?.parent; body = BODIES[body.parent]) {
    const rel = positionRelativeToParent(body, timeMs);
    out.x += rel.x; out.y += rel.y; out.z += rel.z;
  }
  return out;
}

/**
 * Eclíptica J2000 → marco fijo del cuerpo (y = polo, x hacia lon 0°, este = −z; ver
 * orientation.ts), con el giro de la fecha. Es la orientación que dibuja `BaseBody.orient`.
 */
export function bodyFixedFromEcliptic(body: BodyData, timeMs: number, v: Vec3d): Vec3d {
  const f = bodyFrame(body.pole, timeMs);
  const z = cross3d(f.node, f.pole);
  const bx = dot(v, f.node), by = dot(v, f.pole), bz = dot(v, z);
  const w = spinAngle(body, timeMs), c = Math.cos(w), s = Math.sin(w);
  return { x: bx * c - bz * s, y: by, z: bx * s + bz * c };
}

/** Inversa de `bodyFixedFromEcliptic`. */
export function eclipticFromBodyFixed(body: BodyData, timeMs: number, v: Vec3d): Vec3d {
  const f = bodyFrame(body.pole, timeMs);
  const z = cross3d(f.node, f.pole);
  const w = spinAngle(body, timeMs), c = Math.cos(w), s = Math.sin(w);
  const bx = v.x * c + v.z * s, by = v.y, bz = -v.x * s + v.z * c;
  return {
    x: bx * f.node.x + by * f.pole.x + bz * z.x,
    y: bx * f.node.y + by * f.pole.y + bz * z.y,
    z: bx * f.node.z + by * f.pole.z + bz * z.z,
  };
}

/** Latitud y longitud planetocéntricas (grados, este positivo) de una dirección del marco fijo. */
export function latLonOf(v: Vec3d): { lat: number; lon: number } {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { lat: (Math.asin(v.y / l) * 180) / Math.PI, lon: (Math.atan2(-v.z, v.x) * 180) / Math.PI };
}

const dot = (a: Vec3d, b: Vec3d) => a.x * b.x + a.y * b.y + a.z * b.z;
