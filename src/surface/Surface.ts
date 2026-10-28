/**
 * Superficie de un cuerpo rocoso: quadtree + chunks generados en GPU. Ver docs/ARQUITECTURA.md §7.
 *
 * - El quadtree se divide por separación de partícula en pantalla (como el LOD del globo:
 *   unos 2,6 px), con histéresis, y solo en lo que queda por encima del horizonte y dentro
 *   del campo de visión.
 * - Cada hoja visible tiene un chunk de N×N partículas en un hueco del pool. Los chunks
 *   nuevos se generan en una sola pasada compute por frame (hasta `JOBS`), con los datos de
 *   cada uno en un buffer de trabajos.
 * - Al dividir, el padre sigue dibujándose y se funde mientras aparecen los hijos.
 * - Precisión: todo lo que depende de la posición absoluta (mapa, ruido grueso) se evalúa
 *   respecto al centro del chunk, precalculado en float64 en la CPU (§7.2).
 */
import * as THREE from 'three/webgpu';
import {
  Fn,
  If,
  Return,
  cross,
  float,
  fract,
  hash,
  instanceIndex,
  max,
  mix,
  modelViewMatrix,
  modelWorldMatrix,
  normalize,
  pow,
  smoothstep,
  sqrt,
  step,
  storage,
  tan,
  texture,
  transformDirection,
  uint,
  uniform,
  vec3,
  vec4,
} from 'three/tsl';
import { rockyLook } from '../bodies/RockyPlanet';
import { ball, ballDepth, ballSprite, hardDisc, pixelAngle, type FloatNode, type Vec3Node } from '../particles/nodes';
import { config } from '../config';
import { freeStorageBuffers } from '../particles/gpu';
import type { ParticleBuffer } from '../particles/ParticleField';
import { blueNoiseTile } from '../particles/progressive';
import { ChunkPool } from './ChunkPool';
import { CUBE_FACES } from './cubeSphere';
import { CubeSphereQuadtree, nodeCorners, type QuadNode } from './CubeSphereQuadtree';
import { SurfaceChunk } from './SurfaceChunk';
import type { TerrainData } from './TerrainData';
import {
  FIRST_FACE_OCTAVE,
  coarseOctaves,
  coarseOctavesGpu,
  faceOctavesGpu,
  landFactorGpu,
  lastFaceOctave,
  mapCoords,
  mapCoordsGpu,
  ruggednessGpu,
  sampleHeightCpu,
  sampleTexelsGpu,
  terrainHeightCpu,
  type TerrainParams,
} from './terrain';

/** Partículas por lado de un chunk. */
const N = 80;
const NN = N * N;
/**
 * Huecos del pool (≈ 3,7M partículas, ~180 MB). A 10 m del suelo hacen falta ~300 con una
 * ventana de 1024×768 y ~450 con 1440×900; si se llena, el detalle se degrada (§7.3).
 */
const CAPACITY = 576;
/** Chunks que se pueden generar por frame. */
const JOBS = 32;
/** vec4 por trabajo en el buffer de trabajos. */
const JOB_STRIDE = 21;
/** Dividir si la separación de partícula pasa de esto (px CSS); fusionar por debajo de MERGE_PX. */
const SPLIT_PX = 4;
const MERGE_PX = 3.1;
/** Profundidad desde la que todo se evalúa respecto al centro del chunk. */
const PRECISE_DEPTH = 10;
/** Segundos de fundido entre un chunk y sus hijos. */
const FADE_SECONDS = 0.35;
/** Separación de partícula deseada en pantalla (px CSS), como el LOD del globo. */
const TARGET_PX = 2.6;
/** Octava 2D más fina posible (profundidad máxima + log2 N). */
const MAX_OCTAVE = config.surfaceMaxDepth + Math.floor(Math.log2(N));

/** La tesela es la misma para todas las superficies: se calcula una vez (~40 ms). */
let tileCache: Float32Array | null = null;
function blueTile(): Float32Array {
  if (!tileCache) {
    // mulberry32 (como el horneado): determinista.
    let a = 12345;
    const random = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), a | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const xy = blueNoiseTile(NN, 12, random);
    tileCache = new Float32Array(NN * 4);
    for (let i = 0; i < NN; i++) tileCache.set([xy[i * 2], xy[i * 2 + 1], 0, 0], i * 4);
  }
  return tileCache;
}

export interface SurfaceLook {
  /** Color lineal que multiplica el albedo (tinte × ganancia del preset). */
  tint: THREE.Color;
  /** Uniforms del cuerpo. */
  sunDirection: Vec3Node;
  objectScale: FloatNode;
  /** Centro del cuerpo en mundo. */
  planetCenter: Vec3Node;
  /** 0 = luz con la normal de la esfera (como el globo), 1 = normal del terreno. */
  terrainLight: FloatNode;
  water: boolean;
}

export interface SurfaceView {
  /** Cámara en el espacio del grupo que gira (radios). */
  cameraLocal: THREE.Vector3;
  /** ¿Toca el frustum la esfera (centro local, radio local)? */
  inFrustum: (center: THREE.Vector3, radius: number) => boolean;
  dt: number;
}

export class Surface {
  /** Cuelga del grupo que gira con el cuerpo. */
  readonly group = new THREE.Group();
  /** true cuando el quadtree visible se ha completado por primera vez (ya puede sustituir al globo). */
  complete = false;
  /** Hojas visibles sin chunk en el último frame (huecos por presupuesto o pool lleno). */
  holes = 0;
  private reveal = 0;
  private leaving = false;

  private readonly tree = new CubeSphereQuadtree();
  private readonly pool = new ChunkPool(CAPACITY, NN);
  private readonly chunks = new Set<SurfaceChunk>();
  private readonly coarse: number[];
  private readonly maxRelief: number;

  private readonly jobData: Float32Array;
  private readonly jobs: THREE.StorageInstancedBufferAttribute;
  /** Tesela de ruido azul progresivo (xy por partícula). */
  private readonly tile: THREE.StorageInstancedBufferAttribute;
  private readonly jobCount = uniform(0);
  private readonly generate: THREE.ComputeNode;
  private readonly material: THREE.SpriteNodeMaterial;
  private pendingJobs: { node: QuadNode; chunk: SurfaceChunk }[] = [];

  constructor(
    readonly terrain: TerrainData,
    readonly params: TerrainParams,
    look: SurfaceLook,
  ) {
    this.coarse = coarseOctaves(terrain.height, params.radiusKm);
    // Altura máxima posible (radios): margen del horizonte y de los límites de los nodos.
    const noiseMax = this.coarse.reduce((a, km) => a + km, 0) / params.radiusKm * params.roughness * 2;
    this.maxRelief = params.relief * (1 - params.reference) + noiseMax;

    this.jobData = new Float32Array(JOBS * JOB_STRIDE * 4);
    this.jobs = new THREE.StorageInstancedBufferAttribute(this.jobData, 4);
    this.tile = new THREE.StorageInstancedBufferAttribute(blueTile(), 4);
    this.generate = this.createGenerator(look);
    this.material = this.createMaterial(look);
  }

  get particleCount(): number {
    let n = 0;
    for (const c of this.chunks) n += c.object.count;
    return n;
  }

  /**
   * Altura del terreno (radios sobre el radio medio) en una dirección local, con todo el
   * detalle: el suelo de delante se dibuja con chunks profundos aunque el de justo debajo
   * (fuera de la vista) sea grueso.
   */
  heightAt(dir: THREE.Vector3): number {
    return terrainHeightCpu(dir.x, dir.y, dir.z, this.terrain.height, this.params, MAX_OCTAVE);
  }

  update(renderer: THREE.WebGPURenderer, view: SurfaceView): void {
    const cam = view.cameraLocal;
    const camDist = cam.length();
    const camDir = cam.clone().divideScalar(camDist);
    const camHorizon = Math.acos(Math.min(1, 1 / Math.max(camDist, 1)));
    const center = new THREE.Vector3();

    const heightAt = (d: readonly number[]) =>
      terrainHeightCpu(d[0], d[1], d[2], this.terrain.height, this.params, FIRST_FACE_OCTAVE + 2);
    /** Centro del nodo sobre el terreno y radio que abarca su relieve (radios). */
    const bounds = (n: QuadNode) => {
      if (n.height === undefined) {
        n.height = heightAt(n.center);
        n.maxHeight = Math.max(n.height, ...nodeCorners(n).map(heightAt)) + n.halfAngle * 0.15;
      }
      const r = 1 + n.height;
      center.set(n.center[0] * r, n.center[1] * r, n.center[2] * r);
      // Desnivel de hasta la mitad del tamaño del nodo, sin pasar del relieve máximo.
      return n.halfAngle + Math.min(this.maxRelief, n.halfAngle * 0.5);
    };
    const visible = (n: QuadNode) => {
      const radius = bounds(n);
      // Horizonte: el de la esfera más lo que asoma lo más alto del nodo por detrás.
      const reach = camHorizon + Math.acos(1 / (1 + Math.max(n.maxHeight!, 0))) + n.halfAngle;
      if (center.angleTo(camDir) > reach) return false;
      return view.inFrustum(center, radius);
    };
    const spacingPx = (n: QuadNode) => {
      bounds(n);
      const d = Math.max(cam.distanceTo(center) - n.halfAngle * 0.5, 1e-9);
      return ((Math.PI / 2) * 2 ** -n.depth) / N / (d * pixelAngle.value);
    };

    // Con el pool casi lleno, el detalle se degrada (umbrales más altos) en vez de atascarse.
    const fill = 1 - this.pool.available / CAPACITY;
    const strain = 1 + 2 * Math.max(0, (fill - 0.8) / 0.2);
    const splitPx = SPLIT_PX * strain, mergePx = MERGE_PX * strain;

    // 1. Recorrido: fusiones (en el acto) y candidatas a dividirse (después).
    let budget = JOBS;
    let pending = false;
    const stack = [...this.tree.roots];
    const leaves: QuadNode[] = [];
    const splits: { node: QuadNode; px: number }[] = [];
    while (stack.length) {
      const n = stack.pop()!;
      const vis = !this.leaving && visible(n);
      const px = vis ? spacingPx(n) : 0;
      if (n.children) {
        if (!vis || px < mergePx) {
          // Fusionar: el padre necesita su chunk antes de soltar a los hijos.
          if (vis && !n.chunk) {
            if (budget < 1 || !this.pool.available) { pending = true; stack.push(...n.children); continue; }
            this.spawn(n);
            budget--;
          }
          this.collapse(n);
          if (vis) leaves.push(n);
          continue;
        }
        stack.push(...n.children);
        continue;
      }
      if (!vis) {
        this.retire(n, true);
        continue;
      }
      leaves.push(n);
      if (px > splitPx && n.depth < config.surfaceMaxDepth) splits.push({ node: n, px });
    }

    // 2. Primero, las hojas visibles sin chunk (la cámara ha girado): son huecos.
    const missing = leaves.filter((n) => !n.chunk);
    missing.sort((a, b) => spacingPx(b) - spacingPx(a));
    for (const n of missing) {
      if (budget < 1 || !this.pool.available) break;
      this.spawn(n);
      budget--;
    }
    /** Hojas visibles que acaban el frame sin chunk: se ve el fondo. */
    this.holes = leaves.reduce((k, n) => k + (n.chunk ? 0 : 1), 0);

    // 3. Después, las divisiones (las de partículas más separadas primero). El padre sigue
    // dibujándose y se funde mientras aparecen los hijos.
    splits.sort((a, b) => b.px - a.px);
    for (const { node } of splits) {
      if (budget < 4 || this.pool.available < 4) { pending = true; break; }
      for (const child of this.tree.split(node)) this.spawn(child);
      budget -= 4;
      this.retire(node, false);
    }
    if (!this.complete && !pending && this.holes === 0) this.complete = true;

    // 4. Generar los chunks nuevos en una pasada. Fuera los que se crearon y se soltaron en
    // este mismo frame: su hueco puede tenerlo ya otro chunk.
    this.pendingJobs = this.pendingJobs.filter(({ chunk }) => this.chunks.has(chunk));
    if (this.pendingJobs.length) {
      this.pendingJobs.forEach(({ node, chunk }, k) => this.writeJob(k, node, chunk));
      this.jobCount.value = this.pendingJobs.length;
      this.jobs.needsUpdate = true;
      renderer.compute(this.generate);
      this.pendingJobs = [];
    }

    // 5. Fundidos y densidad. Mientras se construye por primera vez no se ve nada (sigue el
    // globo); al completarse, todo aparece fundiéndose; al irse, todo se desvanece.
    const step = view.dt / FADE_SECONDS;
    if (this.complete && !this.leaving) this.reveal = Math.min(1, this.reveal + step);
    for (const c of [...this.chunks]) {
      if (c.retiring || this.leaving) {
        c.setAppear(c.appear - step);
        if (c.appear <= 0) { this.free(c); continue; }
      } else if (this.complete && c.appear < 1) {
        c.setAppear(Math.min(1, c.appear + step));
      }
      // Cota de las que hacen falta en el punto más cercano del chunk (el shader afina).
      const fraction = Math.min(1, Math.max(0.03, (spacingPx(c.node) * 1.6 / TARGET_PX) ** 2));
      c.setDensity(fraction);
    }
    this.group.visible = this.complete;
  }

  /** Empieza a desvanecerse (se sube por encima del relevo); `faded` dice cuándo se puede soltar. */
  leave(): void {
    this.leaving = true;
  }

  get faded(): boolean {
    return this.leaving && this.chunks.size === 0;
  }

  /** La superficie tapa ya del todo al globo (completa y sin fundido pendiente). */
  get opaque(): boolean {
    return this.complete && !this.leaving && this.reveal >= 1;
  }

  private spawn(node: QuadNode): void {
    const slot = this.pool.acquire()!;
    const spacing = ((Math.PI / 2) * 2 ** -node.depth) / N;
    const chunk = new SurfaceChunk(node, slot, this.material, NN, spacing);
    const [x, y, z] = node.center;
    // Centro del chunk sobre el terreno (float64).
    const r = 1 + terrainHeightCpu(x, y, z, this.terrain.height, this.params, lastFaceOctave(node.depth, N));
    chunk.object.position.set(x * r, y * r, z * r);
    node.chunk = chunk;
    this.chunks.add(chunk);
    this.group.add(chunk.object);
    this.pendingJobs.push({ node, chunk });
  }

  /** El chunk del nodo se funde (o se suelta ya si no se ve). */
  private retire(node: QuadNode, immediately: boolean): void {
    const chunk = node.chunk;
    if (!chunk) return;
    node.chunk = null;
    if (immediately || !this.complete || chunk.appear <= 0) this.free(chunk);
    else chunk.retiring = true;
  }

  /** Quita los descendientes de un nodo (sus chunks se funden). */
  private collapse(node: QuadNode): void {
    for (const child of node.children ?? []) {
      this.collapse(child);
      this.retire(child, false);
    }
    node.children = null;
  }

  private free(chunk: SurfaceChunk): void {
    if (!this.chunks.delete(chunk)) return;
    chunk.object.removeFromParent();
    this.pool.release(chunk.slot);
  }

  /** Datos de un trabajo: geometría del nodo y valores en su centro calculados en float64. */
  private writeJob(k: number, node: QuadNode, chunk: SurfaceChunk): void {
    const o = k * JOB_STRIDE * 4, d = this.jobData;
    const size = 2 / 2 ** node.depth;
    const u0 = -1 + (node.iu + 0.5) * size, v0 = -1 + (node.iv + 0.5) * size;
    const face = CUBE_FACES[node.face];
    const [cx, cy, cz] = node.center;
    const last = lastFaceOctave(node.depth, N);
    const map = this.terrain.height;
    const p = this.params;
    const hc = map ? sampleHeightCpu(cx, cy, cz, map) : p.reference;
    // Ruido en el centro (con el factor de tierra): altura total − parte del mapa.
    const nc = terrainHeightCpu(cx, cy, cz, map, p, last) - p.relief * (hc - p.reference);

    d.set([node.face, Math.tan((u0 * Math.PI) / 4), Math.tan((v0 * Math.PI) / 4), size], o);
    d.set([chunk.slot * NN, (node.iu * 7919 + node.iv * 104729 + node.depth * 1299709) % 65521, node.depth, last], o + 4);
    d.set([node.iu, node.iv, hc, nc], o + 8);
    d.set([...face.n, node.depth >= PRECISE_DEPTH ? 1 : 0], o + 12);
    d.set([...face.a, 0], o + 16);
    d.set([...face.b, 0], o + 20);
    if (map) {
      // Texel del centro (entero + resto) y su derivada respecto al desplazamiento 3D.
      const [fx, fy] = mapCoords(cx, cy, cz, map);
      const eps = 1e-6;
      const [fxX, fyX] = mapCoords(cx + eps, cy, cz, map);
      const [fxY, fyY] = mapCoords(cx, cy + eps, cz, map);
      const [fxZ, fyZ] = mapCoords(cx, cy, cz + eps, map);
      const wrap = (a: number) => (Math.abs(a) > map.width / 2 ? a - Math.sign(a) * map.width : a);
      d.set([Math.floor(fx), Math.floor(fy), fx - Math.floor(fx), fy - Math.floor(fy)], o + 24);
      d.set([wrap(fxX - fx) / eps, wrap(fxY - fx) / eps, wrap(fxZ - fx) / eps, 0], o + 28);
      d.set([(fyX - fy) / eps, (fyY - fy) / eps, (fyZ - fy) / eps, 0], o + 32);
    }
    // Octavas 3D: celda entera y resto del centro.
    this.coarse.forEach((km, i) => {
      const f = p.radiusKm / km;
      const px = cx * f, py = cy * f, pz = cz * f;
      const ix = Math.floor(px), iy = Math.floor(py), iz = Math.floor(pz);
      d.set([ix, iy, iz, 0], o + 36 + i * 8);
      d.set([px - ix, py - iy, pz - iz, 0], o + 40 + i * 8);
    });
  }

  private createGenerator(look: SurfaceLook): THREE.ComputeNode {
    const p = this.params;
    const map = this.terrain.height;
    const jobs = storage(this.jobs, 'vec4', this.jobs.count).toReadOnly();
    const tileIn = storage(this.tile, 'vec4', NN).toReadOnly();
    const offsetOut = this.pool.node(this.pool.offset, false);
    const colorOut = this.pool.node(this.pool.color, false);
    const normalOut = this.pool.node(this.pool.normal, false);
    const heightTex = this.terrain.heightTexture;
    const albedoTex = this.terrain.albedo;
    const nightTex = this.terrain.night;

    return Fn(() => {
      // Variables (toVar) declaradas aquí, fuera de cualquier bloque condicional.
      const k = instanceIndex.div(uint(NN)).toVar();
      If(k.greaterThanEqual(uint(this.jobCount)), () => Return());
      const j = instanceIndex.sub(k.mul(uint(NN))).toVar();
      const job = (i: number) => jobs.element(k.mul(uint(JOB_STRIDE)).add(uint(i)));
      const j0 = job(0), j1 = job(1), j2 = job(2), j3 = job(3);
      const face = j0.x, t0u = j0.y, t0v = j0.z, size = j0.w;
      const slotBase = j1.x, seed = j1.y, depth = j1.z, lastOctave = j1.w;
      const iu = j2.x, iv = j2.y, hc = j2.z, nc = j2.w;
      const nrm = j3.xyz, precise = j3.w;
      const axisA = job(4).xyz, axisB = job(5).xyz;
      const texel = job(6), dfx = job(7).xyz, dfy = job(8).xyz;

      // Posición en la tesela de ruido azul progresivo, desplazada por chunk. Cualquier prefijo
      // cubre el chunk de forma pareja, así que cada uno dibuja solo las partículas que
      // necesita (densidad continua, §7.3). Se probaron una rejilla con jitter y la secuencia
      // R2 (guardan filas que, con el suelo visto de canto, se ven como rayas) y el azar
      // (grumos y huecos, como ruido de televisión).
      const fj = float(j);
      const tile = tileIn.element(j);
      const a0 = fract(tile.x.add(hash(seed.mul(1.7)))).sub(0.5).toVar();
      const b0 = fract(tile.y.add(hash(seed.mul(3.1).add(0.5)))).sub(0.5).toVar();

      // Punto del cubo del centro y su dirección.
      const q0 = nrm.add(axisA.mul(t0u)).add(axisB.mul(t0v));
      const l0sq = q0.dot(q0), l0 = sqrt(l0sq);
      const c = q0.div(l0);

      /**
       * tan(x) con precisión relativa también para x diminutos: las funciones trigonométricas
       * rápidas de la GPU tienen error absoluto (~10⁻⁴ en Apple), y a profundidad 16 el
       * ángulo de una partícula ya es menor que eso.
       */
      const tanSmall = (x: FloatNode) => {
        const x2 = x.mul(x);
        const series = x.mul(x2.mul(x2.mul(x2.mul(17 / 315).add(2 / 15)).add(1 / 3)).add(1));
        return x.abs().lessThan(0.1).select(series, tan(x));
      };

      /** Punto a (a, b) ∈ [−½, ½]² del nodo: desplazamiento respecto al centro y altura. */
      const pointAt = (a: FloatNode, b: FloatNode) => {
        // Equiangular: tan(u0 + du) − tan(u0) sin restar números casi iguales.
        const tu = tanSmall(a.mul(size).mul(Math.PI / 4)), tv = tanSmall(b.mul(size).mul(Math.PI / 4));
        const dtu = tu.mul(t0u.mul(t0u).add(1)).div(float(1).sub(t0u.mul(tu)));
        const dtv = tv.mul(t0v.mul(t0v).add(1)).div(float(1).sub(t0v.mul(tv)));
        const delta = axisA.mul(dtu).add(axisB.mul(dtv));
        // normalize(q0 + δ) − normalize(q0), estable.
        const x = q0.dot(delta).mul(2).add(delta.dot(delta));
        const l = sqrt(l0sq.add(x));
        const off = delta.div(l).sub(q0.mul(x.div(l.mul(l0).mul(l.add(l0)))));
        const dir = c.add(off);

        // Altura del mapa relativa a la del centro del chunk (precisa) y absoluta.
        let hRel: FloatNode = float(p.reference).sub(hc);
        if (map && heightTex) {
          // Lejos: coordenadas absolutas. Cerca (chunks pequeños): texel del centro + derivada.
          const abs = mapCoordsGpu(map, dir);
          const relX = texel.z.add(dfx.dot(off)), relY = texel.w.add(dfy.dot(off));
          const usePrecise = precise.greaterThan(0.5);
          hRel = sampleTexelsGpu(
            heightTex, map,
            usePrecise.select(texel.x, float(0)), usePrecise.select(relX, abs.fx),
            usePrecise.select(texel.y, float(0)), usePrecise.select(relY, abs.fy),
            hc,
          );
        }
        const h = hc.add(hRel);
        const land = map ? landFactorGpu(h, p) : float(1);
        const rough = map ? ruggednessGpu(h, p) : float(p.roughness);
        const coarse = coarseOctavesGpu(this.coarse, (i, f) => {
          const cell = job(9 + i * 2).xyz, rest = job(10 + i * 2).xyz;
          return {
            cell: precise.greaterThan(0.5).select(cell, vec3(0)),
            rest: precise.greaterThan(0.5).select(rest.add(off.mul(f)), dir.mul(f)),
          };
        }, rough, p.radiusKm);
        const fine = faceOctavesGpu({ face, depth, iu, iv, su: a.add(0.5), sv: b.add(0.5) }, lastOctave, rough, p.radiusKm, MAX_OCTAVE);
        const noise = land.mul(coarse.add(fine));
        // Altura absoluta (para escalar el desplazamiento) y relativa al centro (precisa).
        const height = h.sub(p.reference).mul(p.relief).add(noise);
        const rel = hRel.mul(p.relief).add(noise.sub(nc));
        return { pos: off.mul(height.add(1)).add(c.mul(rel)), dir, h, land };
      };

      const e = float(1 / N);
      const here = pointAt(a0, b0);
      const pu = pointAt(a0.add(e), b0).pos, pv = pointAt(a0, b0.add(e)).pos;
      const raw = cross(pu.sub(here.pos), pv.sub(here.pos));
      // Hacia fuera; si el producto vectorial degenera, la vertical.
      let n = normalize(raw.add(c.mul(1e-12)));
      n = n.mul(n.dot(c).greaterThanEqual(0).select(float(1), float(-1)));
      const index = uint(slotBase).add(j);
      offsetOut.element(index).assign(vec4(here.pos, hash(fj.add(seed))));

      // Color: albedo real, más oscuro en las pendientes y con algo de grano.
      const dir = here.dir;
      const uv = vec3(dir.z.negate().atan(dir.x).div(2 * Math.PI).add(0.5 + (-180 - this.terrain.leftLon) / 360),
        float(0.5).sub(dir.y.atan(dir.xz.length()).div(Math.PI)), 0).xy;
      const albedo = albedoTex ? texture(albedoTex, uv).level(float(0)).rgb : vec3(1);
      const slope = float(1).sub(n.dot(normalize(dir)).clamp(0, 1));
      const grain = hash(fj.add(seed.mul(5.3))).sub(0.5).mul(0.16).add(1);
      const rock = float(1).sub(smoothstep(0.15, 0.6, slope).mul(here.land).mul(0.35));
      const tint = vec3(look.tint.r, look.tint.g, look.tint.b);
      const water = look.water ? float(1).sub(here.land) : float(0);
      colorOut.element(index).assign(vec4(albedo.mul(tint).mul(grain).mul(rock), water));
      const night = nightTex ? texture(nightTex, uv).level(float(0)).r : float(0);
      normalOut.element(index).assign(vec4(n, night));
    })().compute(JOBS * NN);
  }

  private createMaterial(look: SurfaceLook): THREE.SpriteNodeMaterial {
    const offsetIn = this.pool.node(this.pool.offset, true);
    const colorIn = this.pool.node(this.pool.color, true);
    const normalIn = this.pool.node(this.pool.normal, true);
    // Uniforms por chunk (cada sprite comparte el material).
    const slotBase = uniform(0).onObjectUpdate(({ object }) => object!.userData.slotBase as number);
    const spacing = uniform(0.01).onObjectUpdate(({ object }) => object!.userData.spacing as number);
    const appear = uniform(1).onObjectUpdate(({ object }) => object!.userData.appear as number);

    const index = uint(slotBase).add(instanceIndex);
    const data = offsetIn.element(index);
    const surf = colorIn.element(index);
    const normalData = normalIn.element(index);
    const center = data.xyz;

    // Densidad continua por partícula (§7.3): a su distancia, ¿cuántas hacen falta para
    // ~2,6 px de separación? Las posiciones son aleatorias, así que el índice sirve de umbral:
    // se dibujan las primeras y, con menos, los puntos crecen. Sin saltos entre chunks ni niveles.
    const depth = modelViewMatrix.mul(vec4(center, 1)).z.negate();
    const spacingPx = spacing.mul(look.objectScale).div(depth.mul(pixelAngle));
    const fraction = spacingPx.div(TARGET_PX).pow(2).clamp(0.03, 1);
    const rank = float(instanceIndex).add(0.5).div(NN);
    const keep = step(rank, fraction);

    const material = new THREE.SpriteNodeMaterial({ transparent: false, alphaTest: 0.5 });
    const { scale, visibility } = ballSprite({
      center,
      size: spacing.mul(0.72).mul(appear).div(fraction.sqrt()),
      minPixels: 1.2,
      objectScale: look.objectScale,
      cull: keep,
    });
    material.positionNode = center;
    material.scaleNode = scale;
    material.opacityNode = hardDisc();
    const b = ball();
    material.depthNode = ballDepth(b, scale.mul(look.objectScale).mul(0.5));

    // Luz: día/noche con la normal de la esfera, relieve con la del terreno (§7.2).
    const world = modelWorldMatrix.mul(vec4(center, 1)).xyz;
    const radial = normalize(world.sub(look.planetCenter));
    const terrainN = normalize(transformDirection(normalData.xyz, modelWorldMatrix));
    const ndl = radial.dot(look.sunDirection);
    const daylight = smoothstep(-0.06, 0.12, ndl);
    const sphereLit = ndl.add(0.08).div(1.08).clamp(0, 1);
    const terrainLit = max(terrainN.dot(look.sunDirection), 0).mul(daylight);
    const planetLit = mix(sphereLit, terrainLit, look.terrainLight);
    const ballLit = max(b.normal.dot(look.sunDirection), 0).mul(daylight).mul(mix(float(1), terrainLit.mul(1.2).add(0.15).clamp(0, 1), look.terrainLight));
    const ballAmount = visibility.mul(rockyLook.ballShading);
    const lit = mix(planetLit, ballLit, ballAmount);
    const occlusion = mix(float(1), float(0.5).add(b.facing.mul(0.5)), ballAmount);
    const bead = mix(float(1), b.facing, ballAmount);
    let rgb = surf.xyz.mul(lit.add(rockyLook.ambient)).mul(occlusion).mul(rockyLook.dotGain);

    // Luces de ciudades en el lado nocturno.
    const nightSide = float(1).sub(smoothstep(-0.12, 0.06, ndl));
    rgb = rgb.add(vec3(1.0, 0.68, 0.38).mul(smoothstep(0.03, 0.5, normalData.w).mul(nightSide).mul(rockyLook.nightLights)).mul(bead));
    if (look.water) {
      // Reflejo del Sol en el agua.
      const view = normalize(world.negate());
      const h = normalize(look.sunDirection.add(view));
      const spec = pow(max(radial.dot(h), 0), 160).mul(surf.w).mul(sphereLit).mul(rockyLook.specular);
      rgb = rgb.add(vec3(1.0, 0.95, 0.85).mul(spec).mul(bead));
    }
    material.colorNode = vec4(rgb, 1);
    return material;
  }

  dispose(renderer: THREE.WebGPURenderer): void {
    for (const c of [...this.chunks]) this.free(c);
    this.group.removeFromParent();
    this.material.dispose();
    this.generate.dispose();
    this.pool.dispose(renderer);
    freeStorageBuffers(renderer, [this.jobs, this.tile].map((a) => storage(a, 'vec4', a.count) as ParticleBuffer));
  }
}
