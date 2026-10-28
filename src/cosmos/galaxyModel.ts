/**
 * Partículas de las demás galaxias: una plantilla por tipo con la forma de cada una
 * (`astro/galaxies.ts`). Ver docs/ARQUITECTURA.md §14.4.
 *
 * - Espiral: disco exponencial más denso sobre los brazos (espirales logarítmicas), bulbo,
 *   barra, estrellas jóvenes en asociaciones, regiones HII y polvo en el borde interior de
 *   los brazos; Andrómeda, además, su anillo de polvo y estrellas a 10 kpc.
 * - Elíptica: esferoide muy concentrado y cúmulos globulares; Centaurus A con su disco de
 *   polvo alabeado y chorro; M87 con el suyo.
 * - Irregular: barra descentrada, grumos de formación de estrellas; M82 con su viento.
 * - Lenticular (el Sombrero): bulbo enorme y un anillo de polvo fino.
 *
 * Todo en unidades del radio de la galaxia y en sus ejes (x eje mayor, y el otro eje del
 * disco, z la normal); al final, a años luz en ejes de escena. Como en la Vía Láctea, cada
 * partícula elige su componente al azar (cualquier prefijo vale para el LOD) y su luz se
 * reparte por su área. La luz total es la relativa de la galaxia por la de la Vía Láctea.
 */
import type { Vec3d } from '../astro/frames';
import type { GalaxyShape } from '../astro/galaxies';
import { DEG } from '../astro/units';
import { SIZE_REF_LY, type GalaxyLayer, type GalaxyResult } from './milkyWayModel';
import { rng, samplers, smoothstep } from './random';

export interface GalaxySpec {
  shape: GalaxyShape;
  radiusLy: number;
  /** Partículas de estrellas; el polvo va aparte, en proporción. */
  count: number;
  /** Luz total (en las unidades de la Vía Láctea). */
  light: number;
  seed: number;
  basis: { major: Vec3d; minor: Vec3d; normal: Vec3d };
}

/** Partículas que suelta cada paso del generador (unidades del radio, ejes de la galaxia). */
interface Emit {
  star(x: number, y: number, z: number, size: number, r: number, g: number, b: number, light: number): void;
  dust(x: number, y: number, z: number, size: number): void;
}

const OLD: [number, number, number] = [1, 0.76, 0.52];
const DISK: [number, number, number] = [1, 0.9, 0.78];
const YOUNG: [number, number, number] = [0.62, 0.76, 1];
const HII: [number, number, number] = [1, 0.38, 0.56];

export function generateGalaxy(spec: GalaxySpec): GalaxyResult {
  const rand = rng(spec.seed);
  const s = samplers(rand);
  // Partículas más grandes cuantas menos haya: el mismo solape que la Vía Láctea (600.000 en 15 kpc).
  const f = Math.sqrt(600_000 / spec.count);
  const dustCount = Math.round(spec.count * dustFraction(spec.shape));

  const starPos: number[] = [], starCol: number[] = [], starLight: number[] = [];
  const dustPos: number[] = [];
  let starsLeft = spec.count, dustLeft = dustCount;
  const emit: Emit = {
    star(x, y, z, size, r, g, b, light) {
      if (starsLeft <= 0) return;
      starsLeft--;
      const j = 1 + (rand() - 0.5) * 0.25;
      starPos.push(x, y, z, size * f);
      starCol.push(r * j, g * (1 + (rand() - 0.5) * 0.12), b / j);
      starLight.push(light);
    },
    dust(x, y, z, size) {
      if (dustLeft <= 0) return;
      dustLeft--;
      dustPos.push(x, y, z, size * f);
    },
  };

  const fill = TEMPLATES[spec.shape.kind];
  // Cada pasada suelta una mezcla de componentes en orden aleatorio, hasta llenar los dos cupos.
  for (let guard = 0; (starsLeft > 0 || dustLeft > 0) && guard < spec.count * 4; guard++) fill(spec.shape, rand, s, emit);

  return finish(spec, starPos, starCol, starLight, dustPos);
}

function dustFraction(shape: GalaxyShape): number {
  switch (shape.kind) {
    case 'spiral': return 0.08 + 0.17 * shape.dust;
    case 'elliptical': return shape.dustDisk ? 0.12 : 0;
    case 'irregular': return 0.08;
    case 'lenticular': return 0.2;
  }
}

/** A años luz en ejes de escena, con la luz total de la galaxia repartida por el área de cada partícula. */
function finish(spec: GalaxySpec, starPos: number[], starCol: number[], starLight: number[], dustPos: number[]): GalaxyResult {
  const { major, minor, normal } = spec.basis;
  const R = spec.radiusLy;
  const toScene = (out: Float32Array, i: number, x: number, y: number, z: number, size: number) => {
    out[i * 4] = (major.x * x + minor.x * y + normal.x * z) * R;
    out[i * 4 + 1] = (major.y * x + minor.y * y + normal.y * z) * R;
    out[i * 4 + 2] = (major.z * x + minor.z * y + normal.z * z) * R;
    out[i * 4 + 3] = size * R;
  };
  const n = starLight.length;
  const total = starLight.reduce((a, b) => a + b, 0) || 1;
  const k = spec.light / total;
  const stars: GalaxyLayer = { posSize: new Float32Array(n * 4), color: new Float32Array(n * 4) };
  for (let i = 0; i < n; i++) {
    toScene(stars.posSize, i, starPos[i * 4], starPos[i * 4 + 1], starPos[i * 4 + 2], starPos[i * 4 + 3]);
    const ratio = stars.posSize[i * 4 + 3] / SIZE_REF_LY;
    const l = (starLight[i] * k) / (ratio * ratio);
    stars.color[i * 4] = starCol[i * 3] * l;
    stars.color[i * 4 + 1] = starCol[i * 3 + 1] * l;
    stars.color[i * 4 + 2] = starCol[i * 3 + 2] * l;
  }
  const m = dustPos.length / 4;
  const dust: GalaxyLayer = { posSize: new Float32Array(m * 4), color: new Float32Array(m * 4) };
  for (let i = 0; i < m; i++) {
    toScene(dust.posSize, i, dustPos[i * 4], dustPos[i * 4 + 1], dustPos[i * 4 + 2], dustPos[i * 4 + 3]);
    // Absorbe más el azul que el rojo, como en la Vía Láctea.
    dust.color.set([0.42, 0.55, 0.75, 0], i * 4);
  }
  return { stars, dust };
}

type Samplers = ReturnType<typeof samplers>;

/** Cada plantilla suelta unas cuantas partículas por llamada (una mezcla de sus componentes). */
const TEMPLATES = {
  spiral: spiralTemplate(),
  elliptical: ellipticalTemplate(),
  irregular: irregularTemplate(),
  lenticular: lenticularTemplate(),
};

function spiralTemplate() {
  // Estado por galaxia: grumos fijos a lo largo de los brazos (se crean la primera vez).
  let cache: { shape: GalaxyShape; ob: [number, number][]; hii: [number, number][]; dust: [number, number][] } | null = null;
  return (shape: GalaxyShape, rand: () => number, s: Samplers, emit: Emit) => {
    if (shape.kind !== 'spiral') return;
    const m = shape.arms, tanP = Math.tan(shape.pitchDeg * DEG), r0 = 0.5;
    const rIn = Math.max(shape.bar, 0.1);
    const width = (r: number) => 0.03 + 0.05 * r;
    const taper = (r: number) => smoothstep(rIn * 0.8, rIn + 0.12, r) * (1 - smoothstep(0.85, 1.05, r));
    const phase = (k: number) => (2 * Math.PI * k) / m;
    const offset = (k: number, r: number, beta: number) => {
      const period = 2 * Math.PI * tanP;
      let u = Math.log(r / r0) + (beta - phase(k)) * tanP;
      u -= Math.round(u / period) * period;
      return r * u;
    };
    const boost = (r: number, beta: number) => {
      let best = 0;
      for (let k = 0; k < m; k++) {
        const d = offset(k, r, beta), w = width(r);
        best = Math.max(best, Math.exp((-d * d) / (2 * w * w)));
      }
      return best * taper(r);
    };
    const armPoint = (): [number, number] => {
      for (;;) {
        const k = Math.floor(rand() * m);
        const span = 1 - Math.exp(-(1 - rIn) / 0.35);
        const r = rIn - 0.35 * Math.log(1 - rand() * span);
        const beta = phase(k) - Math.log(r / r0) / tanP;
        if (rand() < taper(r)) return [r, beta];
      }
    };
    const ringPoint = (spread: number): [number, number] => [shape.ring! + s.gauss() * spread, rand() * 2 * Math.PI];
    if (cache?.shape !== shape) {
      const clumps = (n: number, inward: number) => Array.from({ length: n }, (): [number, number] => {
        const [r, b] = shape.ring && rand() < 0.35 ? ringPoint(0.012) : armPoint();
        return [r + (s.gauss() * 0.5 - inward) * width(r), b + s.gauss() * 0.01];
      });
      cache = { shape, ob: clumps(600, 0), hii: clumps(350, 0.25), dust: clumps(700, 0.6) };
    }
    const c = cache;
    const at = (r: number, beta: number): [number, number] => [r * Math.cos(beta), r * Math.sin(beta)];
    const barAngle = 0.6;

    const pick = rand();
    const bulgeShare = 0.06 + 0.4 * shape.bulge;
    const youngShare = 0.15 + 0.35 * shape.young;
    if (pick < bulgeShare) {
      if (shape.bar > 0 && rand() < 0.35) {
        const u = ((rand() + rand() + rand() - 1.5) / 1.5) * shape.bar, v = s.gauss() * 0.05 * shape.bar / 0.3, w = s.gauss() * 0.02;
        emit.star(u * Math.cos(barAngle) - v * Math.sin(barAngle), u * Math.sin(barAngle) + v * Math.cos(barAngle), w, s.between(0.006, 0.014), ...OLD, 1.2);
      } else {
        const r = -(0.035 + 0.05 * shape.bulge) * Math.log((1 - rand()) * (1 - rand()) * (1 - rand()));
        const gx = s.gauss(), gy = s.gauss(), gz = s.gauss(), n = Math.hypot(gx, gy, gz) || 1;
        emit.star((r * gx) / n, (r * gy) / n, (0.65 * r * gz) / n, s.between(0.006, 0.014), ...OLD, 1.2);
      }
    } else if (pick < bulgeShare + youngShare) {
      let r: number, beta: number;
      if (rand() < 0.45) {
        const cl = c.ob[Math.floor(rand() * c.ob.length)];
        r = cl[0] + s.gauss() * 0.006;
        beta = cl[1] + (s.gauss() * 0.006) / Math.max(cl[0], 0.05);
      } else {
        [r, beta] = shape.ring && rand() < 0.3 ? ringPoint(0.015) : armPoint();
        r += s.gauss() * width(r);
        beta += s.gauss() * 0.01;
      }
      emit.star(...at(r, beta), s.gauss() * 0.005, s.between(0.003, 0.009), ...YOUNG, 1.1);
    } else if (pick < bulgeShare + youngShare + 0.03 + 0.04 * shape.young) {
      const cl = c.hii[Math.floor(rand() * c.hii.length)];
      emit.star(...at(cl[0] + s.gauss() * 0.003, cl[1] + (s.gauss() * 0.003) / Math.max(cl[0], 0.05)), s.gauss() * 0.002, s.between(0.002, 0.004), ...HII, 0.35);
    } else if (pick < 0.97) {
      let r: number, beta: number;
      for (;;) {
        r = s.diskRadius(0.28);
        if (r > 1.05) continue;
        beta = rand() * 2 * Math.PI;
        const inner = shape.bar > 0 ? 0.5 + 0.5 * smoothstep(shape.bar * 0.5, shape.bar, r) : 1;
        if (rand() < inner * (0.22 + 0.78 * boost(r, beta))) break;
      }
      const outer = smoothstep(0.2, 0.9, r);
      emit.star(...at(r, beta), s.laplace(0.012), s.between(0.005, 0.013), 1 - 0.12 * outer, 0.9, 0.78 + 0.2 * outer, 0.8);
    } else {
      const r = Math.min(2.5, -0.2 * Math.log((1 - rand()) * (1 - rand()) * (1 - rand())));
      const gx = s.gauss(), gy = s.gauss(), gz = s.gauss(), n = Math.hypot(gx, gy, gz) || 1;
      emit.star((r * gx) / n, (r * gy) / n, (0.8 * r * gz) / n, s.between(0.02, 0.05), ...OLD, 0.2);
    }

    // Polvo, a su ritmo: grumos y franjas en el borde interior de los brazos y una capa fina.
    if (rand() < 0.35) {
      const d = rand();
      if (d < 0.4) {
        const cl = c.dust[Math.floor(rand() * c.dust.length)];
        const spread = 0.004 + 0.008 * rand();
        emit.dust(...at(cl[0] + s.gauss() * spread, cl[1] + (s.gauss() * spread * 1.6) / Math.max(cl[0], 0.05)), s.gauss() * 0.003, s.between(0.006, 0.014));
      } else if (d < 0.7) {
        const [r, beta] = shape.ring && rand() < 0.45 ? ringPoint(0.01) : armPoint();
        const w = width(r);
        emit.dust(...at(r - 0.6 * w + s.gauss() * 0.3 * w, beta + s.gauss() * 0.02), s.gauss() * 0.003, s.between(0.006, 0.014));
      } else {
        const r = Math.min(1, s.diskRadius(0.3));
        emit.dust(...at(r, rand() * 2 * Math.PI), s.laplace(0.004), s.between(0.008, 0.016));
      }
    }
  };
}

function ellipticalTemplate() {
  return (shape: GalaxyShape, rand: () => number, s: Samplers, emit: Emit) => {
    if (shape.kind !== 'elliptical') return;
    const [qy, qz] = shape.axes;
    const pick = rand();
    if (shape.jet && pick < 0.012) {
      // Chorro: del centro hacia +x, con nudos (más densidad en unos tramos que en otros).
      const t = Math.pow(rand(), 0.7) * 0.09;
      const knot = 0.6 + 0.4 * Math.sin(t * 220);
      if (rand() < knot) emit.star(t, s.gauss() * 0.0015, s.gauss() * 0.0015, s.between(0.001, 0.0025), 0.72, 0.85, 1, 2.5);
      return;
    }
    if (shape.dustDisk && pick < 0.1) {
      // Disco alabeado de una espiral tragada: estrellas jóvenes y regiones HII junto al polvo.
      const r = s.between(0.04, shape.dustDisk), beta = rand() * 2 * Math.PI;
      const warp = 0.12 * r * Math.sin(beta);
      const young = rand() < 0.7;
      emit.star(r * Math.cos(beta), r * Math.sin(beta), warp + s.gauss() * 0.006, young ? s.between(0.003, 0.008) : s.between(0.002, 0.004), ...(young ? YOUNG : HII), young ? 0.8 : 0.35);
      return;
    }
    if (pick < 0.13) {
      // Cúmulos globulares: puntos pequeños y brillantes, más repartidos que las estrellas.
      const r = Math.min(1.6, 0.35 * Math.pow(-Math.log(1 - rand()), 1.2));
      const gx = s.gauss(), gy = s.gauss(), gz = s.gauss(), n = Math.hypot(gx, gy, gz) || 1;
      if (rand() < 0.3) emit.star((r * gx) / n, (r * gy) / n, (r * gz) / n, s.between(0.002, 0.004), 1, 0.9, 0.75, 1.5);
    } else {
      // Muy concentrada en el centro y con un halo extenso (perfil de tipo de Vaucouleurs).
      let r = 2;
      while (r > 1.3) r = 0.07 * Math.pow(-Math.log(1 - rand()), 2);
      const gx = s.gauss(), gy = s.gauss(), gz = s.gauss(), n = Math.hypot(gx, gy, gz) || 1;
      const outer = smoothstep(0, 0.6, r);
      emit.star((r * gx) / n, (qy * r * gy) / n, (qz * r * gz) / n, s.between(0.01, 0.028), 1, 0.72 + 0.12 * outer, 0.48 + 0.18 * outer, 1);
    }
    if (shape.dustDisk && rand() < 0.3) {
      const r = s.between(0.05, shape.dustDisk), beta = rand() * 2 * Math.PI;
      emit.dust(r * Math.cos(beta), r * Math.sin(beta), 0.12 * r * Math.sin(beta) + s.gauss() * 0.005, s.between(0.008, 0.018));
    }
  };
}

function irregularTemplate() {
  let cache: { shape: GalaxyShape; clumps: [number, number, number][] } | null = null;
  return (shape: GalaxyShape, rand: () => number, s: Samplers, emit: Emit) => {
    if (shape.kind !== 'irregular') return;
    if (cache?.shape !== shape) {
      // El primer grumo es el mayor (la Tarántula en la Gran Nube).
      cache = { shape, clumps: Array.from({ length: shape.clumps }, (_, i): [number, number, number] => [s.gauss() * 0.32, s.gauss() * 0.28, i === 0 ? 0.07 : s.between(0.025, 0.06)]) };
    }
    const c = cache;
    const pick = rand();
    if (shape.wind && pick < 0.12) {
      // Viento del brote estelar: filamentos rojos por encima y por debajo del disco.
      const filament = Math.floor(rand() * 24), side = filament % 2 ? 1 : -1;
      const h = s.between(0.03, 0.5), a = (filament / 24) * 2 * Math.PI;
      const spread = 0.12 + 0.35 * h;
      emit.star(Math.cos(a) * spread * h * 2 + s.gauss() * 0.01, Math.sin(a) * spread * h + s.gauss() * 0.01, side * h, s.between(0.004, 0.01), 1, 0.3, 0.32, 0.5);
      return;
    }
    if (pick < 0.3) {
      // Barra descentrada.
      const u = ((rand() + rand() + rand() - 1.5) / 1.5) * shape.bar;
      emit.star(0.12 + u, 0.05 + s.gauss() * 0.06, s.gauss() * 0.03, s.between(0.008, 0.02), ...DISK, 1);
    } else if (pick < 0.6) {
      const cl = c.clumps[Math.floor(rand() * c.clumps.length)];
      const hii = rand() < 0.3;
      emit.star(cl[0] + s.gauss() * cl[2], cl[1] + s.gauss() * cl[2], s.gauss() * 0.02, hii ? s.between(0.003, 0.007) : s.between(0.005, 0.012), ...(hii ? HII : YOUNG), hii ? 0.4 : 1);
    } else {
      emit.star(s.gauss() * 0.36, s.gauss() * 0.28, s.gauss() * 0.06, s.between(0.01, 0.025), ...DISK, 0.8);
    }
    if (rand() < 0.1) {
      const cl = c.clumps[Math.floor(rand() * c.clumps.length)];
      emit.dust(cl[0] + s.gauss() * cl[2] * 1.4, cl[1] + s.gauss() * cl[2] * 1.4, s.gauss() * 0.02, s.between(0.01, 0.025));
    }
  };
}

function lenticularTemplate() {
  return (shape: GalaxyShape, rand: () => number, s: Samplers, emit: Emit) => {
    if (shape.kind !== 'lenticular') return;
    const pick = rand();
    if (pick < shape.bulge) {
      const r = Math.min(1.4, -0.1 * Math.log((1 - rand()) * (1 - rand()) * (1 - rand())));
      const gx = s.gauss(), gy = s.gauss(), gz = s.gauss(), n = Math.hypot(gx, gy, gz) || 1;
      emit.star((r * gx) / n, (r * gy) / n, (0.72 * r * gz) / n, s.between(0.01, 0.024), ...OLD, 1.1);
    } else if (pick < shape.bulge + 0.04) {
      const r = Math.min(1.5, -0.35 * Math.log((1 - rand()) * (1 - rand())));
      const gx = s.gauss(), gy = s.gauss(), gz = s.gauss(), n = Math.hypot(gx, gy, gz) || 1;
      emit.star((r * gx) / n, (r * gy) / n, (r * gz) / n, s.between(0.002, 0.004), 1, 0.9, 0.75, 1.5);
    } else if (pick < shape.bulge + 0.1) {
      // Estrellas jóvenes justo por fuera del anillo de polvo.
      const r = shape.dustRing + 0.04 + s.gauss() * 0.025, beta = rand() * 2 * Math.PI;
      emit.star(r * Math.cos(beta), r * Math.sin(beta), s.gauss() * 0.004, s.between(0.003, 0.008), ...YOUNG, 0.8);
    } else {
      const r = Math.min(1, s.diskRadius(0.3)), beta = rand() * 2 * Math.PI;
      emit.star(r * Math.cos(beta), r * Math.sin(beta), s.laplace(0.008), s.between(0.006, 0.014), ...DISK, 0.8);
    }
    if (rand() < 0.3) {
      const ring = rand() < 0.8;
      const r = ring ? shape.dustRing + s.gauss() * 0.035 : s.between(0.45, 0.95), beta = rand() * 2 * Math.PI;
      emit.dust(r * Math.cos(beta), r * Math.sin(beta), s.gauss() * 0.005, s.between(0.008, 0.016));
    }
  };
}
