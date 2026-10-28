/**
 * Capa de nubes: partículas repartidas según la textura de nubes. Ver docs/ARQUITECTURA.md §8.
 *
 * En el detalle completo, una turbulencia con *curl noise* (sin divergencia: remueve sin
 * amontonar) desplaza cada partícula sobre la capa y cambia despacio: de cerca las nubes se
 * deshilachan y se mueven en vez de verse como una rejilla de bolitas. El ruido es caro: va en
 * una pasada compute, una vez por partícula y frame, no por vértice.
 */
import * as THREE from 'three/webgpu';
import { Fn, exp, float, instanceIndex, max, mix, modelViewMatrix, mx_noise_vec3, smoothstep, uniform, varying, vec3, vec4 } from 'three/tsl';
import { daysSinceJ2000 } from '../astro/units';
import { bakeSphere } from '../particles/bake';
import { Disturbance } from '../particles/Disturbance';
import { ball, ballSprite, frontFacing, pixelAngle, worldNormal, type FloatNode, type Vec3Node } from '../particles/nodes';
import { ParticleField } from '../particles/ParticleField';
import type { FrameContext } from './CelestialBody';
import type { DetailTier } from './DetailTier';
import type { RockyPreset } from './presets';

type CloudPreset = NonNullable<RockyPreset['clouds']>;

export const cloudLook = {
  opacity: uniform(0.85),
  /** Desplazamiento máximo de la turbulencia (radios del planeta). */
  turbulence: uniform(0.006),
};

/**
 * Diámetro en pantalla (px) entre el que las bolas de algodón pasan a vellones suaves y más
 * grandes: de cerca, cada partícula de nube medía decenas de píxeles y se veían como bolitas.
 */
const SOFT_PX: [number, number] = [7, 35];

/** Frecuencia del campo de turbulencia (sobre la esfera unidad) y su velocidad (1/s reales). */
const TURBULENCE_SCALE = 11;
const TURBULENCE_SPEED = 0.012;

/** Deriva de la capa respecto a la superficie (vueltas por día). */
const DRIFT_TURNS_PER_DAY = 0.03;

export class CloudLayer {
  /** Cuelga del grupo que gira con el planeta; añade su propia deriva. */
  readonly group = new THREE.Group();

  private constructor(
    readonly field: ParticleField,
    /** Solo en el detalle completo. */
    readonly disturbance: Disturbance | null,
    /** Pasada de la turbulencia y su tiempo (solo en el detalle completo). */
    private readonly turbulence: { step: THREE.ComputeNode; time: { value: number } } | null,
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

    // Algo de grosor vertical.
    const shell = (d: THREE.Node<'vec4'>) => d.xyz.mul(float(1 + preset.altitude).add(d.w.mul(0.006)));
    let restOf = (d: THREE.Node<'vec4'>, _i: typeof instanceIndex | null) => shell(d);
    let disturbance: Disturbance | null = null;
    let turbulence: { step: THREE.ComputeNode; time: { value: number } } | null = null;
    if (tier.kind === 'full') {
      const offsets = tier.buffer(count);
      turbulence = CloudLayer.turbulence(dirBuffer, offsets, count);
      tier.track([], [turbulence.step]);
      const offsetAttr = offsets.toAttribute();
      restOf = (d, i) => shell(d).add(i === null ? offsetAttr.xyz : offsets.element(i).xyz);
      disturbance = new Disturbance(count, (i) => restOf(dirBuffer.element(i), i));
      tier.track(disturbance.resources.buffers, disturbance.resources.computes);
    }
    const layer = new CloudLayer(new ParticleField(count, 'translucent', 0.6), disturbance, turbulence);
    const material = layer.field.material;

    // Al aparecer, las nubes bajan desde más arriba.
    const appear = tier.appear;
    let center = restOf(dirAttr, null).mul(float(1).add(float(1).sub(appear).mul(0.25)));
    if (disturbance) center = center.add(disturbance.offsetNode());

    // De cerca (sprites grandes), vellones: más grandes, suaves y tenues, que se funden entre sí.
    const depth = modelViewMatrix.mul(vec4(center, 1)).z.negate();
    const basePx = layer.field.size.mul(objectScale).div(depth.mul(pixelAngle));
    const soft = varying(smoothstep(SOFT_PX[0], SOFT_PX[1], basePx));
    const { scale, visibility } = ballSprite({
      center,
      size: layer.field.size.mul(soft.mul(0.9).add(1)),
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
    const shaped = mix(flatLit, ballLit, visibility.mul(float(1).sub(soft)));
    // Parte difusa por dispersión (las nubes nunca son negras del todo de día).
    const lit = shaped.mul(0.75).add(0.25).mul(daylight).add(0.01);
    const rgb = vec3(0.97, 0.98, 1.0).mul(lit);
    material.colorNode = vec4(light ? rgb.mul(light(worldNormal(dir))) : rgb, 1);
    const puff = mix(smoothstep(1, 0.55, b.r2), exp(b.r2.mul(-3.2)).mul(float(1).sub(b.r2)).mul(0.55), soft);
    material.opacityNode = puff.mul(smoothstep(0.15, 0.95, densityAttr.x)).mul(cloudLook.opacity).mul(appear).mul(fade);

    return layer;
  }

  /**
   * Turbulencia: rotacional de un campo de ruido 3D que cambia con el tiempo (diferencias
   * centradas: seis lecturas), proyectado sobre la capa. Sin divergencia, así que remueve
   * las nubes sin amontonarlas ni abrir huecos.
   */
  private static turbulence(dirs: ReturnType<DetailTier['buffer']>, offsets: ReturnType<DetailTier['buffer']>, count: number) {
    const time = uniform(0);
    const step = Fn(() => {
      const d = dirs.element(instanceIndex).xyz;
      const drift = vec3(time.mul(0.31), time.mul(0.17), time.mul(-0.23));
      const p = d.mul(TURBULENCE_SCALE).add(drift);
      const e = 0.08;
      const F = (dx: number, dy: number, dz: number) => mx_noise_vec3(p.add(vec3(dx, dy, dz)));
      const fx0 = F(-e, 0, 0), fx1 = F(e, 0, 0);
      const fy0 = F(0, -e, 0), fy1 = F(0, e, 0);
      const fz0 = F(0, 0, -e), fz1 = F(0, 0, e);
      const curl = vec3(
        fy1.z.sub(fy0.z).sub(fz1.y.sub(fz0.y)),
        fz1.x.sub(fz0.x).sub(fx1.z.sub(fx0.z)),
        fx1.y.sub(fx0.y).sub(fy1.x.sub(fy0.x)),
      ).div(2 * e);
      // Sobre la capa (sin componente radial) y con la amplitud de la turbulencia.
      const tangent = curl.sub(d.mul(curl.dot(d)));
      offsets.element(instanceIndex).assign(vec4(tangent.mul(cloudLook.turbulence), 0));
    })().compute(count);
    return { step, time };
  }

  update(ctx: FrameContext, visible = true): void {
    const days = daysSinceJ2000(ctx.timeMs);
    this.group.rotation.y = ((days * DRIFT_TURNS_PER_DAY) % 1) * Math.PI * 2;
    if (this.turbulence && visible) {
      this.turbulence.time.value = (ctx.nowSeconds * TURBULENCE_SPEED) % 1000;
      ctx.renderer.compute(this.turbulence.step);
    }
  }
}
