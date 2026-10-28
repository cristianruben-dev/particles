/**
 * Posición geocéntrica de la Luna. Ver docs/ARQUITECTURA.md §5.
 *
 * Meeus, *Astronomical Algorithms* (2.ª ed.), cap. 47: la teoría ELP-2000/82 truncada
 * (60 términos en longitud y distancia y 60 en latitud), con un error de unos 10″ en
 * longitud y 4″ en latitud: ~20 km a la distancia de la Luna, lo que pide la sombra de un
 * eclipse (la umbra mide ~100–250 km). Coeficientes de la tabla 47.A/47.B, en la
 * transcripción de la biblioteca `astronomia` (MIT). El resultado (eclíptica media de la
 * fecha) se precesa a la eclíptica J2000 con las fórmulas del cap. 21.
 *
 * La fórmula de baja precisión del *Astronomical Almanac* que había antes se desviaba
 * 0,19° de JPL Horizons: 1.300 km, la sombra caía en otro país.
 */
import type { Vec3d } from './frames';
import { DEG, julianCenturiesSinceJ2000 } from './units';

const ARCSEC = DEG / 3600;

/** Términos periódicos en longitud (10⁻⁶ °) y distancia (10⁻³ km): D, M, M′, F, Σl, Σr. */
const LR: readonly (readonly number[])[] = [
  [0, 0, 1, 0, 6288774, -20905355], [2, 0, -1, 0, 1274027, -3699111], [2, 0, 0, 0, 658314, -2955968],
  [0, 0, 2, 0, 213618, -569925], [0, 1, 0, 0, -185116, 48888], [0, 0, 0, 2, -114332, -3149],
  [2, 0, -2, 0, 58793, 246158], [2, -1, -1, 0, 57066, -152138], [2, 0, 1, 0, 53322, -170733],
  [2, -1, 0, 0, 45758, -204586], [0, 1, -1, 0, -40923, -129620], [1, 0, 0, 0, -34720, 108743],
  [0, 1, 1, 0, -30383, 104755], [2, 0, 0, -2, 15327, 10321], [0, 0, 1, 2, -12528, 0],
  [0, 0, 1, -2, 10980, 79661], [4, 0, -1, 0, 10675, -34782], [0, 0, 3, 0, 10034, -23210],
  [4, 0, -2, 0, 8548, -21636], [2, 1, -1, 0, -7888, 24208], [2, 1, 0, 0, -6766, 30824],
  [1, 0, -1, 0, -5163, -8379], [1, 1, 0, 0, 4987, -16675], [2, -1, 1, 0, 4036, -12831],
  [2, 0, 2, 0, 3994, -10445], [4, 0, 0, 0, 3861, -11650], [2, 0, -3, 0, 3665, 14403],
  [0, 1, -2, 0, -2689, -7003], [2, 0, -1, 2, -2602, 0], [2, -1, -2, 0, 2390, 10056],
  [1, 0, 1, 0, -2348, 6322], [2, -2, 0, 0, 2236, -9884], [0, 1, 2, 0, -2120, 5751],
  [0, 2, 0, 0, -2069, 0], [2, -2, -1, 0, 2048, -4950], [2, 0, 1, -2, -1773, 4130],
  [2, 0, 0, 2, -1595, 0], [4, -1, -1, 0, 1215, -3958], [0, 0, 2, 2, -1110, 0],
  [3, 0, -1, 0, -892, 3258], [2, 1, 1, 0, -810, 2616], [4, -1, -2, 0, 759, -1897],
  [0, 2, -1, 0, -713, -2117], [2, 2, -1, 0, -700, 2354], [2, 1, -2, 0, 691, 0],
  [2, -1, 0, -2, 596, 0], [4, 0, 1, 0, 549, -1423], [0, 0, 4, 0, 537, -1117],
  [4, -1, 0, 0, 520, -1571], [1, 0, -2, 0, -487, -1739], [2, 1, 0, -2, -399, 0],
  [0, 0, 2, -2, -381, -4421], [1, 1, 1, 0, 351, 0], [3, 0, -2, 0, -340, 0],
  [4, 0, -3, 0, 330, 0], [2, -1, 2, 0, 327, 0], [0, 2, 1, 0, -323, 1165],
  [1, 1, -1, 0, 299, 0], [2, 0, 3, 0, 294, 0], [2, 0, -1, -2, 0, 8752],
];

/** Términos periódicos en latitud (10⁻⁶ °): D, M, M′, F, Σb. */
const B: readonly (readonly number[])[] = [
  [0, 0, 0, 1, 5128122], [0, 0, 1, 1, 280602], [0, 0, 1, -1, 277693], [2, 0, 0, -1, 173237],
  [2, 0, -1, 1, 55413], [2, 0, -1, -1, 46271], [2, 0, 0, 1, 32573], [0, 0, 2, 1, 17198],
  [2, 0, 1, -1, 9266], [0, 0, 2, -1, 8822], [2, -1, 0, -1, 8216], [2, 0, -2, -1, 4324],
  [2, 0, 1, 1, 4200], [2, 1, 0, -1, -3359], [2, -1, -1, 1, 2463], [2, -1, 0, 1, 2211],
  [2, -1, -1, -1, 2065], [0, 1, -1, -1, -1870], [4, 0, -1, -1, 1828], [0, 1, 0, 1, -1794],
  [0, 0, 0, 3, -1749], [0, 1, -1, 1, -1565], [1, 0, 0, 1, -1491], [0, 1, 1, 1, -1475],
  [0, 1, 1, -1, -1410], [0, 1, 0, -1, -1344], [1, 0, 0, -1, -1335], [0, 0, 3, 1, 1107],
  [4, 0, 0, -1, 1021], [4, 0, -1, 1, 833], [0, 0, 1, -3, 777], [4, 0, -2, 1, 671],
  [2, 0, 0, -3, 607], [2, 0, 2, -1, 596], [2, -1, 1, -1, 491], [2, 0, -2, 1, -451],
  [0, 0, 3, -1, 439], [2, 0, 2, 1, 422], [2, 0, -3, -1, 421], [2, 1, -1, 1, -366],
  [2, 1, 0, 1, -351], [4, 0, 0, 1, 331], [2, -1, 1, 1, 315], [2, -2, 0, -1, 302],
  [0, 0, 1, 3, -283], [2, 1, 1, -1, -229], [1, 1, 0, -1, 223], [1, 1, 0, 1, 223],
  [0, 1, -2, -1, -220], [2, 1, -1, -1, -220], [1, 0, 1, 1, -185], [2, -1, -2, -1, 181],
  [0, 1, 2, 1, -177], [4, 0, -2, -1, 176], [4, -1, -1, -1, 166], [1, 0, 1, -1, -164],
  [4, 0, 1, -1, 132], [1, 0, -1, -1, -119], [4, -1, 0, -1, 115], [2, -2, 0, 1, 107],
];

/** Polinomio en T (grados) → radianes. */
const poly = (T: number, ...c: number[]) => c.reduceRight((acc, k) => acc * T + k, 0) * DEG;

/**
 * Posición de la Luna relativa a la Tierra, eclíptica J2000 (km).
 * @param ttMs fecha en tiempo terrestre (`terrestrialTimeMs`).
 */
export function moonGeocentricPosition(ttMs: number): Vec3d {
  const T = julianCenturiesSinceJ2000(ttMs);
  // Argumentos fundamentales (cap. 47).
  const L = poly(T, 218.3164477, 481267.88123421, -0.0015786, 1 / 538841, -1 / 65194000);
  const D = poly(T, 297.8501921, 445267.1114034, -0.0018819, 1 / 545868, -1 / 113065000);
  const M = poly(T, 357.5291092, 35999.0502909, -0.0001536, 1 / 24490000);
  const Mp = poly(T, 134.9633964, 477198.8675055, 0.0087414, 1 / 69699, -1 / 14712000);
  const F = poly(T, 93.272095, 483202.0175233, -0.0036539, -1 / 3526000, 1 / 863310000);
  const A1 = (119.75 + 131.849 * T) * DEG;
  const A2 = (53.09 + 479264.29 * T) * DEG;
  const A3 = (313.45 + 481266.484 * T) * DEG;
  // Excentricidad de la órbita de la Tierra: corrige los términos con M.
  const E = 1 - 0.002516 * T - 0.0000074 * T * T;
  const ecc = (m: number) => (m === 0 ? 1 : Math.abs(m) === 1 ? E : E * E);

  let sl = 3958 * Math.sin(A1) + 1962 * Math.sin(L - F) + 318 * Math.sin(A2);
  let sr = 0;
  for (const [d, m, mp, f, l, r] of LR) {
    const arg = d * D + m * M + mp * Mp + f * F;
    const k = ecc(m);
    sl += l * k * Math.sin(arg);
    sr += r * k * Math.cos(arg);
  }
  let sb = -2235 * Math.sin(L) + 382 * Math.sin(A3) + 175 * Math.sin(A1 - F) + 175 * Math.sin(A1 + F)
    + 127 * Math.sin(L - Mp) - 115 * Math.sin(L + Mp);
  for (const [d, m, mp, f, b] of B) sb += b * ecc(m) * Math.sin(d * D + m * M + mp * Mp + f * F);

  const lon = L + sl * 1e-6 * DEG;
  const lat = sb * 1e-6 * DEG;
  const distanceKm = 385000.56 + sr * 1e-3;
  const [lon0, lat0] = precessToJ2000(lon, lat, T);
  const cb = Math.cos(lat0);
  return {
    x: distanceKm * cb * Math.cos(lon0),
    y: distanceKm * cb * Math.sin(lon0),
    z: distanceKm * Math.sin(lat0),
  };
}

/**
 * Coordenadas eclípticas de la fecha (época T, siglos desde J2000) → eclíptica J2000.
 * Meeus (21.5) y (21.7), con t = −T: precesión general (p), inclinación de la eclíptica (η)
 * y longitud de su nodo (Π).
 */
function precessToJ2000(lon: number, lat: number, T: number): [number, number] {
  const t = -T;
  const eta = ((47.0029 - 0.06603 * T + 0.000598 * T * T) * t + (-0.03302 + 0.000598 * T) * t * t + 0.00006 * t * t * t) * ARCSEC;
  const Pi = 174.876384 * DEG + (3289.4789 * T + 0.60622 * T * T - (869.8089 + 0.50491 * T) * t + 0.03536 * t * t) * ARCSEC;
  const p = ((5029.0966 + 2.22226 * T - 0.000042 * T * T) * t + (1.11113 - 0.000042 * T) * t * t - 0.000006 * t * t * t) * ARCSEC;
  const ce = Math.cos(eta), se = Math.sin(eta);
  const cb = Math.cos(lat), sb = Math.sin(lat);
  const a = ce * cb * Math.sin(Pi - lon) - se * sb;
  const b = cb * Math.cos(Pi - lon);
  const c = ce * sb + se * cb * Math.sin(Pi - lon);
  return [p + Pi - Math.atan2(a, b), Math.asin(c)];
}
