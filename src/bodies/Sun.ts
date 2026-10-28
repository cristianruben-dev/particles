/**
 * El Sol: granulación animada, oscurecimiento del limbo y corona. Ver docs/ARQUITECTURA.md §8.
 * Todo es emisivo y en HDR: es la fuente principal del bloom.
 *
 * El ruido de la granulación (Worley + fractal) es caro: se calcula una vez por partícula
 * y frame en una pasada compute, no por vértice ni por píxel.
 */
import {
  Fn,
  float,
  fract,
  instanceIndex,
  max,
  mix,
  mx_fractal_noise_float,
  mx_worley_noise_float,
  pow,
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
};

const SURFACE_COUNT = 320_000;
const CORONA_COUNT = 70_000;

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
      ctx.renderer.compute(granulation);
      disturbance.update(ctx.renderer, this.localPointerRay(ctx, field.object), ctx.dt, ctx.nowSeconds);
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

  // TODO(fase 4): protuberancias como partículas que siguen arcos magnéticos.
}
