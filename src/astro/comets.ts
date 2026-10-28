/**
 * Cometas: órbitas de dos cuerpos con los elementos osculantes de JPL y su actividad.
 * Ver docs/ARQUITECTURA.md §5.
 *
 * - Elementos: osculantes de JPL Horizons en el perihelio de la aparición más conocida de
 *   cada uno (consultados el 28/10/2026), heliocéntricos y en la eclíptica J2000: q, e, i, Ω,
 *   ω y el paso por el perihelio. Con los de la Small-Body Database (otra época) el Halley de
 *   1986 se desviaba 5 millones de km y el Hale-Bopp de 1997, 10. Sin perturbaciones de los
 *   planetas entre perihelios: los periódicos llevan los elementos de cada vuelta.
 * - Magnitud total (M1, K1): JPL Small-Body Database.
 * - Órbitas casi parabólicas (e = 0,999) e hiperbólicas (Tsuchinshan-ATLAS, e = 1,0001; 3I/ATLAS,
 *   e = 6,1): Kepler con Newton acotado (siempre converge) en cada tipo de cónica.
 * - Actividad: la distancia al Sol y los parámetros de magnitud total de JPL (M1, K1).
 */
import { COMET_APPARITIONS } from './cometApparitions';
import type { Vec3d } from './frames';
import { AU_KM, DEG } from './units';

export type CometId = 'halley' | 'encke' | 'churyumov' | 'halebopp' | 'neowise' | 'tsuchinshan' | 'atlas3i' | 'bok';

export interface CometElements {
  /** Distancia del perihelio (UA). */
  q: number;
  e: number;
  /** Inclinación, nodo ascendente y argumento del perihelio (grados, eclíptica J2000). */
  i: number;
  node: number;
  peri: number;
  /** Paso por el perihelio (día juliano, TDB). */
  tpJd: number;
  /** Magnitud total absoluta y pendiente con la distancia al Sol (JPL). */
  M1: number;
  K1: number;
}

export const COMET_ELEMENTS: Record<CometId, CometElements> = {
  halley: { q: 0.5871034491008432, e: 0.9672789745835961, i: 162.2422228451626, node: 58.85994844633058, peri: 111.8655545869128, tpJd: 2446470.958959429, M1: 5.5, K1: 8 },
  encke: { q: 0.3385804955897938, e: 0.8473363622700875, i: 11.34783977344798, node: 334.0193988136045, peri: 187.2888960167725, tpJd: 2461446.726857019, M1: 15.7, K1: 4.5 },
  churyumov: { q: 1.210612534258476, e: 0.649705098850551, i: 3.87168481716903, node: 36.33532737511299, peri: 22.1315389971998, tpJd: 2459520.562505548, M1: 12.9, K1: 7.5 },
  halebopp: { q: 0.9141695067003724, e: 0.9951314746156615, i: 89.43017155012492, node: 282.470602866853, peri: 130.5872524854533, tpJd: 2450539.633099368, M1: 4.8, K1: 4 },
  neowise: { q: 0.2946512466331692, e: 0.9991782081129224, i: 128.9375043020912, node: 61.01042991771634, peri: 37.2786526292898, tpJd: 2459034.178897282, M1: 12.1, K1: 12.25 },
  tsuchinshan: { q: 0.3914228969473201, e: 1.000020192843204, i: 139.1105462619597, node: 21.55945689079267, peri: 308.4913086299738, tpJd: 2460581.242087111, M1: 8.9, K1: 5.5 },
  atlas3i: { q: 1.356449295925803, e: 6.139342010009094, i: 175.1130276865332, node: 322.1556411516636, peri: 128.0075351321378, tpJd: 2460977.98235001, M1: 11.8, K1: 7.5 },
  bok: { q: 1.937779665277091, e: 0.9976675823523535, i: 82.3068194794615, node: 206.5869755068522, peri: 155.9390734707209, tpJd: 2461396.855735301, M1: 9.2, K1: 12 },
};

/**
 * Otras apariciones de los periódicos (Halley, Encke y 67P, de 1900 a 2100), con sus elementos
 * osculantes de Horizons en cada perihelio (`cometApparitions.ts`, generado): con dos cuerpos
 * desde 1986 el Halley volvía en febrero de 2062 en vez del 28 de julio de 2061 (los planetas
 * lo frenan). Cada fecha usa la aparición con el perihelio más cercano (`cometElementsAt`).
 */
const APPARITIONS = COMET_APPARITIONS;

/** Los elementos de la aparición con el perihelio más cercano a la fecha. */
export function cometElementsAt(id: CometId, ttMs: number): CometElements {
  const base = COMET_ELEMENTS[id];
  let best = base, bestGap = Math.abs(jdToMs(base.tpJd) - ttMs);
  for (const a of APPARITIONS[id] ?? []) {
    const gap = Math.abs(jdToMs(a.tpJd) - ttMs);
    if (gap < bestGap) [best, bestGap] = [{ ...base, ...a }, gap];
  }
  return best;
}

/** GM del Sol (km³/s²) y constante de Gauss (rad/día con UA). */
export const GM_SUN = 1.32712440018e11;
const GAUSS_K = 0.01720209895;
const MS_PER_DAY = 86_400_000;
const JD_UNIX = 2440587.5;

export const jdToMs = (jd: number) => (jd - JD_UNIX) * MS_PER_DAY;

/** Periodo (días), o null si la órbita no es cerrada. */
export function cometPeriodDays(el: CometElements): number | null {
  if (el.e >= 1) return null;
  const a = el.q / (1 - el.e);
  return (2 * Math.PI) / (GAUSS_K / Math.pow(a, 1.5));
}

/** Newton acotado para una f creciente en [lo, hi] (siempre converge). */
function solveMonotone(f: (x: number) => number, df: (x: number) => number, lo: number, hi: number, x: number): number {
  for (let iter = 0; iter < 100; iter++) {
    const fx = f(x);
    if (fx > 0) hi = x;
    else lo = x;
    let next = x - fx / df(x);
    // Si Newton se sale del intervalo, bisección.
    if (!(next > lo && next < hi)) next = (lo + hi) / 2;
    if (Math.abs(next - x) < 1e-14 * Math.max(1, Math.abs(x))) return next;
    x = next;
  }
  return x;
}

/** Posición en el plano orbital (UA) a `days` del perihelio: x hacia el perihelio. */
function orbitalPlane(el: CometElements, days: number): { x: number; y: number } {
  const { q, e } = el;
  if (e < 1) {
    const a = q / (1 - e);
    const n = GAUSS_K / Math.pow(a, 1.5);
    let M = (n * days) % (2 * Math.PI);
    if (M > Math.PI) M -= 2 * Math.PI;
    if (M < -Math.PI) M += 2 * Math.PI;
    // E − e·sin E = M, creciente en [−π, π].
    const E = solveMonotone((E) => E - e * Math.sin(E) - M, (E) => 1 - e * Math.cos(E), -Math.PI, Math.PI, M + 0.85 * e * Math.sign(Math.sin(M) || 1));
    return { x: a * (Math.cos(E) - e), y: a * Math.sqrt(1 - e * e) * Math.sin(E) };
  }
  // Hipérbola: e·sinh H − H = M, con |a| = q / (e − 1).
  const A = q / (e - 1);
  const M = (GAUSS_K / Math.pow(A, 1.5)) * days;
  const span = Math.asinh(Math.abs(M) / (e - 1)) + 1;
  const H = solveMonotone((H) => e * Math.sinh(H) - H - M, (H) => e * Math.cosh(H) - 1, -span, span, Math.asinh(M / e));
  return { x: A * (e - Math.cosh(H)), y: A * Math.sqrt(e * e - 1) * Math.sinh(H) };
}

/** Del plano orbital a la eclíptica J2000 (ω, Ω, i). */
function toEcliptic(el: CometElements, x: number, y: number): Vec3d {
  const w = el.peri * DEG, O = el.node * DEG, i = el.i * DEG;
  const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(O), sO = Math.sin(O), ci = Math.cos(i), si = Math.sin(i);
  return {
    x: ((cw * cO - sw * sO * ci) * x + (-sw * cO - cw * sO * ci) * y) * AU_KM,
    y: ((cw * sO + sw * cO * ci) * x + (-sw * sO + cw * cO * ci) * y) * AU_KM,
    z: (sw * si * x + cw * si * y) * AU_KM,
  };
}

/** Posición heliocéntrica, eclíptica J2000 (km). `ttMs` en tiempo terrestre. */
export function cometPosition(el: CometElements, ttMs: number): Vec3d {
  const days = ttMs / MS_PER_DAY + JD_UNIX - el.tpJd;
  const p = orbitalPlane(el, days);
  return toEcliptic(el, p.x, p.y);
}

/** Velocidad (km/s) por diferencias centradas de ±30 s (de sobra en float64). */
export function cometVelocity(el: CometElements, ttMs: number): Vec3d {
  const a = cometPosition(el, ttMs - 30_000), b = cometPosition(el, ttMs + 30_000);
  return { x: (b.x - a.x) / 60, y: (b.y - a.y) / 60, z: (b.z - a.z) / 60 };
}

/**
 * Punto de la órbita para un ángulo de anomalía (excéntrica en las elipses, hiperbólica en
 * las hipérbolas): posición (km) y días respecto al perihelio. Para dibujar la órbita con los
 * puntos repartidos por la curva y no por el tiempo (cerca del Sol pasa en días).
 */
export function cometOrbitPoint(el: CometElements, anomaly: number): { position: Vec3d; days: number } {
  const { q, e } = el;
  if (e < 1) {
    const a = q / (1 - e);
    const n = GAUSS_K / Math.pow(a, 1.5);
    return {
      position: toEcliptic(el, a * (Math.cos(anomaly) - e), a * Math.sqrt(1 - e * e) * Math.sin(anomaly)),
      days: (anomaly - e * Math.sin(anomaly)) / n,
    };
  }
  const A = q / (e - 1);
  return {
    position: toEcliptic(el, A * (e - Math.cosh(anomaly)), A * Math.sqrt(e * e - 1) * Math.sinh(anomaly)),
    days: (e * Math.sinh(anomaly) - anomaly) / (GAUSS_K / Math.pow(A, 1.5)),
  };
}

/** Anomalía a la que la órbita llega a `rAU` del Sol (para cortar las muy largas). */
export function anomalyAtDistance(el: CometElements, rAU: number): number {
  const { q, e } = el;
  if (e < 1) {
    const a = q / (1 - e);
    const c = (1 - rAU / a) / e;
    return c <= -1 ? Math.PI : Math.acos(Math.min(1, c));
  }
  const A = q / (e - 1);
  return Math.acosh(Math.max(1, (rAU / A + 1) / e));
}

/**
 * Actividad (0–1): cuánta coma y cola tiene a una distancia del Sol. Escala artística:
 * - el hielo de agua se sublima por dentro de unas 5 UA (puerta con la distancia),
 * - el brillo de JPL a esa distancia, H = M1 + 2,5·K1·log r (NEOWISE en su perihelio, −4;
 *   Bok, 18), lo sube hasta 1 en los grandes cometas,
 * - y un mínimo cerca del perihelio para que los débiles (67P, Encke, 3I, Bok) también se
 *   vean al pasar por él: con solo su brillo apenas tendrían cola.
 */
export function cometActivity(el: CometElements, sunDistanceKm: number): number {
  const r = Math.max(sunDistanceKm / AU_KM, 0.05);
  const smooth = (e0: number, e1: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };
  const gate = smooth(5, 0.8, r);
  const H = el.M1 + 2.5 * el.K1 * Math.log10(r);
  const glow = smooth(19, 2, H);
  const floor = 0.4 * smooth(2.2 * el.q, 1.2 * el.q, r);
  return gate * Math.max(glow, floor);
}

/**
 * Próximo (o anterior) paso por el perihelio desde una fecha (ms). Si hay una aparición
 * conocida a menos de un periodo y medio, la suya; si no, se cuenta de periodo en periodo.
 */
export function perihelionNear(id: CometId, fromMs: number, direction: 1 | -1): number | null {
  const el = cometElementsAt(id, fromMs);
  const period = cometPeriodDays(el);
  const ahead = (t: number) => (direction > 0 ? t >= fromMs : t <= fromMs);
  const known = [COMET_ELEMENTS[id], ...(APPARITIONS[id] ?? [])].map((a) => jdToMs(a.tpJd)).filter(ahead)
    .sort((a, b) => (a - b) * direction)[0];
  if (period === null || period > 3e5) return known ?? null;
  const P = period * MS_PER_DAY;
  if (known !== undefined && Math.abs(known - fromMs) < 1.5 * P) return known;
  const tp = jdToMs(el.tpJd);
  const k = direction > 0 ? Math.ceil((fromMs - tp) / P) : Math.floor((fromMs - tp) / P);
  return tp + k * P;
}

/**
 * Dos cuerpos desde un estado (km, km/s) durante `dt` s con `mu`: variables universales
 * (Curtis, alg. 3.3–3.4) con las funciones de Stumpff. Para el polvo de la cola, que sale
 * del núcleo y nota la gravedad del Sol rebajada por la presión de la luz.
 */
export function propagateUniversal(r0: Vec3d, v0: Vec3d, dt: number, mu: number): Vec3d {
  const r0n = Math.hypot(r0.x, r0.y, r0.z);
  const vr0 = (r0.x * v0.x + r0.y * v0.y + r0.z * v0.z) / r0n;
  const alpha = 2 / r0n - (v0.x * v0.x + v0.y * v0.y + v0.z * v0.z) / mu;
  const sqmu = Math.sqrt(mu);
  let chi = sqmu * Math.abs(alpha) * dt;
  if (!Number.isFinite(chi) || chi === 0) chi = (sqmu * dt) / r0n;
  for (let i = 0; i < 60; i++) {
    const z = alpha * chi * chi;
    const C = stumpffC(z), S = stumpffS(z);
    const F = ((r0n * vr0) / sqmu) * chi * chi * C + (1 - alpha * r0n) * chi * chi * chi * S + r0n * chi - sqmu * dt;
    const dF = ((r0n * vr0) / sqmu) * chi * (1 - z * S) + (1 - alpha * r0n) * chi * chi * C + r0n;
    const step = F / dF;
    chi -= step;
    if (Math.abs(step) < 1e-9 * Math.max(1, Math.abs(chi))) break;
  }
  const z = alpha * chi * chi;
  const f = 1 - ((chi * chi) / r0n) * stumpffC(z);
  const g = dt - (chi * chi * chi / sqmu) * stumpffS(z);
  return { x: f * r0.x + g * v0.x, y: f * r0.y + g * v0.y, z: f * r0.z + g * v0.z };
}

function stumpffS(z: number): number {
  if (z > 1e-6) { const s = Math.sqrt(z); return (s - Math.sin(s)) / (s * s * s); }
  if (z < -1e-6) { const s = Math.sqrt(-z); return (Math.sinh(s) - s) / (s * s * s); }
  return 1 / 6 - z / 120;
}

function stumpffC(z: number): number {
  if (z > 1e-6) return (1 - Math.cos(Math.sqrt(z))) / z;
  if (z < -1e-6) return (Math.cosh(Math.sqrt(-z)) - 1) / -z;
  return 1 / 2 - z / 24;
}
