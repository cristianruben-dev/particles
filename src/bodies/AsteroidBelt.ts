/**
 * Cinturones de asteroides (principal, troyanos de Júpiter y Kuiper) con órbitas
 * propagadas en GPU. Ver docs/ARQUITECTURA.md §8.
 *
 * Cada partícula tiene sus elementos orbitales. Una pasada compute avanza su anomalía
 * media con el tiempo simulado (cada una con su periodo: no hay un tiempo común que
 * reducir) y resuelve Kepler. La posición heliocéntrica (km) pasa a escena con
 * `ScaleSystem.distanceNode`, como cualquier otro cuerpo hijo del Sol.
 */
import * as THREE from 'three/webgpu';
import { Fn, Loop, atan, cos, float, instanceIndex, instancedArray, modelWorldMatrix, sin, sqrt, uniform, vec3, vec4 } from 'three/tsl';
import { handoff } from '../core/Handoff';
import { horizonMask } from '../core/Horizon';
import { BODIES } from '../astro/bodies';
import { AU_KM, DEG } from '../astro/units';
import { pixelAngle, softDisc } from '../particles/nodes';
import { ParticleField } from '../particles/ParticleField';
import type { ScaleSystem } from '../scale/ScaleSystem';
import type { FrameContext } from './CelestialBody';

export const beltLook = {
  brightness: uniform(0.55),
};

/** GM del Sol (km³/s²). */
const GM_SUN = 1.32712440018e11;

/** Resonancias con Júpiter que vacían el cinturón (huecos de Kirkwood), en UA, con su anchura. */
const KIRKWOOD_GAPS = [
  { a: 2.065, width: 0.03 }, // 4:1 (borde interior)
  { a: 2.502, width: 0.025 }, // 3:1
  { a: 2.825, width: 0.02 }, // 5:2
  { a: 2.958, width: 0.015 }, // 7:3
  { a: 3.279, width: 0.03 }, // 2:1
];

type Population = 'main' | 'trojans' | 'kuiper';

export interface BeltOptions {
  population: Population;
  count: number;
  /** Tamaño en píxeles CSS y color (sRGB). */
  sizePx: number;
  color: number;
}

export class AsteroidBelt {
  readonly object: THREE.Sprite;
  readonly field: ParticleField;
  private readonly dt = uniform(0);
  /** Atenuación cuando la cámara está dentro del cinturón: si no, llena el cielo de puntos. */
  private readonly inside = uniform(1);
  private readonly radiusKm: number;
  /** Afelio más lejano de la población (km): la esfera que la contiene. */
  private readonly outerKm: number;
  private readonly step: THREE.ComputeNode;
  private lastTimeMs: number | null = null;

  constructor(readonly options: BeltOptions, scale: ScaleSystem) {
    const { count } = options;
    const { elements, anomaly } = sampleElements(options.population, count);
    this.radiusKm = { main: 2.7, trojans: 5.2, kuiper: 44 }[options.population] * AU_KM;
    this.outerKm = { main: 4.6, trojans: 6.5, kuiper: 73 }[options.population] * AU_KM;
    // (anomalía media, a km, e, —) y (i, nodo, argumento del perihelio, brillo).
    const orbitA = instancedArray(anomaly, 'vec4');
    const orbitB = instancedArray(elements, 'vec4');
    // Dirección en ejes de escena (xyz) y distancia al Sol en km (w).
    const position = instancedArray(count, 'vec4');

    this.step = Fn(() => {
      const a = orbitA.element(instanceIndex);
      const b = orbitB.element(instanceIndex);
      const semi = a.y, e = a.z;
      // Movimiento medio n = √(GM/a³) (rad/s); M avanza y se reduce a [0, 2π).
      const n = sqrt(float(GM_SUN).div(semi.mul(semi).mul(semi)));
      const twoPi = Math.PI * 2;
      const M = a.x.add(n.mul(this.dt));
      const Mw = M.sub(M.div(twoPi).floor().mul(twoPi)).toVar();
      a.x.assign(Mw);
      // Kepler por Newton (5 pasos de sobra con e < 0,4).
      const E = Mw.add(e.mul(sin(Mw))).toVar();
      Loop(5, () => {
        E.assign(E.sub(E.sub(e.mul(sin(E))).sub(Mw).div(float(1).sub(e.mul(cos(E))))));
      });
      const nu = atan(sqrt(float(1).sub(e.mul(e))).mul(sin(E)), cos(E).sub(e));
      const r = semi.mul(float(1).sub(e.mul(cos(E))));
      // Plano orbital → eclíptica (i, Ω, ω) → ejes de escena (x, z, −y).
      const i = b.x, node = b.y, peri = b.z;
      const u = nu.add(peri);
      const cu = cos(u), su = sin(u), cO = cos(node), sO = sin(node), ci = cos(i), si = sin(i);
      const ex = cO.mul(cu).sub(sO.mul(su).mul(ci));
      const ey = sO.mul(cu).add(cO.mul(su).mul(ci));
      const ez = su.mul(si);
      position.element(instanceIndex).assign(vec4(vec3(ex, ez, ey.negate()), r));
    })().compute(count);

    const p = position.toAttribute();
    // Dirección × distancia de escena: la misma función que coloca los planetas.
    const center = p.xyz.mul(scale.distanceNode(BODIES.sun, p.w));

    this.field = new ParticleField(count, 'additive');
    const material = this.field.material;
    material.sizeAttenuation = false;
    material.positionNode = center;
    material.scaleNode = pixelAngle.mul(options.sizePx);
    const c = new THREE.Color(options.color);
    const world = modelWorldMatrix.mul(vec4(center, 1)).xyz;
    material.colorNode = vec4(vec3(c.r, c.g, c.b).mul(orbitB.toAttribute().w).mul(beltLook.brightness).mul(this.inside).mul(horizonMask(world)).mul(handoff.solar), 1);
    material.opacityNode = softDisc();
    this.object = this.field.object;
  }

  update(ctx: FrameContext, sunScene: { x: number; y: number; z: number }): void {
    ctx.origin.place(this.object, sunScene);
    // Desde fuera se ve el anillo entero; desde dentro, apenas un polvo tenue.
    const cameraToSun = this.object.position.length();
    const beltRadius = ctx.scale.localDistance(BODIES.sun, this.radiusKm);
    this.inside.value = 0.15 + 0.85 * THREE.MathUtils.smoothstep(cameraToSun, beltRadius * 0.9, beltRadius * 2.5);
    if (ctx.timeMs === this.lastTimeMs) return;
    // Fuera del sistema solar o del campo de visión no se calcula: el siguiente paso avanza todo
    // lo pendiente de golpe, como tras un salto de fecha.
    viewSphere.center.copy(this.object.position);
    viewSphere.radius = ctx.scale.localDistance(BODIES.sun, this.outerKm);
    if (!this.object.visible || !ctx.frustum.intersectsSphere(viewSphere)) return;
    // Paso de tiempo simulado; tras un salto de fecha se avanza todo de golpe.
    const elapsedMs = this.lastTimeMs === null ? ctx.timeMs - EPOCH_MS : ctx.timeMs - this.lastTimeMs;
    this.lastTimeMs = ctx.timeMs;
    this.dt.value = elapsedMs / 1000;
    ctx.renderer.compute(this.step);
  }
}

const viewSphere = new THREE.Sphere();

/** Época de las anomalías iniciales: J2000. */
const EPOCH_MS = Date.UTC(2000, 0, 1, 12);

/** Elementos aleatorios de cada población. Devuelve (M, a, e, —) y (i, Ω, ω, brillo). */
function sampleElements(population: Population, count: number): { anomaly: Float32Array; elements: Float32Array } {
  const anomaly = new Float32Array(count * 4);
  const elements = new Float32Array(count * 4);
  const rayleigh = (sigma: number) => sigma * Math.sqrt(-2 * Math.log(1 - Math.random()));
  // Júpiter en J2000, para los troyanos (L4 a +60°, L5 a −60°).
  const jupiter = BODIES.jupiter.orbit!;

  for (let k = 0; k < count; k++) {
    let a: number, e: number, i: number, node: number, peri: number, M: number;
    if (population === 'main') {
      do a = 2.1 + Math.random() * 1.25; while (inGap(a));
      e = Math.min(0.35, rayleigh(0.12));
      i = rayleigh(7) * DEG;
      node = Math.random() * 2 * Math.PI;
      peri = Math.random() * 2 * Math.PI;
      M = Math.random() * 2 * Math.PI;
    } else if (population === 'trojans') {
      a = jupiter.a.value + (Math.random() - 0.5) * 0.3;
      e = Math.min(0.2, rayleigh(0.06));
      i = rayleigh(12) * DEG;
      node = Math.random() * 2 * Math.PI;
      peri = Math.random() * 2 * Math.PI;
      // Longitud media de Júpiter ± 60° y una nube de ±25° alrededor.
      const L = (jupiter.L.value + (Math.random() < 0.5 ? 60 : -60) + (Math.random() - 0.5) * 50) * DEG;
      M = L - node - peri;
    } else {
      // Cinturón de Kuiper clásico (42–48 UA) y algo de población dispersa.
      a = Math.random() < 0.8 ? 42 + Math.random() * 6 : 36 + Math.random() * 20;
      e = Math.min(0.3, rayleigh(0.07));
      i = rayleigh(6) * DEG;
      node = Math.random() * 2 * Math.PI;
      peri = Math.random() * 2 * Math.PI;
      M = Math.random() * 2 * Math.PI;
    }
    anomaly.set([M, a * AU_KM, e, 0], k * 4);
    elements.set([i, node, peri, 0.4 + Math.random() * 0.6], k * 4);
  }
  return { anomaly, elements };
}

function inGap(a: number): boolean {
  // Probabilidad de rechazo que cae con la distancia al centro del hueco.
  for (const g of KIRKWOOD_GAPS) {
    const d = Math.abs(a - g.a) / g.width;
    if (d < 1 && Math.random() < 1 - d * d) return true;
  }
  return false;
}
