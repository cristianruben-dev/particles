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
