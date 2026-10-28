/**
 * Constantes y conversiones de tiempo/distancia. Ver docs/ARQUITECTURA.md §5.
 * Todas las distancias "verdaderas" del proyecto están en kilómetros (float64).
 */

/** Unidad astronómica en km. */
export const AU_KM = 149_597_870.7;

/** Época J2000.0 (2000-01-01 12:00 TT) en milisegundos Unix. */
export const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0);

export const SECONDS_PER_DAY = 86_400;
export const DAYS_PER_CENTURY = 36_525;

export const DEG = Math.PI / 180;

/** Siglos julianos desde J2000 para una fecha (ms Unix). */
export function julianCenturiesSinceJ2000(timeMs: number): number {
  return (timeMs - J2000_MS) / (SECONDS_PER_DAY * 1000 * DAYS_PER_CENTURY);
}

/** Días desde J2000 para una fecha (ms Unix). */
export function daysSinceJ2000(timeMs: number): number {
  return (timeMs - J2000_MS) / (SECONDS_PER_DAY * 1000);
}

/**
 * ΔT = TT − UT (s): las efemérides van en tiempo terrestre y el reloj en UTC (el giro de la
 * Tierra, GMST, sí va en UT). Valores medidos (IERS) interpolados; fuera de la tabla, el extremo.
 * En 2026 son unos 69 s: la Luna recorre en ese tiempo 70 km y la sombra de un eclipse otro tanto.
 */
const DELTA_T: readonly [number, number][] = [
  [1800, 13.7], [1850, 7.1], [1900, -2.7], [1920, 21.2], [1950, 29.1], [1970, 40.2],
  [1980, 50.5], [1990, 56.9], [2000, 63.8], [2010, 66.1], [2020, 69.4], [2025, 69.2],
];

export function deltaTSeconds(utcMs: number): number {
  const year = 2000 + (utcMs - J2000_MS) / (SECONDS_PER_DAY * 1000 * 365.25);
  if (year <= DELTA_T[0][0]) return DELTA_T[0][1];
  for (let i = 1; i < DELTA_T.length; i++) {
    const [y1, v1] = DELTA_T[i];
    if (year <= y1) {
      const [y0, v0] = DELTA_T[i - 1];
      return v0 + ((v1 - v0) * (year - y0)) / (y1 - y0);
    }
  }
  return DELTA_T[DELTA_T.length - 1][1];
}

/** Fecha en tiempo terrestre (ms, en la misma escala que `J2000_MS`) para una fecha UTC. */
export function terrestrialTimeMs(utcMs: number): number {
  return utcMs + deltaTSeconds(utcMs) * 1000;
}
