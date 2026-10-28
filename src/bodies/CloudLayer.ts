/**
 * Capa de nubes: partículas repartidas según la textura de nubes. Ver docs/ARQUITECTURA.md §8.
 */
import * as THREE from 'three/webgpu';
import { float, max, mix, smoothstep, uniform, vec3, vec4 } from 'three/tsl';
import { daysSinceJ2000 } from '../astro/units';
import { bakeSphere } from '../particles/bake';
import { Disturbance } from '../particles/Disturbance';
import { ball, ballSprite, frontFacing, worldNormal, type FloatNode, type Vec3Node } from '../particles/nodes';
import { ParticleField } from '../particles/ParticleField';
import type { FrameContext } from './CelestialBody';
import type { DetailTier } from './DetailTier';
import type { RockyPreset } from './presets';

type CloudPreset = NonNullable<RockyPreset['clouds']>;

export const cloudLook = {
  opacity: uniform(0.85),
};

/** Deriva de la capa respecto a la superficie (vueltas por día). */
const DRIFT_TURNS_PER_DAY = 0.03;

export class CloudLayer {
  /** Cuelga del grupo que gira con el planeta; añade su propia deriva. */
  readonly group = new THREE.Group();

  private constructor(
    readonly field: ParticleField,
    /** Solo en el detalle completo. */
    readonly disturbance: Disturbance | null,
  ) {
    this.group.add(field.object);
  }

  static async create(
    tier: DetailTier,
    preset: CloudPreset,
    count: number,
    sunDirection: Vec3Node,
    objectScale: FloatNode,
    /** 1 = normal, 0 = invisible (la cámara ha bajado por debajo de la capa). */
    fade: FloatNode = float(1),
    /** Luz del Sol con los eclipses (§5.3), por dirección en mundo. */
    light?: (point: Vec3Node) => Vec3Node,
  ): Promise<CloudLayer> {
    const baked = await bakeSphere({
      count,
      seed: 7,
      distribution: { kind: 'density', texture: 'clouds', gamma: 1.2, threshold: 0.18 },
      textures: { clouds: { url: preset.texture, channels: 1, srgb: false } },
    });

    const density = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) density[i * 4] = baked.samples.clouds[i];

    const dirBuffer = tier.buffer(baked.directions);
    const dirAttr = dirBuffer.toAttribute();
    const densityAttr = tier.buffer(density).toAttribute();
    const dir = dirAttr.xyz;

    // Algo de grosor vertical. TODO: turbulencia con curl noise en compute.
    const restOf = (d: THREE.Node<'vec4'>) => d.xyz.mul(float(1 + preset.altitude).add(d.w.mul(0.006)));
    let disturbance: Disturbance | null = null;
    if (tier.kind === 'full') {
      disturbance = new Disturbance(count, (i) => restOf(dirBuffer.element(i)));
      tier.track(disturbance.resources.buffers, disturbance.resources.computes);
    }
    const layer = new CloudLayer(new ParticleField(count, 'translucent', 0.6), disturbance);
    const material = layer.field.material;

    // Al aparecer, las nubes bajan desde más arriba.
    const appear = tier.appear;
    let center = restOf(dirAttr).mul(float(1).add(float(1).sub(appear).mul(0.25)));
    if (disturbance) center = center.add(disturbance.offsetNode());

    const { scale, visibility } = ballSprite({
      center,
      size: layer.field.size,
      minPixels: 1.5,
      objectScale,
      cull: frontFacing(dir, center, 0.15),
    });
    material.positionNode = center;
    material.scaleNode = scale;

    // Cada partícula es una bola de algodón: luz propia del Sol y borde suave pero corto.
    const b = ball();
    const ndl = worldNormal(dir).dot(sunDirection);
    const daylight = smoothstep(-0.1, 0.15, ndl);
    const ballLit = max(b.normal.dot(sunDirection), 0);
    const flatLit = ndl.add(0.15).div(1.15).clamp(0, 1);
    const shaped = mix(flatLit, ballLit, visibility);
    // Parte difusa por dispersión (las nubes nunca son negras del todo de día).
    const lit = shaped.mul(0.75).add(0.25).mul(daylight).add(0.01);
    const rgb = vec3(0.97, 0.98, 1.0).mul(lit);
    material.colorNode = vec4(light ? rgb.mul(light(worldNormal(dir))) : rgb, 1);
    const puff = smoothstep(1, 0.55, b.r2);
    material.opacityNode = puff.mul(smoothstep(0.15, 0.95, densityAttr.x)).mul(cloudLook.opacity).mul(appear).mul(fade);

    return layer;
  }

  update(ctx: FrameContext): void {
    const days = daysSinceJ2000(ctx.timeMs);
    this.group.rotation.y = ((days * DRIFT_TURNS_PER_DAY) % 1) * Math.PI * 2;
  }
}
