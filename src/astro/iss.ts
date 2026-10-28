/**
 * Posición de la Estación Espacial Internacional. Ver docs/ARQUITECTURA.md §5.
 *
 * SGP4 (`satellite.js`) sobre el último TLE: el modelo con el que NORAD publica los
 * elementos y el único que los reproduce (con dos cuerpos y J2 la ISS se desvía cientos de
 * km en horas, por el rozamiento). SGP4 da la posición en TEME; se pasa al marco fijo de la
 * Tierra con el mismo tiempo sidéreo que la gira en la escena, y de ahí a la eclíptica con
 * la orientación de la Tierra de la fecha: así pasa por encima del sitio correcto del mapa.
 *
 * Un TLE vale para unos días. Lejos de su época (> 14 días) la posición es aproximada: el
 * plano y la altura son los de la estación, pero no en qué punto de la órbita está. Más allá
 * de unos meses se propaga sin rozamiento (si no, SGP4 la haría reentrar).
 */
import { eciToEcf, gstime, propagate, twoline2satrec, type SatRec } from './sgp4';
import { BODIES } from './bodies';
import { eclipticFromBodyFixed } from './ephemeris';
import type { Vec3d } from './frames';

/** TLE de CelesTrak (NORAD 25544) del 27/10/2026. Lo renueva `refreshIssTle` si hay red. */
const EMBEDDED_TLE: [string, string] = [
  '1 25544U 98067A   26300.82187419  .00005456  00000+0  10681-3 0  9999',
  '2 25544  51.6336   3.7485 0007015 317.3678  42.6766 15.49080514592319',
];

/** En órbita desde el 20/11/1998 (Zariá); su retirada está prevista para 2030. */
export const ISS_SERVICE = { fromMs: Date.UTC(1998, 10, 20), toMs: Date.UTC(2031, 0, 1) };

/** Más allá de estos días desde la época, sin rozamiento: con él SGP4 la baja hasta reentrar en unos meses. */
const DRAG_DAYS = 60;

let tle = EMBEDDED_TLE;
let withDrag: SatRec = twoline2satrec(...tle);
let noDrag: SatRec = twoline2satrec(...withoutDrag(tle));

/** El mismo TLE sin rozamiento (B* y ṅ a cero). */
function withoutDrag([l1, l2]: [string, string]): [string, string] {
  // Columnas del TLE: ṅ/2 en 34–43 y B* en 54–61.
  return [`${l1.slice(0, 33)} .00000000${l1.slice(43, 53)} 00000+0${l1.slice(61)}`, l2];
}

/** Época del TLE en uso (ms UTC). */
function issEpochMs(): number {
  return (withDrag.jdsatepoch - 2440587.5) * 86_400_000;
}

/** Posición relativa a la Tierra, eclíptica J2000 (km), con `timeMs` en UTC. */
export function issGeocentricPosition(timeMs: number): Vec3d {
  const date = new Date(timeMs);
  const far = Math.abs(timeMs - issEpochMs()) > DRAG_DAYS * 86_400_000;
  const pv = propagate(far ? noDrag : withDrag, date) ?? propagate(noDrag, date);
  const p = pv?.position;
  if (!p || typeof p === 'boolean') return { x: 6_790, y: 0, z: 0 };
  // TEME → marco fijo de la Tierra (x hacia lon 0°, z al norte) con el tiempo sidéreo…
  const ecf = eciToEcf(p, gstime(date));
  // …y de ahí a la eclíptica con la orientación que dibuja la escena (y = polo, este = −z).
  return eclipticFromBodyFixed(BODIES.earth, timeMs, { x: ecf.x, y: ecf.z, z: -ecf.y });
}

const CACHE_KEY = 'particles.issTle';
const CACHE_HOURS = 12;

/**
 * Pide el TLE actual a CelesTrak (permite CORS) y, si es más nuevo, lo usa. Se guarda 12 h
 * en el navegador para no repetir la petición en cada visita. Sin red, se queda el incluido.
 */
export async function refreshIssTle(): Promise<boolean> {
  let cached: { at: number; lines: [string, string] } | null = null;
  try {
    cached = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null');
  } catch {
    cached = null;
  }
  let lines = cached && Date.now() - cached.at < CACHE_HOURS * 3600_000 ? cached.lines : null;
  if (!lines) {
    try {
      const response = await fetch('https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=tle', { signal: AbortSignal.timeout(5000) });
      const text = (await response.text()).split('\n').map((l) => l.trimEnd());
      const l1 = text.find((l) => l.startsWith('1 25544')), l2 = text.find((l) => l.startsWith('2 25544'));
      if (!response.ok || !l1 || !l2) return false;
      lines = [l1, l2];
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), lines }));
      } catch {
        // Sin almacenamiento: se volverá a pedir en la próxima visita.
      }
    } catch {
      return false;
    }
  }
  const next = twoline2satrec(...lines);
  if (next.error || next.jdsatepoch <= withDrag.jdsatepoch) return false;
  tle = lines;
  withDrag = next;
  noDrag = twoline2satrec(...withoutDrag(tle));
  return true;
}
