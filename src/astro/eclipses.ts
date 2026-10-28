/**
 * Eclipses y tránsitos de sombra: la geometría de la sombra (en km verdaderos, nunca en
 * unidades de escena) y la búsqueda de los próximos. Ver docs/ARQUITECTURA.md §5.3.
 *
 * La escala comprimida deforma las distancias (la Luna queda ~7 veces más cerca de la
 * Tierra, en proporción a su tamaño), así que la sombra se calcula siempre con las
 * posiciones y radios reales: cae donde y cuando cae de verdad. `sunCoverage` es la misma
 * fórmula que usan los shaders (`bodies/Shadows.ts`).
 */
import { BODIES, type BodyId } from './bodies';
import { bodyFixedFromEcliptic, heliocentricKm, latLonOf } from './ephemeris';
import type { Vec3d } from './frames';

export const SUN_RADIUS_KM = BODIES.sun.radiusKm;

/**
 * Ampliación de la sombra de la Tierra por su atmósfera (regla de Danjon, 1/85 del radio).
 * Por ella la Luna eclipsada no desaparece: le llega luz roja refractada.
 */
export const EARTH_SHADOW_ENLARGEMENT = 1 + 1 / 85;

/** Radio efectivo de un cuerpo como ocultador (km). */
export function occluderRadiusKm(id: BodyId): number {
  return BODIES[id].radiusKm * (id === 'earth' ? EARTH_SHADOW_ENLARGEMENT : 1);
}

const sub = (a: Vec3d, b: Vec3d): Vec3d => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: Vec3d, b: Vec3d) => a.x * b.x + a.y * b.y + a.z * b.z;
const len = (a: Vec3d) => Math.hypot(a.x, a.y, a.z);
const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/**
 * Fracción del disco del Sol que tapa un ocultador visto desde un punto (0–1).
 * Todo en las mismas unidades (en los shaders, radios del cuerpo que recibe la sombra).
 * @param sunDir dirección unitaria hacia el Sol (la misma en todo el cuerpo).
 * @param sunAngle radio angular del Sol (rad).
 */
export function sunCoverage(point: Vec3d, occluder: Vec3d, occluderRadius: number, sunDir: Vec3d, sunAngle: number): number {
  const to = sub(occluder, point);
  const d = len(to);
  const a = Math.asin(Math.min(occluderRadius / d, 1));
  // Ángulo entre los centros con atan2(|u × s|, u · s): acos pierde precisión cerca de 0.
  const cx = to.y * sunDir.z - to.z * sunDir.y, cy = to.z * sunDir.x - to.x * sunDir.z, cz = to.x * sunDir.y - to.y * sunDir.x;
  const theta = Math.atan2(Math.hypot(cx, cy, cz) / d, dot(to, sunDir) / d);
  // Del contacto exterior (s + a) al interior (|s − a|); dentro, total o anular.
  const s = sunAngle;
  return (1 - smoothstep(Math.abs(s - a), s + a, theta)) * Math.min(1, (a * a) / (s * s));
}

/** Geometría de la sombra de un ocultador sobre un receptor (km). */
export interface ShadowGeometry {
  /** Distancia del receptor detrás del ocultador, a lo largo del eje Sol → ocultador (> 0 = detrás). */
  behind: number;
  /** Distancia del centro del receptor al eje de la sombra. */
  lateral: number;
  /** Radios de la penumbra y de la umbra (negativo = antumbra) a esa distancia. */
  penumbra: number;
  umbra: number;
  /** Eje de la sombra (unitario) y posición del ocultador respecto al receptor. */
  axis: Vec3d;
  occluderRel: Vec3d;
}

/**
 * Con posiciones heliocéntricas del ocultador `o` y del receptor `p`. En el marco del Sol la
 * luz va en línea recta desde su centro: la geometría no lleva aberración.
 */
export function shadowGeometryOf(o: Vec3d, p: Vec3d, occluderRadius: number): ShadowGeometry {
  const sunDistance = len(o);
  const axis = { x: o.x / sunDistance, y: o.y / sunDistance, z: o.z / sunDistance };
  const rel = sub(p, o);
  const behind = dot(rel, axis);
  const lateral = len(sub(rel, { x: axis.x * behind, y: axis.y * behind, z: axis.z * behind }));
  return {
    behind,
    lateral,
    penumbra: occluderRadius + (behind * (SUN_RADIUS_KM + occluderRadius)) / sunDistance,
    umbra: occluderRadius - (behind * (SUN_RADIUS_KM - occluderRadius)) / sunDistance,
    axis,
    occluderRel: { x: -rel.x, y: -rel.y, z: -rel.z },
  };
}

const LIGHT_KM_S = 299_792.458;

/**
 * Posición heliocéntrica del ocultador cuando proyectó la sombra que llega ahora al receptor:
 * la luz tarda 1,3 s de la Luna a la Tierra y en ese tiempo los dos recorren ~38 km de su
 * órbita alrededor del Sol. Sin esto la sombra caía ~40 km al oeste de donde la da la NASA.
 */
export function occluderAtShadowTime(occluder: BodyId, receiverKm: Vec3d, timeMs: number): Vec3d {
  const o = heliocentricKm(occluder, timeMs);
  const delayMs = (len(sub(o, receiverKm)) / LIGHT_KM_S) * 1000;
  return heliocentricKm(occluder, timeMs - delayMs);
}

function shadowGeometry(receiver: BodyId, occluder: BodyId, timeMs: number): ShadowGeometry {
  const p = heliocentricKm(receiver, timeMs);
  return shadowGeometryOf(occluderAtShadowTime(occluder, p, timeMs), p, occluderRadiusKm(occluder));
}

/** Latitud geodésica (la de los mapas) de una geocéntrica, en la Tierra (grados). */
export function geodeticLatitude(latDeg: number): number {
  const k = 1 / (1 - 1 / 298.257) ** 2;
  return (Math.atan(Math.tan((latDeg * Math.PI) / 180) * k) * 180) / Math.PI;
}

/**
 * Alcance de la sombra: < 1 si la penumbra toca el receptor (`radiusKm`); Infinity si el
 * receptor está del lado del Sol.
 */
export function shadowReach(g: ShadowGeometry, radiusKm: number): number {
  return g.behind > 0 ? g.lateral / (radiusKm + g.penumbra) : Infinity;
}

export type ShadowEventKind = 'solar' | 'lunar' | 'transit' | 'moonEclipse';
export type ShadowEventType = 'total' | 'annular' | 'partial' | 'penumbral' | 'shadow';

export interface ShadowEvent {
  kind: ShadowEventKind;
  type: ShadowEventType;
  receiver: BodyId;
  occluder: BodyId;
  /** Máximo, primer y último contacto de la penumbra (ms UTC). */
  maxMs: number;
  startMs: number;
  endMs: number;
  /**
   * Eclipses de Sol: punto de la Tierra con el máximo (lat/lon geográficas, este +): donde
   * el eje de la sombra toca el suelo o, si no lo toca, el más cercano a él.
   */
  site: { lat: number; lon: number } | null;
}

interface Pair {
  kind: ShadowEventKind;
  receiver: BodyId;
  occluder: BodyId;
  /** Periodo sinódico (días): cada cuánto se repite la alineación. */
  synodicDays: number;
}

const JUPITER_YEAR_DAYS = 4332.59;
const GALILEANS: BodyId[] = ['io', 'europa', 'ganymede', 'callisto'];
const galileanSynodic = (id: BodyId) => 1 / (BODIES[id].satellite!.meanMotion / 360 - 1 / JUPITER_YEAR_DAYS);

const PAIRS: Record<'solar' | 'lunar' | 'jupiter', Pair[]> = {
  solar: [{ kind: 'solar', receiver: 'earth', occluder: 'moon', synodicDays: 29.530589 }],
  lunar: [{ kind: 'lunar', receiver: 'moon', occluder: 'earth', synodicDays: 29.530589 }],
  jupiter: GALILEANS.flatMap((id): Pair[] => [
    { kind: 'transit', receiver: 'jupiter', occluder: id, synodicDays: galileanSynodic(id) },
    { kind: 'moonEclipse', receiver: id, occluder: 'jupiter', synodicDays: galileanSynodic(id) },
  ]),
};

const MS_PER_DAY = 86_400_000;

/** Mínimo de f en [a, b] por sección áurea. */
function goldenMin(f: (t: number) => number, a: number, b: number, iterations = 48): number {
  const r = (Math.sqrt(5) - 1) / 2;
  let c = b - r * (b - a), d = a + r * (b - a);
  let fc = f(c), fd = f(d);
  for (let i = 0; i < iterations; i++) {
    if (fc < fd) { b = d; d = c; fd = fc; c = b - r * (b - a); fc = f(c); }
    else { a = c; c = d; fc = fd; d = a + r * (b - a); fd = f(d); }
  }
  return (a + b) / 2;
}

/** Instante en que `inside(t)` deja de cumplirse, desde `from` hacia `step` (con signo). */
function contact(inside: (t: number) => boolean, from: number, step: number, maxSteps: number): number {
  let a = from, b = from + step;
  for (let i = 0; i < maxSteps && inside(b); i++) { a = b; b += step; }
  for (let i = 0; i < 30; i++) {
    const m = (a + b) / 2;
    if (inside(m)) a = m;
    else b = m;
  }
  return (a + b) / 2;
}

/** Clasifica el evento en su máximo y, en los de Sol, el lugar. */
function describe(pair: Pair, maxMs: number): Pick<ShadowEvent, 'type' | 'site'> {
  const g = shadowGeometry(pair.receiver, pair.occluder, maxMs);
  const R = BODIES[pair.receiver].radiusKm;
  if (pair.kind === 'solar') {
    // Punto del suelo: donde el eje toca la Tierra (central) o el más cercano a él.
    const along = Math.sqrt(Math.max(0, R * R - g.lateral * g.lateral));
    const central = g.lateral < R;
    // Del centro de la Tierra al punto del eje más cercano, y desde ahí hacia la Luna.
    const t = dot(g.occluderRel, g.axis);
    const closest = sub(g.occluderRel, { x: g.axis.x * t, y: g.axis.y * t, z: g.axis.z * t });
    const ground = central ? sub(closest, { x: g.axis.x * along, y: g.axis.y * along, z: g.axis.z * along }) : closest;
    const site = latLonOf(bodyFixedFromEcliptic(BODIES.earth, maxMs, ground));
    // Umbra en el suelo: en el punto central, a `along` más cerca de la Luna que el plano.
    const sunDistance = len(occluderAtShadowTime(pair.occluder, heliocentricKm(pair.receiver, maxMs), maxMs));
    const r = occluderRadiusKm(pair.occluder);
    const umbraAtGround = r - ((g.behind - along) * (SUN_RADIUS_KM - r)) / sunDistance;
    let type: ShadowEventType = 'partial';
    if (g.lateral < R + Math.abs(umbraAtGround)) type = umbraAtGround > 0 ? 'total' : 'annular';
    return { type, site };
  }
  if (pair.kind === 'lunar') {
    const rm = BODIES.moon.radiusKm;
    const type: ShadowEventType = g.lateral + rm < g.umbra ? 'total' : g.lateral - rm < g.umbra ? 'partial' : 'penumbral';
    return { type, site: null };
  }
  return { type: 'shadow', site: null };
}

/** Eventos de una pareja entre dos fechas (en orden cronológico si `direction` > 0). */
function searchPair(pair: Pair, fromMs: number, direction: 1 | -1, spanMs: number, limit: number): ShadowEvent[] {
  const R = BODIES[pair.receiver].radiusKm;
  const reach = (t: number) => shadowReach(shadowGeometry(pair.receiver, pair.occluder, t), R);
  const step = (pair.synodicDays * MS_PER_DAY) / 60;
  const events: ShadowEvent[] = [];
  // Un paso antes de la fecha: así se encuentra también el que está a punto de empezar o en curso.
  let t0 = fromMs - direction * step, h0 = reach(t0);
  let t1 = t0 + direction * step, h1 = reach(t1);
  for (let t2 = t1 + direction * step; Math.abs(t2 - fromMs) < spanMs && events.length < limit; t2 += direction * step) {
    const h2 = reach(t2);
    // Mínimo local entre t0 y t2: se afina y, si la penumbra llega al receptor, es un evento.
    // Con pasos de 1/60 del periodo el mínimo muestreado puede quedar lejos del real (~×4).
    if (h1 <= h0 && h1 <= h2 && h1 < 8) {
      const maxMs = goldenMin(reach, Math.min(t0, t2), Math.max(t0, t2));
      if (reach(maxMs) < 1) {
        const inside = (t: number) => reach(t) < 1;
        const contactStep = Math.min(10 * 60_000, step / 4);
        const startMs = contact(inside, maxMs, -contactStep, 200);
        const endMs = contact(inside, maxMs, contactStep, 200);
        // Los que siguen en curso cuentan como próximos.
        if (direction > 0 ? endMs >= fromMs : startMs <= fromMs) {
          events.push({ kind: pair.kind, receiver: pair.receiver, occluder: pair.occluder, maxMs, startMs, endMs, ...describe(pair, maxMs) });
        }
      }
    }
    t0 = t1; h0 = h1; t1 = t2; h1 = h2;
  }
  return events;
}

/**
 * Próximos (o anteriores) eclipses y tránsitos desde una fecha.
 * @param group de Sol, de Luna o en el sistema de Júpiter (tránsitos de sombra y eclipses de las lunas).
 */
export function findShadowEvents(group: 'solar' | 'lunar' | 'jupiter', fromMs: number, direction: 1 | -1, limit: number): ShadowEvent[] {
  const span = (group === 'jupiter' ? 20 : 4 * 365) * MS_PER_DAY;
  const all = PAIRS[group].flatMap((pair) => searchPair(pair, fromMs, direction, span, limit));
  all.sort((a, b) => (a.maxMs - b.maxMs) * direction);
  return all.slice(0, limit);
}
