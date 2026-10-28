/**
 * La Estación Espacial Internacional hecha de partículas. Ver docs/ARQUITECTURA.md §8.
 *
 * Modelo de las piezas principales a escala (en metros, de los planos de la NASA): la
 * armadura de 109 m, las ocho alas solares (35 × 11,6 m), los radiadores, los módulos
 * presurizados (Zvezda y Zariá a popa; Unity, Destiny y Harmony con Columbus y Kibo a proa)
 * y las alas rusas. Vuela como la real: +x hacia la velocidad, +z hacia la Tierra y la
 * armadura de babor a estribor; las alas giran con las juntas alfa y beta para mirar al Sol.
 * En la sombra de la Tierra se apaga (§5.3) y desde abajo la ilumina la Tierra.
 *
 * Un solo nivel (unas 60.000 partículas) en orden aleatorio: cualquier prefijo es un
 * submuestreo uniforme para el LOD por densidad.
 */
import * as THREE from 'three/webgpu';
import { float, max, mix, modelWorldMatrix, pow, reflect, select, smoothstep, step, transformDirection, uniform, vec3, vec4 } from 'three/tsl';
import type { BodyData } from '../astro/bodies';
import { eclToScene } from '../astro/frames';
import { ISS_SERVICE, issGeocentricPosition } from '../astro/iss';
import { ball, ballDepth, ballSprite, hardDisc, viewDirection } from '../particles/nodes';
import { ParticleField } from '../particles/ParticleField';
import { BaseBody } from './BaseBody';
import type { CelestialBody, FrameContext } from './CelestialBody';
import { DetailTier, type TierKind } from './DetailTier';
import { rockyLook } from './RockyPlanet';

/** Metros por unidad local (el radio del cuerpo: media armadura). */
const UNIT_M = 54.5;
/** Separación entre partículas en las superficies (m). */
const SPACING_M = 0.32;
/** Por encima de esta velocidad del reloj (s/s) la estación da vueltas a saltos: se oculta si no está enfocada. */
const MAX_RATE = 3600;

/** Tipos de pieza (w de la posición): las alas (4) se colocan en el shader con la junta del Sol. */
const enum Part {
  Module = 0,
  Truss = 1,
  Radiator = 2,
  RussianArray = 3,
  Array = 4,
}

interface Model {
  position: Float32Array;
  normal: Float32Array;
  color: Float32Array;
  count: number;
}

/** Modelo en metros: posición (xyz, tipo), normal (xyz, aleatorio) y color lineal (rgb, brillo especular). */
function buildModel(): Model {
  const pos: number[] = [], nor: number[] = [], col: number[] = [];
  const rand = mulberry(25544);
  const push = (p: [number, number, number], n: [number, number, number], c: [number, number, number], part: Part, gloss = 0) => {
    pos.push(p[0], p[1], p[2], part);
    nor.push(n[0], n[1], n[2], rand());
    col.push(c[0], c[1], c[2], gloss);
  };
  const jitter = () => (rand() - 0.5) * SPACING_M * 0.5;

  /** Cilindro (módulo): centro, eje (0 x, 1 y, 2 z), radio, de `a` a `b` a lo largo del eje. */
  const cylinder = (center: [number, number, number], axis: 0 | 1 | 2, r: number, a: number, b: number, c: [number, number, number]) => {
    const around = Math.max(12, Math.round((2 * Math.PI * r) / SPACING_M));
    const along = Math.max(2, Math.round(Math.abs(b - a) / SPACING_M));
    const place = (t: number, u: number, v: number): [number, number, number] => {
      const p: [number, number, number] = [...center];
      p[axis] += t;
      p[(axis + 1) % 3] += u;
      p[(axis + 2) % 3] += v;
      return p;
    };
    const dir = (u: number, v: number): [number, number, number] => {
      const n: [number, number, number] = [0, 0, 0];
      n[(axis + 1) % 3] = u;
      n[(axis + 2) % 3] = v;
      return n;
    };
    const shade = () => {
      const k = 0.92 + rand() * 0.16;
      return [c[0] * k, c[1] * k, c[2] * k] as [number, number, number];
    };
    for (let i = 0; i < along; i++) {
      for (let j = 0; j < around; j++) {
        const t = a + ((i + 0.5 + jitter() / SPACING_M) / along) * (b - a);
        const ang = ((j + (i % 2) * 0.5) / around) * Math.PI * 2;
        push(place(t, Math.cos(ang) * r, Math.sin(ang) * r), dir(Math.cos(ang), Math.sin(ang)), shade(), Part.Module, 0.15);
      }
    }
    // Tapas.
    for (const end of [a, b]) {
      const rings = Math.max(1, Math.round(r / SPACING_M));
      for (let k = 1; k <= rings; k++) {
        const rr = (k / rings) * r * 0.97;
        const n = Math.max(6, Math.round((2 * Math.PI * rr) / SPACING_M));
        for (let j = 0; j < n; j++) {
          const ang = (j / n) * Math.PI * 2;
          const normal: [number, number, number] = [0, 0, 0];
          normal[axis] = end === Math.max(a, b) ? 1 : -1;
          push(place(end, Math.cos(ang) * rr, Math.sin(ang) * rr), normal, shade(), Part.Module, 0.15);
        }
      }
    }
  };

  /** Placa rectangular: centro, ejes del plano (unitarios) con sus medias longitudes, normal. */
  const plate = (
    center: [number, number, number], e1: [number, number, number], h1: number, e2: [number, number, number], h2: number,
    normal: [number, number, number], color: (s: number, t: number) => [number, number, number], part: Part, gloss: number,
  ) => {
    const n1 = Math.round((2 * h1) / SPACING_M), n2 = Math.round((2 * h2) / SPACING_M);
    for (let i = 0; i < n1; i++) {
      for (let j = 0; j < n2; j++) {
        const s = -h1 + ((i + 0.5) / n1) * 2 * h1 + jitter(), t = -h2 + ((j + 0.5) / n2) * 2 * h2 + jitter();
        push([center[0] + e1[0] * s + e2[0] * t, center[1] + e1[1] * s + e2[1] * t, center[2] + e1[2] * s + e2[2] * t], normal, color(s, t), part, gloss);
      }
    }
  };

  /** Barra de la armadura: puntos a lo largo de un segmento. */
  const strut = (a: [number, number, number], b: [number, number, number], c: [number, number, number]) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const n = Math.max(2, Math.round(len / (SPACING_M * 0.8)));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t], [0, 0, 0], c, Part.Truss, 0.3);
    }
  };

  const WHITE: [number, number, number] = [0.8, 0.8, 0.76];
  const RUSSIAN: [number, number, number] = [0.66, 0.69, 0.63];
  const METAL: [number, number, number] = [0.5, 0.5, 0.53];

  // Armadura integrada: de babor (−y) a estribor (+y), sobre los módulos (cenit = −z).
  const T = 2.4, tz = -4.6, half = 54.5;
  const corners: [number, number][] = [[-T, tz - T], [T, tz - T], [T, tz + T], [-T, tz + T]];
  for (const [x, z] of corners) strut([x, -half, z], [x, half, z], METAL);
  const bays = Math.round((2 * half) / 4.6);
  for (let k = 0; k <= bays; k++) {
    const y = -half + (k / bays) * 2 * half, y2 = -half + ((k + 1) / bays) * 2 * half;
    for (let c = 0; c < 4; c++) {
      const [x0, z0] = corners[c], [x1, z1] = corners[(c + 1) % 4];
      strut([x0, y, z0], [x1, y, z1], METAL);
      if (k < bays) strut([x0, y, z0], [x1, y2, z1], METAL);
    }
  }

  // Alas solares: ocho, en cuatro conjuntos. Se guardan en coordenadas del ala (largo u, ancho
  // v, centro y del conjunto) y el shader las gira con las juntas hacia el Sol.
  for (const yc of [-48.5, -36, 36, 48.5]) {
    for (const sign of [-1, 1]) {
      const n1 = Math.round(35 / SPACING_M), n2 = Math.round(11.6 / SPACING_M);
      for (let i = 0; i < n1; i++) {
        for (let j = 0; j < n2; j++) {
          const u = sign * (1.5 + ((i + 0.5) / n1) * 35 + jitter()), v = -5.8 + ((j + 0.5) / n2) * 11.6 + jitter();
          // Paneles de 4,4 m separados por juntas claras; el mástil en el centro.
          const seam = Math.abs(v) < 0.35 || ((Math.abs(u) - 1.5) % 4.4) < 0.28;
          const c: [number, number, number] = seam ? [0.32, 0.28, 0.2] : [0.03 + rand() * 0.01, 0.045 + rand() * 0.012, 0.13 + rand() * 0.03];
          pos.push(u, v, yc, Part.Array);
          nor.push(0, 0, 0, rand());
          col.push(c[0], c[1], c[2], seam ? 0.2 : 0.9);
        }
      }
    }
  }

  // Radiadores (S1 y P1): tres placas por lado hacia la Tierra (+z), de canto al Sol.
  for (const side of [-1, 1]) {
    for (const y of [12.5, 16.2, 19.9]) {
      plate([0, side * y, 11.8], [0, 0, 1], 11.6, [0, 1, 0], 1.6, [1, 0, 0], () => [0.86, 0.87, 0.9], Part.Radiator, 0.35);
    }
  }

  // Módulos presurizados a lo largo de x (proa = +x, popa = −x).
  cylinder([0, 0, 0], 0, 2.05, -29.5, -17.2, RUSSIAN); // Zvezda
  cylinder([0, 0, 0], 0, 2.05, -17.2, -4.2, RUSSIAN); // Zariá
  cylinder([0, 0, 0], 0, 2.3, -4.2, 1.4, WHITE); // Unity
  cylinder([0, 0, 0], 0, 2.15, 1.4, 9.9, WHITE); // Destiny
  cylinder([0, 0, 0], 0, 2.2, 9.9, 17.1, WHITE); // Harmony
  cylinder([13.6, 0, 0], 1, 2.25, 2.2, 9.2, WHITE); // Columbus (estribor)
  cylinder([13.6, 0, 0], 1, 2.2, -13.4, -2.2, WHITE); // Kibo (babor)
  cylinder([13.6, -8, 0], 2, 2.1, -6.6, -2.2, WHITE); // Kibo: módulo logístico
  cylinder([-1.4, 0, 0], 1, 2.25, -9.1, -2.3, WHITE); // Tranquility
  cylinder([-1.4, -6.2, 0], 2, 1.45, 2.3, 3.8, [0.55, 0.57, 0.6]); // Cúpula
  cylinder([-22.6, 0, 0], 2, 2.1, 2.1, 15.2, RUSSIAN); // Nauka (nadir)
  cylinder([-22.6, 0, 0], 2, 1.3, -6.8, -2.1, RUSSIAN); // Poisk (cenit)
  // Plataforma exterior de Kibo.
  plate([13.6, -16.4, 0], [0, 1, 0], 3, [1, 0, 0], 2.5, [0, 0, -1], () => [0.7, 0.7, 0.68], Part.Radiator, 0.2);

  // Alas rusas de Zvezda: fijas, a lo largo de y.
  for (const side of [-1, 1]) {
    plate([-26.5, side * 9.6, 0], [0, 1, 0], 7.2, [1, 0, 0], 1.8, [0, 0, -1], () => [0.045, 0.06, 0.15], Part.RussianArray, 0.8);
  }

  const count = pos.length / 4;
  // Orden aleatorio: cualquier prefijo es un submuestreo uniforme (LOD).
  const order = Array.from({ length: count }, (_, i) => i);
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const out = (src: number[], scale: number, scaleW: boolean) => {
    const a = new Float32Array(count * 4);
    order.forEach((from, to) => {
      for (let c = 0; c < 3; c++) a[to * 4 + c] = src[from * 4 + c] * scale;
      a[to * 4 + 3] = src[from * 4 + 3] * (scaleW ? scale : 1);
    });
    return a;
  };
  // Las alas guardan (u, v, y del conjunto): todo pasa a unidades locales salvo el tipo.
  return { position: out(pos, 1 / UNIT_M, false), normal: out(nor, 1, false), color: out(col, 1, false), count };
}

/** Generador pseudoaleatorio determinista (mulberry32). */
function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Station extends BaseBody {
  protected readonly hasFullTier = false;
  /** Ejes del ala con las juntas alfa y beta (espacio local): largo, ancho y normal (hacia el Sol). */
  private readonly wingLength = uniform(new THREE.Vector3(1, 0, 0));
  private readonly wingWidth = uniform(new THREE.Vector3(0, 1, 0));
  private readonly wingNormal = uniform(new THREE.Vector3(0, 0, -1));
  /** Sol (0–1, con la sombra de la Tierra) y luz de la Tierra desde abajo. */
  private readonly sunlight = uniform(1);
  private readonly nadir = uniform(new THREE.Vector3(0, -1, 0));
  private readonly earthshine = uniform(0);
  /** Tamaño de punto (local): crece cuando el LOD dibuja menos. */
  private readonly dot = uniform(SPACING_M / UNIT_M);

  constructor(data: BodyData, parent: CelestialBody | null) {
    super(data, parent);
    this.start();
  }

  protected async buildTier(kind: TierKind): Promise<DetailTier> {
    const tier = new DetailTier(kind);
    const model = buildModel();
    const position = tier.buffer(model.position).toAttribute();
    const normal = tier.buffer(model.normal).toAttribute();
    const color = tier.buffer(model.color).toAttribute();

    const part = position.w;
    const isArray = step(3.5, part);
    // Alas: (u, v, y del conjunto) → sobre el eje de la armadura, girada hacia el Sol.
    const hinge = vec3(0, position.z, -4.6 / UNIT_M);
    const wing = hinge.add(this.wingLength.mul(position.x)).add(this.wingWidth.mul(position.y));
    const local = select(isArray.greaterThan(0.5), wing, position.xyz);
    const center = this.condense(local, normal.w, tier.appear);

    const field = new ParticleField(model.count, 'solid');
    const material = field.material;
    const { scale, visibility } = ballSprite({ center, size: this.dot, minPixels: 1.1, objectScale: this.objectScale });
    material.positionNode = center;
    material.scaleNode = scale;
    material.opacityNode = hardDisc();
    const b = ball();
    material.depthNode = ballDepth(b, scale.mul(this.objectScale).mul(0.5));

    // Normal: la de la pieza o la del ala; las placas se ven por las dos caras.
    const n0 = select(isArray.greaterThan(0.5), this.wingNormal, normal.xyz);
    const hasNormal = step(0.5, n0.length());
    const nWorld = transformDirection(select(hasNormal.greaterThan(0.5), n0, vec3(0, 0, -1)), modelWorldMatrix);
    const v = viewDirection(center);
    // Radiadores y alas (tipos ≥ 2) se ven por las dos caras.
    const twoSided = step(1.5, part);
    const facing = nWorld.dot(v);
    const n = select(twoSided.greaterThan(0.5).and(facing.lessThan(0)), nWorld.negate(), nWorld);
    // Celdas de las alas por delante (azul oscuro) y kapton dorado por detrás.
    const back = isArray.mul(step(facing, 0));
    const albedo = mix(color.xyz, vec3(0.55, 0.38, 0.15), back);

    const sun = this.sunDirection;
    const flat = mix(float(0.75), max(n.dot(sun), 0), hasNormal);
    const ballLit = max(b.normal.dot(sun), 0);
    const lit = mix(flat, ballLit.mul(flat.add(0.2).min(1)), visibility.mul(0.5)).mul(this.sunlight);
    // Luz de la Tierra desde abajo (azulada, solo si el suelo de debajo es de día).
    const shine = max(mix(float(0.5), n.dot(this.nadir), hasNormal), 0).mul(this.earthshine);
    // Brillo especular: las alas destellan al reflejar el Sol.
    const glint = pow(max(reflect(sun.negate(), n).dot(v), 0), 48).mul(color.w).mul(this.sunlight).mul(1.4);
    // Al cruzar el terminador, la luz que queda es rojiza.
    const dusk = smoothstep(0.02, 0.5, this.sunlight).mul(smoothstep(1, 0.55, this.sunlight));
    const sunColor = mix(vec3(1, 1, 1), vec3(1, 0.55, 0.32), dusk);
    const rgb = albedo.mul(sunColor.mul(lit).add(vec3(0.35, 0.5, 0.8).mul(shine)).add(rockyLook.ambient))
      .mul(mix(float(1), float(0.6).add(b.facing.mul(0.4)), visibility))
      .add(sunColor.mul(glint));
    material.colorNode = vec4(rgb, 1);

    tier.addField(field, false);
    tier.total = model.count;
    tier.updates.push(() => {
      this.dot.value = (SPACING_M / UNIT_M) * 0.95 * Math.sqrt(model.count / Math.max(1, field.object.count));
    });
    return tier;
  }

  update(ctx: FrameContext): void {
    super.update(ctx);
    // Fuera de servicio (antes de 1998 o tras la retirada) o a saltos con el reloj muy rápido.
    const inService = ctx.timeMs >= ISS_SERVICE.fromMs && ctx.timeMs <= ISS_SERVICE.toMs;
    this.object3d.visible = inService && (this.isFocused || ctx.timeRate < MAX_RATE);

    // Sombra de la Tierra (§5.3) en el centro y luz de la Tierra desde abajo.
    this.sunlight.value = this.shadow ? this.shadow.lightAt({ x: 0, y: 0, z: 0 }) : 1;
    const earth = this.parent;
    if (earth) {
      const toEarth = earth.object3d.position.clone().sub(this.object3d.position).normalize();
      this.nadir.value.copy(toEarth);
      this.earthshine.value = 0.35 * THREE.MathUtils.smoothstep(-toEarth.dot(this.sunDirection.value), -0.1, 0.4);
    }
    // Juntas: alfa gira las alas alrededor de la armadura (y) y beta las inclina hacia el Sol.
    const sun = this.sunDirection.value.clone().applyQuaternion(this.object3d.quaternion.clone().invert());
    const xz = new THREE.Vector3(sun.x, 0, sun.z);
    if (xz.lengthSq() < 1e-8) xz.set(0, 0, -1);
    xz.normalize();
    const beta = Math.asin(THREE.MathUtils.clamp(sun.y, -1, 1));
    const y = new THREE.Vector3(0, 1, 0);
    this.wingLength.value.crossVectors(y, xz).normalize();
    this.wingNormal.value.copy(xz).multiplyScalar(Math.cos(beta)).addScaledVector(y, Math.sin(beta));
    this.wingWidth.value.copy(y).multiplyScalar(Math.cos(beta)).addScaledVector(xz, -Math.sin(beta));
  }

  /**
   * Actitud de vuelo (+XVV): +x hacia la velocidad, +z hacia la Tierra y +y = z × x (estribor).
   * La velocidad sale de la posición un segundo después.
   */
  orient(timeMs: number): void {
    if (timeMs === this.orientedTime) return;
    this.orientedTime = timeMs;
    const p = eclToScene(issGeocentricPosition(timeMs));
    const q = eclToScene(issGeocentricPosition(timeMs + 1000));
    const z = new THREE.Vector3(-p.x, -p.y, -p.z).normalize();
    const x = new THREE.Vector3(q.x - p.x, q.y - p.y, q.z - p.z);
    x.addScaledVector(z, -x.dot(z)).normalize();
    const yAxis = new THREE.Vector3().crossVectors(z, x);
    attitude.makeBasis(x, yAxis, z);
    this.object3d.quaternion.setFromRotationMatrix(attitude);
    this.spin.rotation.y = 0;
  }
  private orientedTime = NaN;
}

const attitude = new THREE.Matrix4();
