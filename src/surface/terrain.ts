/**
 * Función de terreno: la misma en la CPU (colisión de la cámara) y en la GPU (chunks).
 * Ver docs/ARQUITECTURA.md §7.2.
 *
 * altura(dir) = relieve · (mapa(dir) − referencia) + tierra(dir) · ruido(dir)   (en radios)
 *
 * - Mapa de alturas: B-spline cúbica hecha a mano (16 lecturas), igual en las dos
 *   implementaciones. Con bilineal el terreno son facetas planas de un texel (10 km en la
 *   Tierra) con aristas rectas que se ven a ras de suelo; el filtrado por hardware, además,
 *   tiene poca precisión dentro del texel y no daría lo mismo que la CPU.
 * - Ruido de valor sobre un hash entero (u32 que desborda igual en JS y en WGSL):
 *   - octavas gruesas en 3D sobre la dirección (continuas entre caras del cubo),
 *   - octavas finas en 2D sobre la rejilla de cada cara, con la celda calculada en
 *     enteros a partir del nodo del quadtree: a escala de centímetros, `dir × frecuencia`
 *     ya no cabe en float32.
 *   Las octavas se cortan donde ya no se distinguirían (dos separaciones de partícula).
 */
import { Fn, float, floor, int, ivec2, mix, textureLoad, uint } from 'three/tsl';
import type * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { faceOfDirection } from './cubeSphere';

type FloatNode = Node<'float'>;
type UintNode = Node<'uint'>;
type Vec3Node = Node<'vec3'>;

/** Datos de altura de un cuerpo: valores normalizados (0–1), fila 0 = norte. */
export interface HeightData {
  width: number;
  height: number;
  data: Float32Array;
  /** Longitud este del borde izquierdo (grados). */
  leftLon: number;
}

export interface TerrainParams {
  /** Relieve a ras de suelo (radios por unidad de altura normalizada). */
  relief: number;
  /** Altura normalizada del radio medio. */
  reference: number;
  /** Por debajo, agua: ni ruido ni relieve fino (normalizada). */
  waterBelow: number;
  /** Rugosidad del ruido: amplitud = rugosidad × longitud de onda. */
  roughness: number;
  /** Radio del cuerpo (km): longitudes de onda en km. */
  radiusKm: number;
}

/** Máximo de octavas 3D (cabe en el buffer de trabajos de los chunks). */
export const MAX_COARSE_OCTAVES = 6;

/** Octavas 3D desde dos texels del mapa hasta el nivel 2D `FIRST_FACE_OCTAVE`. */
export const FIRST_FACE_OCTAVE = 12;
/** Octavas 2D por debajo de la separación de partícula que aún se suman. */
const FINE_MARGIN = 1;

const HASH_A = 374761393, HASH_B = 668265263, HASH_C = 2147483647, HASH_D = 1274126177;

// ─── CPU ──────────────────────────────────────────────────────────────────────

function hashCpu(x: number, y: number, z: number, seed: number): number {
  let h = (Math.imul(x, HASH_A) ^ Math.imul(y, HASH_B) ^ Math.imul(z, HASH_C) ^ Math.imul(seed, HASH_D)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), HASH_D) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const fade = (t: number) => t * t * (3 - 2 * t);

function noise3Cpu(x: number, y: number, z: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const u = fade(x - xi), v = fade(y - yi), w = fade(z - zi);
  const c = (dx: number, dy: number, dz: number) => hashCpu((xi + dx) | 0, (yi + dy) | 0, (zi + dz) | 0, seed);
  const x00 = c(0, 0, 0) + (c(1, 0, 0) - c(0, 0, 0)) * u;
  const x10 = c(0, 1, 0) + (c(1, 1, 0) - c(0, 1, 0)) * u;
  const x01 = c(0, 0, 1) + (c(1, 0, 1) - c(0, 0, 1)) * u;
  const x11 = c(0, 1, 1) + (c(1, 1, 1) - c(0, 1, 1)) * u;
  const y0 = x00 + (x10 - x00) * v, y1 = x01 + (x11 - x01) * v;
  return y0 + (y1 - y0) * w;
}

/** Ruido 2D en la celda entera (cx, cy) con fracción (fx, fy). Celdas en u32 (con desborde). */
function noise2Cpu(cx: number, cy: number, fx: number, fy: number, seed: number): number {
  const u = fade(fx), v = fade(fy);
  const c = (dx: number, dy: number) => hashCpu((cx + dx) | 0, (cy + dy) | 0, 0, seed);
  const a = c(0, 0) + (c(1, 0) - c(0, 0)) * u;
  const b = c(0, 1) + (c(1, 1) - c(0, 1)) * u;
  return a + (b - a) * v;
}

/**
 * Coordenadas del mapa en texels (con el desplazamiento de longitud) para una dirección,
 * no hace falta que sea unitaria.
 */
export function mapCoords(x: number, y: number, z: number, map: HeightData): [number, number] {
  const lon = Math.atan2(-z, x);
  const lat = Math.atan2(y, Math.hypot(x, z));
  const u = 0.5 + lon / (2 * Math.PI) + (-180 - map.leftLon) / 360;
  const v = 0.5 - lat / Math.PI;
  return [u * map.width - 0.5, v * map.height - 0.5];
}

/** Altura normalizada del mapa con filtrado bilineal (u con wrap, v con clamp). */
export function sampleHeightCpu(x: number, y: number, z: number, map: HeightData): number {
  const [fx, fy0] = mapCoords(x, y, z, map);
  return sampleTexelsCpu(fx, fy0, map);
}

/** Pesos de la B-spline cúbica uniforme para la fracción t (taps en −1, 0, 1, 2). */
function bsplineWeights(t: number): [number, number, number, number] {
  const t2 = t * t, t3 = t2 * t;
  return [(1 - t) ** 3 / 6, (3 * t3 - 6 * t2 + 4) / 6, (-3 * t3 + 3 * t2 + 3 * t + 1) / 6, t3 / 6];
}

/** B-spline cúbica en coordenadas de texel (x con wrap, y con clamp). */
export function sampleTexelsCpu(fx: number, fy0: number, map: HeightData): number {
  const fy = Math.min(Math.max(fy0, 0), map.height - 1);
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const wx = bsplineWeights(fx - x0), wy = bsplineWeights(fy - y0);
  const d = map.data, w = map.width;
  let sum = 0;
  for (let j = 0; j < 4; j++) {
    const y = Math.min(Math.max(y0 + j - 1, 0), map.height - 1);
    let row = 0;
    for (let i = 0; i < 4; i++) {
      const x = (((x0 + i - 1) % w) + w * 2) % w;
      row += d[y * w + x] * wx[i];
    }
    sum += row * wy[j];
  }
  return sum;
}

/** Longitud de onda (km) de la octava 2D `m` (la cara mide π/2 radianes y tiene 2^m celdas). */
export const faceOctaveKm = (m: number, radiusKm: number) => ((Math.PI / 2) * radiusKm) / 2 ** m;

/** Octavas 3D: de dos texels del mapa hacia abajo, hasta llegar a la octava 2D inicial. */
export function coarseOctaves(map: HeightData | null, radiusKm: number): number[] {
  const texelKm = map ? (2 * Math.PI * radiusKm) / map.width : radiusKm / 50;
  const out: number[] = [];
  for (let km = 2 * texelKm; km > faceOctaveKm(FIRST_FACE_OCTAVE, radiusKm) * 1.5; km /= 2) out.push(km);
  return out.slice(0, MAX_COARSE_OCTAVES);
}

/** Última octava 2D que se suma en un nodo de profundidad `depth` con `n`×`n` partículas. */
export const lastFaceOctave = (depth: number, n: number) => depth + Math.floor(Math.log2(n)) - FINE_MARGIN;

/** Factor de tierra (0 en el agua, 1 tierra adentro): sin ruido en el mar. */
const landFactor = (h: number, p: TerrainParams) => fade(Math.min(1, Math.max(0, (h - p.waterBelow) / (3 / 255))));

/** Rugosidad local: más en las montañas que en las llanuras. */
const ruggedness = (h: number, p: TerrainParams) => p.roughness * (0.35 + 0.65 * fade(Math.min(1, Math.max(0, (h - p.reference) / 0.25))));

/**
 * Altura en una dirección (radios sobre el radio medio), en float64.
 * `lastOctave`: hasta qué octava 2D sumar (la del chunk que hay debajo de la cámara).
 */
export function terrainHeightCpu(x: number, y: number, z: number, map: HeightData | null, p: TerrainParams, lastOctave: number): number {
  const h = map ? sampleHeightCpu(x, y, z, map) : p.reference;
  const land = map ? landFactor(h, p) : 1;
  let n = 0;
  if (land > 0) {
    const rough = ruggedness(h, p);
    for (const km of coarseOctaves(map, p.radiusKm)) {
      const f = p.radiusKm / km;
      n += (noise3Cpu(x * f, y * f, z * f, 11) - 0.5) * 2 * rough * (km / p.radiusKm);
    }
    const { face, u, v } = faceOfDirection(x, y, z);
    for (let m = FIRST_FACE_OCTAVE; m <= lastOctave; m++) {
      const cells = 2 ** m;
      const su = ((u + 1) / 2) * cells, sv = ((v + 1) / 2) * cells;
      const cu = Math.floor(su), cv = Math.floor(sv);
      const amp = rough * (faceOctaveKm(m, p.radiusKm) / p.radiusKm);
      n += (noise2Cpu(cu, cv, su - cu, sv - cv, 101 + face * 64 + m) - 0.5) * 2 * amp;
    }
  }
  return p.relief * (h - p.reference) + land * n;
}

// ─── GPU (TSL) ────────────────────────────────────────────────────────────────

const hashGpu = (x: UintNode, y: UintNode, z: UintNode, seed: UintNode): FloatNode => {
  const h0 = x.mul(uint(HASH_A)).bitXor(y.mul(uint(HASH_B))).bitXor(z.mul(uint(HASH_C))).bitXor(seed.mul(uint(HASH_D)));
  const h1 = h0.bitXor(h0.shiftRight(uint(13))).mul(uint(HASH_D));
  return float(h1.bitXor(h1.shiftRight(uint(16)))).div(4294967296) as FloatNode;
};

const fadeGpu = (t: FloatNode) => t.mul(t).mul(float(3).sub(t.mul(2)));
/** floor(x) como u32 con la representación en complemento a dos (como `| 0` y `>>> 0` en JS). */
const cellU = (x: FloatNode): UintNode => int(floor(x)).toUint() as unknown as UintNode;

/**
 * Ruido 3D en la celda entera `cell` (floats exactos) con resto `rest` (puede salirse de
 * [0, 1)): así un punto lejos del origen conserva la precisión de su parte fraccionaria.
 */
export const noise3Gpu = Fn(([cell, rest, seedIn]: [Vec3Node, Vec3Node, FloatNode]) => {
  const seed = uint(seedIn);
  const base = floor(rest);
  const xi = cellU(cell.x.add(base.x)), yi = cellU(cell.y.add(base.y)), zi = cellU(cell.z.add(base.z));
  const fr = rest.sub(base);
  const u = fadeGpu(fr.x), v = fadeGpu(fr.y), w = fadeGpu(fr.z);
  const one = uint(1);
  const c = (dx: boolean, dy: boolean, dz: boolean) =>
    hashGpu(dx ? xi.add(one) : xi, dy ? yi.add(one) : yi, dz ? zi.add(one) : zi, seed);
  const x00 = mix(c(false, false, false), c(true, false, false), u);
  const x10 = mix(c(false, true, false), c(true, true, false), u);
  const x01 = mix(c(false, false, true), c(true, false, true), u);
  const x11 = mix(c(false, true, true), c(true, true, true), u);
  return mix(mix(x00, x10, v), mix(x01, x11, v), w);
});

export const noise2Gpu = Fn(([cx, cy, fx, fy, seedIn]: [UintNode, UintNode, FloatNode, FloatNode, FloatNode]) => {
  const seed = uint(seedIn), zero = uint(0), one = uint(1);
  const u = fadeGpu(fx), v = fadeGpu(fy);
  const a = mix(hashGpu(cx, cy, zero, seed), hashGpu(cx.add(one), cy, zero, seed), u);
  const b = mix(hashGpu(cx, cy.add(one), zero, seed), hashGpu(cx.add(one), cy.add(one), zero, seed), u);
  return mix(a, b, v);
});

/** Coordenadas de texel de una dirección (absolutas: sin precisión a escala de metros). */
export function mapCoordsGpu(map: HeightData, dir: Vec3Node): { fx: FloatNode; fy: FloatNode } {
  const lon = dir.z.negate().atan(dir.x);
  const lat = dir.y.atan(dir.xz.length());
  const u = lon.div(2 * Math.PI).add(0.5 + (-180 - map.leftLon) / 360);
  const v = float(0.5).sub(lat.div(Math.PI));
  return { fx: u.mul(map.width).sub(0.5), fy: v.mul(map.height).sub(0.5) };
}

const bsplineGpu = (t: FloatNode): FloatNode[] => {
  const t2 = t.mul(t), t3 = t2.mul(t), u = float(1).sub(t);
  return [
    u.mul(u).mul(u).div(6),
    t3.mul(3).sub(t2.mul(6)).add(4).div(6),
    t3.mul(-3).add(t2.mul(3)).add(t.mul(3)).add(1).div(6),
    t3.div(6),
  ];
};

/**
 * B-spline cúbica del mapa de alturas (r32float) a mano, como `sampleTexelsCpu`.
 * Coordenada = parte entera (exacta) + resto, para no perder precisión lejos del origen.
 * Devuelve la altura **menos `reference`**, restada en cada texel antes de interpolar: así se
 * suman números pequeños. Restar después dos alturas de ~0,6 en float32 deja escalones de
 * ~2 mm que la normal (diferencias a escala de centímetro) convierte en rayas de sombra.
 */
export function sampleTexelsGpu(tex: THREE.Texture, map: HeightData, fxInt: FloatNode, fxRest: FloatNode, fyInt: FloatNode, fyRest: FloatNode, reference: FloatNode = float(0)): FloatNode {
  // Parte entera y fracción por separado en los dos ejes: sumadas (~700 texels) la fracción
  // en float32 solo tendría unos pocos valores dentro de un chunk de metros (terrazas).
  const x0 = fxInt.add(floor(fxRest)), y0raw = fyInt.add(floor(fyRest));
  const tx = fxRest.sub(floor(fxRest)), tyRaw = fyRest.sub(floor(fyRest));
  // Fuera del mapa por arriba o por abajo: fila extrema (como el clamp de la CPU).
  const y0 = y0raw.clamp(0, map.height - 1);
  const ty = y0raw.lessThan(0).or(y0raw.greaterThanEqual(map.height - 1)).select(float(0), tyRaw);
  const wx = bsplineGpu(tx), wy = bsplineGpu(ty);
  const w = float(map.width);
  let sum: FloatNode = float(0);
  for (let j = 0; j < 4; j++) {
    const y = y0.add(j - 1).clamp(0, map.height - 1);
    let row: FloatNode = float(0);
    for (let i = 0; i < 4; i++) {
      const xr = x0.add(i - 1);
      const x = xr.sub(floor(xr.div(w)).mul(w)); // módulo positivo
      row = row.add(textureLoad(tex, ivec2(int(x), int(y))).x.sub(reference).mul(wx[i]));
    }
    sum = sum.add(row.mul(wy[j]));
  }
  return sum;
}

/** Datos de un chunk para las octavas 2D finas (celdas enteras desde el nodo del quadtree). */
export interface ChunkLattice {
  face: FloatNode;
  depth: FloatNode;
  /** Índice del nodo en su cara (enteros < 2^24, exactos en float32). */
  iu: FloatNode;
  iv: FloatNode;
  /** Posición dentro del nodo, en [0, 1). */
  su: FloatNode;
  sv: FloatNode;
}

/**
 * Suma de las octavas 2D de `FIRST_FACE_OCTAVE` a `lastOctave` (ambas incluidas) en un
 * punto de un chunk. Las celdas se calculan en u32 a partir del índice del nodo, como en la CPU.
 *
 * Sin `If`: TSL declara una expresión compartida en el primer bloque donde se usa, y si ese
 * bloque es condicional, fuera de él vale 0. Todas las octavas se evalúan y se enmascaran.
 */
export function faceOctavesGpu(lat: ChunkLattice, lastOctave: FloatNode, rough: FloatNode, radiusKm: number, maxOctave: number): FloatNode {
  let sum: FloatNode = float(0);
  const iu = uint(lat.iu), iv = uint(lat.iv), depth = int(lat.depth);
  for (let m = FIRST_FACE_OCTAVE; m <= maxOctave; m++) {
    // Celda absoluta = nodo << (m − d) + parte entera de la posición escalada (o nodo >> (d − m)).
    const shift = int(m).sub(depth);
    const finer = shift.greaterThanEqual(0);
    // Desplazamientos en u32 materializados (WGSL exige u32 a la derecha de <<).
    const up = uint(finer.select(shift, int(0))).toVar(), down = uint(finer.select(int(0), shift.negate())).toVar();
    const scaleUp = float(uint(1).shiftLeft(up)), scaleDown = float(uint(1).shiftLeft(down));
    const mask = uint(1).shiftLeft(down).sub(1);
    // Más fina que el nodo: el punto escalado dentro del nodo. Más gruesa: la posición del
    // nodo dentro de la celda. El punto puede salirse un poco del nodo (jitter): la parte
    // entera, con signo, se suma en complemento a dos (u32 que desborda, como en la CPU).
    const pu = finer.select(lat.su.mul(scaleUp), float(iu.bitAnd(mask)).add(lat.su).div(scaleDown));
    const pv = finer.select(lat.sv.mul(scaleUp), float(iv.bitAnd(mask)).add(lat.sv).div(scaleDown));
    const baseU = finer.select(iu.shiftLeft(up), iu.shiftRight(down));
    const baseV = finer.select(iv.shiftLeft(up), iv.shiftRight(down));
    const cu = baseU.add(uint(int(floor(pu)))), cv = baseV.add(uint(int(floor(pv))));
    const fu = pu.sub(floor(pu)), fv = pv.sub(floor(pv));
    const amp = rough.mul(faceOctaveKm(m, radiusKm) / radiusKm);
    const seed = lat.face.mul(64).add(101 + m);
    const active = float(m).lessThanEqual(lastOctave).select(float(1), float(0));
    sum = sum.add(noise2Gpu(cu, cv, fu, fv, seed).sub(0.5).mul(2).mul(amp).mul(active));
  }
  return sum;
}

/**
 * Octavas 3D (gruesas). `cellAt(k)` da la celda entera y el resto del punto en la octava k
 * (el chunk los calcula respecto a su centro, precalculado en float64).
 */
export function coarseOctavesGpu(
  octavesKm: readonly number[],
  cellAt: (k: number, f: number) => { cell: Vec3Node; rest: Vec3Node },
  rough: FloatNode,
  radiusKm: number,
): FloatNode {
  let n: FloatNode = float(0);
  octavesKm.forEach((km, k) => {
    const { cell, rest } = cellAt(k, radiusKm / km);
    n = n.add(noise3Gpu(cell, rest, float(11)).sub(0.5).mul(2).mul(rough).mul(km / radiusKm));
  });
  return n;
}

export const landFactorGpu = (h: FloatNode, p: TerrainParams) => fadeGpu(h.sub(p.waterBelow).div(3 / 255).clamp(0, 1));
export const ruggednessGpu = (h: FloatNode, p: TerrainParams) =>
  fadeGpu(h.sub(p.reference).div(0.25).clamp(0, 1)).mul(0.65).add(0.35).mul(p.roughness);
