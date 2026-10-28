/**
 * Apariciones de los cometas periódicos → src/astro/cometApparitions.ts (docs/ARQUITECTURA.md §5.2).
 *
 * Uso: node scripts/build-comet-apparitions.mjs
 *
 * Para cada cometa y cada aparición entre 1900 y 2100, los elementos osculantes de JPL
 * Horizons en su paso por el perihelio (heliocéntricos, eclíptica J2000):
 * - las apariciones observadas tienen su propia solución en Horizons (`DES=2P;CAP<año`): se
 *   usa la de cada una, que es la que mejor la reproduce;
 * - en los huecos (antes de la primera, entre dos sin las de en medio y después de la última),
 *   Horizons integra la solución más cercana (con los planetas y las fuerzas no
 *   gravitatorias): se muestrea cada 1/24 de periodo y cada valor distinto de Tp es un paso por
 *   el perihelio.
 * Con dos cuerpos y una sola aparición, el perihelio se desviaba días al alejarse de ella.
 */
import { writeFileSync } from 'node:fs';

const API = 'https://ssd.jpl.nasa.gov/api/horizons.api';
const FROM = 1900, TO = 2100;
const COMETS = [
  // Cada cuántos años se busca la aparición anterior (menos que medio periodo).
  { id: 'halley', des: '1P', scanYears: 20 },
  { id: 'encke', des: '2P', scanYears: 1 },
  { id: 'churyumov', des: '67P', scanYears: 2 },
];

const jdOfYear = (y) => 2451545.0 + (y - 2000) * 365.25;

async function horizons(params) {
  // Valores entre comillas (llevan espacios, `;` y `<`), salvo el formato.
  const query = ['format=text', ...Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(`'${v}'`)}`)].join('&');
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${API}?${query}`);
    if (res.ok) return res.text();
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
  throw new Error(`Horizons no responde: ${query}`);
}

/** Registro (solución) de la última aparición antes de `year`, o null si no hay. */
async function apparitionBefore(des, year) {
  const text = await horizons({ COMMAND: `DES=${des};CAP<${year}`, OBJ_DATA: 'YES', MAKE_EPHEM: 'NO' });
  const rec = text.match(/Rec #:\s*(\d+)/);
  const tp = text.match(/TP=\s*([\d.]+)/);
  return rec && tp ? { record: rec[1], tpJd: Number(tp[1]) } : null;
}

/** Elementos osculantes de un registro en una lista de fechas (JD TDB). */
async function elements(record, jds) {
  const out = [];
  // La API admite listas de fechas; en tandas para no pasarse de longitud de URL.
  for (let k = 0; k < jds.length; k += 40) {
    const text = await horizons({
      COMMAND: `${record};`, EPHEM_TYPE: 'ELEMENTS', CENTER: '500@10', REF_PLANE: 'ECLIPTIC', REF_SYSTEM: 'J2000',
      TLIST: jds.slice(k, k + 40).map((j) => j.toFixed(6)).join(' '), TLIST_TYPE: 'JD', CSV_FORMAT: 'YES', OUT_UNITS: 'AU-D',
      OBJ_DATA: 'NO',
    });
    const body = text.split('$$SOE')[1]?.split('$$EOE')[0];
    if (!body) throw new Error(`Sin elementos para ${record}:\n${text.slice(0, 2000)}`);
    for (const line of body.trim().split('\n')) {
      // JDTDB, fecha, EC, QR, IN, OM, W, Tp, N, MA, TA, A, AD, PR
      const c = line.split(',').map((s) => s.trim());
      out.push({ jd: +c[0], e: +c[2], q: +c[3], i: +c[4], node: +c[5], peri: +c[6], tpJd: +c[7], periodDays: +c[13] });
    }
  }
  return out;
}

/** Pasos por el perihelio (Tp) que integra un registro dentro de [a, b] (JD). */
async function perihelia(record, a, b, periodDays) {
  const step = periodDays / 24;
  const jds = [];
  for (let jd = a; jd <= b; jd += step) jds.push(jd);
  const tps = [];
  for (const el of await elements(record, jds)) {
    if (el.tpJd < a || el.tpJd > b) continue;
    if (!tps.some((t) => Math.abs(t - el.tpJd) < periodDays / 4)) tps.push(el.tpJd);
  }
  return tps;
}

const result = {};
for (const { id, des, scanYears } of COMETS) {
  // 1. Apariciones observadas (cada una con su solución).
  const observed = new Map();
  for (let y = FROM + 1; y <= TO + scanYears; y += scanYears) {
    const app = await apparitionBefore(des, y);
    if (app && !observed.has(app.record)) {
      observed.set(app.record, app);
      console.log(`${des}: aparición ${app.tpJd} (registro ${app.record})`);
    }
  }
  const apps = [...observed.values()].sort((a, b) => a.tpJd - b.tpJd);
  if (!apps.length) throw new Error(`Sin apariciones de ${des}`);
  // Elementos de cada aparición observada en su perihelio, con su propia solución.
  const known = [];
  for (const app of apps) known.push({ app, el: (await elements(app.record, [app.tpJd]))[0] });
  const list = known.map((k) => k.el).filter((el) => el.tpJd >= jdOfYear(FROM) && el.tpJd <= jdOfYear(TO));
  // 2. Los huecos (antes de la primera, entre dos observadas sin las de en medio y después de
  // la última): lo que integra Horizons desde la solución más cercana.
  const spans = [];
  const P0 = known[0].el.periodDays, Pn = known[known.length - 1].el.periodDays;
  spans.push([known[0].app.record, jdOfYear(FROM), known[0].el.tpJd - P0 / 2, P0]);
  for (let k = 0; k + 1 < known.length; k++) {
    const a = known[k], b = known[k + 1];
    if (b.el.tpJd - a.el.tpJd < 1.5 * a.el.periodDays) continue;
    // Cada mitad desde su solución, solapadas un cuarto de periodo: un perihelio justo en la
    // mitad no se pierde (los repetidos se quitan al final).
    const mid = (a.el.tpJd + b.el.tpJd) / 2, overlap = a.el.periodDays / 4;
    spans.push([a.app.record, a.el.tpJd + a.el.periodDays / 2, mid + overlap, a.el.periodDays]);
    spans.push([b.app.record, mid - overlap, b.el.tpJd - b.el.periodDays / 2, b.el.periodDays]);
  }
  spans.push([known[known.length - 1].app.record, known[known.length - 1].el.tpJd + Pn / 2, jdOfYear(TO), Pn]);
  for (const [record, a, b, P] of spans) {
    if (b <= a) continue;
    const tps = await perihelia(record, a, b, P);
    if (tps.length) list.push(...(await elements(record, tps)));
  }
  list.sort((a, b) => a.tpJd - b.tpJd);
  // Una por perihelio (dos soluciones pueden dar el mismo).
  result[id] = list.filter((el, k) => k === 0 || el.tpJd - list[k - 1].tpJd > el.periodDays / 4);
  console.log(`${des}: ${result[id].length} apariciones entre ${FROM} y ${TO}`);
}

const fmt = (el) =>
  `  { q: ${el.q}, e: ${el.e}, i: ${el.i}, node: ${el.node}, peri: ${el.peri}, tpJd: ${el.tpJd} },`;
const ts = `/**
 * Apariciones de los cometas periódicos entre ${FROM} y ${TO}: elementos osculantes de JPL Horizons
 * en cada paso por el perihelio (heliocéntricos, eclíptica J2000). Generado por
 * \`scripts/build-comet-apparitions.mjs\` el ${new Date().toISOString().slice(0, 10)}: no editar a mano.
 */
import type { CometElements, CometId } from './comets';

export const COMET_APPARITIONS: Partial<Record<CometId, Omit<CometElements, 'M1' | 'K1'>[]>> = {
${Object.entries(result).map(([id, list]) => `  ${id}: [\n${list.map((el) => '  ' + fmt(el)).join('\n')}\n  ],`).join('\n')}
};
`;
writeFileSync(new URL('../src/astro/cometApparitions.ts', import.meta.url), ts);
console.log('Escrito src/astro/cometApparitions.ts');
