/**
 * Formato de cifras, distancias y fechas en español para la UI.
 */
import { AU_KM, LY_KM } from '../astro/units';

export interface Quantity {
  value: string;
  unit: string;
}

const num = (x: number, digits: number) => x.toLocaleString('es', { maximumFractionDigits: digits, minimumFractionDigits: 0 });

/** Distancia con su unidad separada (para maquetarlas por separado). */
export function distanceParts(km: number): Quantity {
  // Fuera del sistema solar (§14), en años luz.
  const ly = km / LY_KM;
  if (ly >= 1e6) return { value: num(ly / 1e6, 2), unit: 'M a. l.' };
  if (ly >= 0.05) return { value: num(ly, ly >= 100 ? 0 : ly >= 10 ? 1 : 2), unit: 'a. l.' };
  if (km >= 0.1 * AU_KM) return { value: num(km / AU_KM, km >= 10 * AU_KM ? 1 : 2), unit: 'UA' };
  if (km >= 1e6) return { value: num(km / 1e6, 2), unit: 'M km' };
  if (km >= 100) return { value: num(Math.round(km), 0), unit: 'km' };
  if (km >= 1) return { value: num(km, 1), unit: 'km' };
  return { value: num(km * 1000, km < 0.1 ? 1 : 0), unit: 'm' };
}

export function formatDistance(km: number): string {
  const { value, unit } = distanceParts(km);
  return `${value} ${unit}`;
}

/** Velocidad (km/s) con la unidad más legible. */
export function speedParts(kmS: number): Quantity {
  if (kmS >= 0.1 * AU_KM) return { value: num(kmS / AU_KM, 2), unit: 'UA/s' };
  if (kmS >= 1) return { value: num(kmS, kmS >= 100 ? 0 : 1), unit: 'km/s' };
  return { value: num(kmS * 1000, kmS >= 0.01 ? 0 : 1), unit: 'm/s' };
}

/** Duración en días, horas y minutos (p. ej. «23 h 56 min», «687 días»). */
export function formatDuration(hours: number): string {
  const h = Math.abs(hours);
  if (h >= 24 * 365.25 * 2) return `${num(h / (24 * 365.25), 1)} años`;
  if (h >= 24 * 3) return `${num(h / 24, h >= 24 * 1000 ? 0 : 1)} días`;
  if (h >= 48) return `${num(h / 24, 1)} días`;
  let whole = Math.floor(h);
  let min = Math.round((h - whole) * 60);
  if (min === 60) [whole, min] = [whole + 1, 0];
  if (!whole) return `${min} min`;
  return min ? `${whole} h ${min} min` : `${whole} h`;
}

/** Tiempo que tarda la luz en recorrer una distancia. */
export function lightTime(km: number): string {
  const s = km / 299_792.458;
  if (s < 1) return `${num(s * 1000, 0)} ms`;
  if (s < 60) return `${num(s, 1)} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
  return `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`;
}

/** Notación científica legible: 5,97 × 10²⁴. */
export function scientific(x: number, digits = 3): string {
  const exp = Math.floor(Math.log10(Math.abs(x)));
  const mantissa = x / 10 ** exp;
  const sup = String(exp).split('').map((c) => '⁰¹²³⁴⁵⁶⁷⁸⁹'['0123456789'.indexOf(c)] ?? (c === '-' ? '⁻' : c)).join('');
  return `${mantissa.toLocaleString('es', { maximumSignificantDigits: digits })} × 10${sup}`;
}

const DATE_FORMAT = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** «27 oct 2026» y «14:32:07» en UTC. */
export function dateParts(date: Date): { day: string; time: string } {
  const iso = date.toISOString();
  return { day: DATE_FORMAT.format(date).replace('.', ''), time: iso.slice(11, 19) };
}
