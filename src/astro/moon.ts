/**
 * Posición geocéntrica de la Luna. Ver docs/ARQUITECTURA.md §5.
 *
 * Fórmula de baja precisión del Astronomical Almanac (~0,3° en longitud, ~0,2° en latitud),
 * más una corrección lineal de precesión para pasar de "eclíptica de la fecha" a J2000.
 */
import type { Vec3d } from './frames';
import { DEG, julianCenturiesSinceJ2000 } from './units';

const EARTH_EQUATORIAL_RADIUS_KM = 6378.14;
/** Precesión general en longitud (grados por siglo juliano). */
const PRECESSION_DEG_PER_CENTURY = 1.39697;

const sinD = (deg: number) => Math.sin(deg * DEG);
const cosD = (deg: number) => Math.cos(deg * DEG);

/** Posición de la Luna relativa a la Tierra, eclíptica J2000 (km). */
export function moonGeocentricPosition(timeMs: number): Vec3d {
  const T = julianCenturiesSinceJ2000(timeMs);

  const lambda =
    218.32 + 481267.881 * T
    + 6.29 * sinD(134.9 + 477198.85 * T)
    - 1.27 * sinD(259.2 - 413335.38 * T)
    + 0.66 * sinD(235.7 + 890534.23 * T)
    + 0.21 * sinD(269.9 + 954397.7 * T)
    - 0.19 * sinD(357.5 + 35999.05 * T)
    - 0.11 * sinD(186.6 + 966404.05 * T)
    - PRECESSION_DEG_PER_CENTURY * T;

  const beta =
    5.13 * sinD(93.3 + 483202.03 * T)
    + 0.28 * sinD(228.2 + 960400.87 * T)
    - 0.28 * sinD(318.3 + 6003.18 * T)
    - 0.17 * sinD(217.6 - 407332.2 * T);

  const parallax =
    0.9508
    + 0.0518 * cosD(134.9 + 477198.85 * T)
    + 0.0095 * cosD(259.2 - 413335.38 * T)
    + 0.0078 * cosD(235.7 + 890534.23 * T)
    + 0.0028 * cosD(269.9 + 954397.7 * T);

  const distanceKm = EARTH_EQUATORIAL_RADIUS_KM / sinD(parallax);
  const cb = cosD(beta);
  return {
    x: distanceKm * cb * cosD(lambda),
    y: distanceKm * cb * sinD(lambda),
    z: distanceKm * sinD(beta),
  };
}
