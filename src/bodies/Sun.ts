/**
 * El Sol: granulación animada, oscurecimiento del limbo, corona y protuberancias. Ver
 * docs/ARQUITECTURA.md §8. Todo es emisivo y en HDR: es la fuente principal del bloom.
 *
 * El ruido de la granulación (Worley + fractal) es caro: se calcula una vez por partícula
 * y frame en una pasada compute, no por vértice ni por píxel.
 */
import {
  Fn,
  cos,
  cross,
  float,
  fract,
  instanceIndex,
  max,
  mix,
  mx_fractal_noise_float,
  mx_worley_noise_float,
  pow,
  sin,
  smoothstep,
  uniform,
  vec3,
  vec4,
} from 'three/tsl';
import type * as THREE from 'three/webgpu';
import type { BodyData } from '../astro/bodies';
import { handoff } from '../core/Handoff';
import { bakeSphere } from '../particles/bake';
import { Disturbance } from '../particles/Disturbance';
import {
  ball,
  ballDepth,
  ballSprite,
  frontFacing,
  hardDisc,
  particleScale,
  softDisc,
  viewDirection,
  worldNormal,
} from '../particles/nodes';
import { ParticleField } from '../particles/ParticleField';
import { BaseBody } from './BaseBody';
import { DetailTier, type TierKind } from './DetailTier';

export const sunLook = {
  brightness: uniform(1.9),
  corona: uniform(0.03),
  prominences: uniform(0.8),
};

const SURFACE_COUNT = 320_000;
const CORONA_COUNT = 70_000;
/** Protuberancias: arcos y partículas por arco. */
const LOOPS = 14;
const LOOP_COUNT = 3_000;

export class Sun extends BaseBody {
  /** El Sol siempre se ve grande: un solo nivel, completo. */
  protected readonly hasFullTier = false;
  /** Segundos de animación (reales, reducidos en float64). */
  private readonly animTime = uniform(0);

  constructor(data: BodyData) {
    super(data, null);
    this.start();
  }

  protected async buildTier(kind: TierKind): Promise<DetailTier> {
    const tier = new DetailTier(kind);
    const [surface, corona] = await Promise.all([
      bakeSphere({ count: SURFACE_COUNT, seed: 1, distribution: { kind: 'progressive' }, textures: {} }),
      bakeSphere({ count: CORONA_COUNT, seed: 2, distribution: { kind: 'progressive' }, textures: {} }),
    ]);
    tier.addField(this.createSurface(tier, surface.directions), true);
    tier.addField(this.createCorona(tier, corona.directions), false);
    tier.addField(this.createProminences(tier), false);
    tier.total = SURFACE_COUNT;
    return tier;
  }

  private createSurface(tier: DetailTier, directions: Float32Array): ParticleField {
    const dirBuffer = tier.buffer(directions);
    // (granulación, actividad, 0, 0) por partícula, escrito por la pasada compute.
    const stateBuffer = tier.buffer(SURFACE_COUNT);
    const t = this.animTime;

    const granulation = Fn(() => {
      const d = dirBuffer.element(instanceIndex).xyz;
      // Celdas de Worley que hierven; regiones activas a gran escala.
      const granules = mx_worley_noise_float(d.mul(48).add(vec3(t.mul(0.04), t.mul(0.03), 0)));
      const active = mx_fractal_noise_float(d.mul(2.2).add(vec3(0, t.mul(0.01), 0)), 4);
      stateBuffer.element(instanceIndex).assign(vec4(granules, active, 0, 0));
    })().compute(SURFACE_COUNT);
    tier.track([], [granulation]);

    const dirAttr = dirBuffer.toAttribute();
    const state = stateBuffer.toAttribute();
    const dir = dirAttr.xyz;
    const granules = state.x;
    const active = state.y;

    // Posición de reposo: misma expresión en el material y en la perturbación del cursor.
    const restOf = (d: THREE.Node<'vec4'>, st: THREE.Node<'vec4'>) =>
      d.xyz.mul(float(1).add(st.x.sub(0.5).mul(-0.004).add(st.y.mul(0.005))));
    const disturbance = new Disturbance(SURFACE_COUNT, (i) => restOf(dirBuffer.element(i), stateBuffer.element(i)));
    tier.track(disturbance.resources.buffers, disturbance.resources.computes);
    const center = this.condense(restOf(dirAttr, state), dirAttr.w, tier.appear).add(disturbance.offsetNode());

    const field = new ParticleField(SURFACE_COUNT, 'solid', 0.75);
    tier.updates.push((ctx) => {
      this.animTime.value = (performance.now() / 1000) % 10_000;
      // Sin estado: solo las partículas que se dibujan (de lejos, 2.000 de 320.000) y si el Sol
      // se ve. Las demás se calculan el frame en que entran, antes de dibujarse.
      if (this.inView(ctx, 1.05)) ctx.renderer.compute(granulation, field.object.count);
      disturbance.update(ctx.renderer, this.localPointerRay(ctx, field.object), ctx.dt, ctx.nowSeconds, field.object.count);
    });
    const material = field.material;
    const { scale, visibility } = ballSprite({
      center,
      size: field.size,
      minPixels: 1.5,
      objectScale: this.objectScale,
      cull: frontFacing(dir, center, 0.1),
    });
    material.positionNode = center;
    material.scaleNode = scale;
    material.opacityNode = hardDisc();
    // Cada gránulo es una bola incandescente: más brillante en el centro, con profundidad real.
    const b = ball();
    material.depthNode = ballDepth(b, scale.mul(this.objectScale).mul(0.5));

    const heat = float(1.05).sub(granules.mul(1.1)).add(active.mul(0.25)).clamp(0, 1);
    const color = mix(vec3(1.0, 0.3, 0.03), vec3(1.0, 0.72, 0.3), heat).mul(heat.mul(0.6).add(0.55));
    // Oscurecimiento del limbo: el borde del disco es más rojo y oscuro.
    const mu = max(worldNormal(dir).dot(viewDirection(center)), 0);
    const limb = float(0.3).add(pow(mu, 0.6).mul(0.7));
    const bead = mix(float(1), float(0.3).add(pow(b.facing, 1.5).mul(0.75)), visibility);
    material.colorNode = vec4(color.mul(limb).mul(bead).mul(sunLook.brightness).mul(handoff.solar), 1);

    return field;
  }

  private createCorona(tier: DetailTier, directions: Float32Array): ParticleField {
    const dirAttr = tier.buffer(directions).toAttribute();
    const rand = dirAttr.w;
    const t = this.animTime;

    // Flujo hacia fuera sin estado: cada partícula recorre su radio en bucle,
    // con una leve curvatura según su valor aleatorio.
    const f = fract(rand.mul(7.31).add(t.mul(rand.mul(0.02).add(0.01))));
    const radius = float(1.0).add(pow(f, 1.4).mul(1.3));
    const bend = vec3(rand.sub(0.5), rand.mul(13.7).fract().sub(0.5), rand.mul(71.3).fract().sub(0.5)).mul(f.mul(0.25));
    const center = dirAttr.xyz.add(bend).normalize().mul(radius);

    const field = new ParticleField(CORONA_COUNT, 'additive', 1.6);
    const material = field.material;
    material.positionNode = center;
    material.scaleNode = particleScale({
      center,
      size: field.size.mul(radius),
      minPixels: 2,
      objectScale: this.objectScale,
    });
    const intensity = float(1).sub(f).pow(2.5).mul(sunLook.corona).mul(tier.appear);
    material.colorNode = vec4(vec3(1.0, 0.6, 0.28).mul(intensity).mul(handoff.solar), 1);
    material.opacityNode = softDisc();

    return field;
  }

  /**
   * Protuberancias: plasma que sigue arcos magnéticos anclados en dos puntos de la superficie
   * (en latitudes activas) y cae de una pata a la otra, en hilos que se retuercen. Todo es
   * función del tiempo y barato (un nlerp y unos senos): va en el vertex shader, sin estado.
   * Rojas como en H-alfa y en HDR, así que el bloom las hace brillar sobre el limbo.
   */
  private createProminences(tier: DetailTier): ParticleField {
    const count = LOOPS * LOOP_COUNT;
    // mulberry32: el mismo Sol en cada visita.
    let seed = 20261028;
    const random = () => {
      seed = (seed + 0x6d2b79f5) >>> 0;
      let t = Math.imul(seed ^ (seed >>> 15), seed | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    // Por partícula: (pata A, fase), (pata B, altura del arco) y (hilo, grosor, velocidad, brillo).
    const footA = new Float32Array(count * 4), footB = new Float32Array(count * 4), strand = new Float32Array(count * 4);
    for (let k = 0; k < LOOPS; k++) {
      // Centro en latitudes activas (±8–35°), patas separadas 4–14° en una dirección cualquiera.
      const lat = (8 + 27 * random()) * (random() < 0.5 ? -1 : 1) * (Math.PI / 180);
      const lon = random() * Math.PI * 2;
      const c = [Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon)];
      const east = [-Math.sin(lon), 0, -Math.cos(lon)];
      const north = [-Math.sin(lat) * Math.cos(lon), Math.cos(lat), Math.sin(lat) * Math.sin(lon)];
      const along = random() * Math.PI * 2, half = (2 + 5 * random()) * (Math.PI / 180);
      const t = [0, 1, 2].map((i) => east[i] * Math.cos(along) + north[i] * Math.sin(along));
      const a = [0, 1, 2].map((i) => c[i] - t[i] * half), b = [0, 1, 2].map((i) => c[i] + t[i] * half);
      const height = 0.06 + 0.22 * random() ** 1.5;
      const speed = (0.015 + 0.03 * random()) * (random() < 0.5 ? -1 : 1);
      const gain = 0.5 + random();
      for (let j = 0; j < LOOP_COUNT; j++) {
        const i = (k * LOOP_COUNT + j) * 4;
        footA.set([a[0], a[1], a[2], random()], i);
        footB.set([b[0], b[1], b[2], height], i);
        // Hilo: ángulo alrededor del eje del arco y distancia al eje (más densos en el centro).
        strand.set([random() * Math.PI * 2, random() ** 2, speed * (0.8 + 0.4 * random()), gain], i);
      }
    }
    const A = tier.buffer(footA).toAttribute(), B = tier.buffer(footB).toAttribute(), S = tier.buffer(strand).toAttribute();
    const t = this.animTime;

    // Posición a lo largo del arco (0 = pata A, 1 = pata B), que avanza con el tiempo.
    const s = fract(A.w.add(t.mul(S.z)));
    const base = mix(A.xyz, B.xyz, s).normalize();
    const lift = sin(s.mul(Math.PI));
    const axis = base.mul(float(1).add(B.w.mul(lift)));
    // Hilos retorcidos alrededor del eje, más gruesos arriba (el plasma se expande).
    const tangent = B.xyz.sub(A.xyz).normalize();
    const side = cross(base, tangent);
    const twist = S.x.add(s.mul(9));
    const radius = S.y.mul(float(0.01).add(lift.mul(0.03)));
    const center = axis.add(side.mul(cos(twist).mul(radius))).add(base.mul(sin(twist).mul(radius)));

    const field = new ParticleField(count, 'additive');
    const material = field.material;
    material.positionNode = center;
    material.scaleNode = particleScale({ center, size: float(0.007), minPixels: 1.6, objectScale: this.objectScale });
    // Más brillo arriba del arco; las patas se funden con la superficie. Se ven sobre el limbo:
    // delante del disco (ya muy brillante) apenas suman, como los filamentos.
    const fade = smoothstep(0, 0.12, s).mul(smoothstep(1, 0.88, s));
    const limb = mix(float(0.15), float(1), smoothstep(0.9, 0.4, worldNormal(base).dot(viewDirection(center)).abs()));
    const intensity = S.w.mul(fade).mul(lift.mul(0.6).add(0.4)).mul(limb).mul(sunLook.prominences).mul(tier.appear);
    material.colorNode = vec4(vec3(1.0, 0.24, 0.16).mul(intensity).mul(handoff.solar), 1);
    material.opacityNode = softDisc();
    return field;
  }
}
