/**
 * Planetas rocosos y lunas: albedo + relieve real + iluminación por partícula.
 * Ver docs/ARQUITECTURA.md §6.2 y §8.
 */
import * as THREE from 'three/webgpu';
import { float, max, mix, pow, smoothstep, uniform, vec3, vec4 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import type { BodyData } from '../astro/bodies';
import { config } from '../config';
import { bakeSphere, type BakeTexture } from '../particles/bake';
import { Disturbance } from '../particles/Disturbance';
import { ball, ballDepth, ballSprite, frontFacing, hardDisc, viewDirection, worldNormal } from '../particles/nodes';
import { ParticleField } from '../particles/ParticleField';
import { Atmosphere } from './Atmosphere';
import { BaseBody } from './BaseBody';
import type { CelestialBody } from './CelestialBody';
import { CloudLayer } from './CloudLayer';
import { DetailTier, type TierKind } from './DetailTier';
import type { RockyPreset } from './presets';

/** Parámetros artísticos compartidos (ajustables desde el panel de debug). */
export const rockyLook = {
  ambient: uniform(0.012),
  nightLights: uniform(2.6),
  specular: uniform(0.6),
  /** 0 = discos planos con la luz del planeta, 1 = cada partícula es una bola iluminada. */
  ballShading: uniform(0.9),
  /** Ganancia de brillo de cada punto: con aire entre partículas el planeta cubre menos y se oscurece. */
  dotGain: uniform(1.7),
};

/** Partículas de la vista previa de una capa con `count` partículas en el detalle completo. */
export function previewCount(count: number, mainCount: number): number {
  const main = Math.min(config.lod.previewCount, Math.ceil(mainCount / 4));
  return Math.max(2000, Math.ceil((count * main) / mainCount));
}

export class RockyPlanet extends BaseBody {
  /** Exageración del relieve (ajustable en vivo). */
  readonly relief = uniform(0);

  constructor(data: BodyData, parent: CelestialBody | null, private readonly preset: RockyPreset) {
    super(data, parent);
    this.relief.value = preset.reliefScale;
    this.start();
  }

  protected async buildTier(kind: TierKind): Promise<DetailTier> {
    const p = this.preset;
    const tier = new DetailTier(kind);
    const count = kind === 'full' ? p.count : previewCount(p.count, p.count);
    const layerCount = (n: number) => (kind === 'full' ? n : previewCount(n, p.count));

    const textures: Record<string, BakeTexture> = {};
    const leftLon = p.mapLeftLon;
    if (p.textures.albedo) textures.albedo = { url: p.textures.albedo, channels: 3, srgb: true, leftLon };
    if (p.textures.height) textures.height = { url: p.textures.height, channels: 1, srgb: false, leftLon };
    if (p.textures.night) textures.night = { url: p.textures.night, channels: 1, srgb: true };

    const baked = await bakeSphere({
      count,
      seed: hashString(this.data.id),
      distribution: { kind: 'progressive' },
      textures,
      noise: p.noise,
    });

    // Empaquetado en vec4: color = (albedo.rgb, agua), surf = (altura, luces, 0, 0).
    const { albedo, height, night, noise } = baked.samples;
    const tint = new THREE.Color(p.tint ?? 0xffffff).multiplyScalar(p.gain ?? 1);
    const noiseColors = p.noise?.colors.map((c) => new THREE.Color(c));
    // Zonas sin datos de los mosaicos (negro puro): color medio del cuerpo.
    const fill = new THREE.Color(this.data.color).multiplyScalar(0.8);
    const color = new Float32Array(count * 4);
    const surf = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      let r = tint.r, g = tint.g, b = tint.b;
      if (albedo && albedo[i * 3] + albedo[i * 3 + 1] + albedo[i * 3 + 2] < 0.0015) {
        r = fill.r; g = fill.g; b = fill.b;
      } else if (albedo) {
        r *= albedo[i * 3]; g *= albedo[i * 3 + 1]; b *= albedo[i * 3 + 2];
      } else if (noiseColors && noise) {
        // Contraste: el fBm se concentra cerca de 0,5.
        const t = Math.min(1, Math.max(0, (noise[i] - 0.5) * 2.2 + 0.5));
        const [c0, c1] = noiseColors;
        r *= c0.r + (c1.r - c0.r) * t; g *= c0.g + (c1.g - c0.g) * t; b *= c0.b + (c1.b - c0.b) * t;
      }
      const h = height ? height[i] : p.heightReference;
      color[i * 4] = r;
      color[i * 4 + 1] = g;
      color[i * 4 + 2] = b;
      color[i * 4 + 3] = p.waterBelow !== undefined && h < p.waterBelow ? 1 : 0;
      surf[i * 4] = h;
      surf[i * 4 + 1] = night ? night[i] : 0;
    }

    const surface = this.createSurface(tier, baked.directions, color, surf);
    tier.addField(surface, true);
    tier.total = count;

    if (p.atmosphere) {
      const atmosphere = new Atmosphere(tier, p.atmosphere, layerCount(p.atmosphere.count), this.sunDirection, this.objectScale);
      tier.addField(atmosphere.field, false);
    }

    if (p.clouds) {
      const clouds = await CloudLayer.create(tier, p.clouds, layerCount(p.clouds.count), this.sunDirection, this.objectScale);
      tier.roots.push({ object: clouds.group, spin: true });
      tier.fields.push({ field: clouds.field, scale: 1 });
      tier.updates.push((ctx) => {
        clouds.update(ctx);
        clouds.disturbance?.update(ctx.renderer, this.localPointerRay(ctx, clouds.field.object), ctx.dt, ctx.nowSeconds);
      });
    }
    return tier;
  }

  private createSurface(tier: DetailTier, directions: Float32Array, color: Float32Array, surf: Float32Array): ParticleField {
    const p = this.preset;
    const count = directions.length / 4;
    const dirBuffer = tier.buffer(directions);
    const surfBuffer = tier.buffer(surf);
    const dirAttr = dirBuffer.toAttribute();
    const colorAttr = tier.buffer(color).toAttribute();
    const surfAttr = surfBuffer.toAttribute();

    // Posición de reposo: la misma expresión en el material (atributos) y en la pasada
    // compute de la perturbación (elementos del buffer).
    const restOf = (d: Node<'vec4'>, sf: Node<'vec4'>) =>
      d.xyz.mul(float(1).add(sf.x.sub(p.heightReference).mul(this.relief)));

    const dir = dirAttr.xyz;
    let center = this.condense(restOf(dirAttr, surfAttr), dirAttr.w, tier.appear);

    // Perturbación con el ratón: solo en el detalle completo (32 B más por partícula).
    const field = new ParticleField(count, 'solid', 0.72);
    if (tier.kind === 'full') {
      const disturbance = new Disturbance(count, (i) => restOf(dirBuffer.element(i), surfBuffer.element(i)));
      tier.track(disturbance.resources.buffers, disturbance.resources.computes);
      center = center.add(disturbance.offsetNode());
      tier.updates.push((ctx) =>
        disturbance.update(ctx.renderer, this.localPointerRay(ctx, field.object), ctx.dt, ctx.nowSeconds),
      );
    }

    // Puntos más pequeños que la separación: aire entre partículas.
    const material = field.material;
    const { scale, visibility } = ballSprite({
      center,
      size: field.size,
      minPixels: 1.2,
      objectScale: this.objectScale,
      cull: frontFacing(dir, center, 0.25),
    });
    material.positionNode = center;
    material.scaleNode = scale;
    material.opacityNode = hardDisc();

    // Cada partícula es una micro-esfera: normal por píxel y profundidad real.
    const b = ball();
    material.depthNode = ballDepth(b, scale.mul(this.objectScale).mul(0.5));

    // Luz: sombra a escala de planeta (día/noche) × Lambert de cada bola.
    const n = worldNormal(dir);
    const ndl = n.dot(this.sunDirection);
    const planetLit = ndl.add(0.08).div(1.08).clamp(0, 1);
    const daylight = smoothstep(-0.06, 0.12, ndl);
    const ballLit = max(b.normal.dot(this.sunDirection), 0).mul(daylight);
    const ballAmount = visibility.mul(rockyLook.ballShading);
    const lit = mix(planetLit, ballLit, ballAmount);
    // Oclusión en el borde de cada bola: separa las partículas y da volumen.
    const occlusion = mix(float(1), float(0.5).add(b.facing.mul(0.5)), ballAmount);
    const bead = mix(float(1), b.facing, ballAmount);
    const albedo = colorAttr.xyz;
    let rgb = albedo.mul(lit.add(rockyLook.ambient)).mul(occlusion).mul(rockyLook.dotGain);

    if (p.textures.night) {
      // Luces de ciudades solo en el lado nocturno, cálidas y en HDR para que hagan bloom.
      const nightSide = float(1).sub(smoothstep(-0.12, 0.06, ndl));
      const lights = smoothstep(0.03, 0.5, surfAttr.y).mul(nightSide).mul(rockyLook.nightLights);
      rgb = rgb.add(vec3(1.0, 0.68, 0.38).mul(lights).mul(bead));
    }

    if (p.waterBelow !== undefined) {
      // Reflejo del Sol en el agua (Blinn-Phong con la normal del planeta: un brillo continuo).
      const v = viewDirection(center);
      const h = this.sunDirection.add(v).normalize();
      const spec = pow(max(n.dot(h), 0), 160).mul(colorAttr.w).mul(planetLit).mul(rockyLook.specular);
      rgb = rgb.add(vec3(1.0, 0.95, 0.85).mul(spec).mul(bead));
    }

    material.colorNode = vec4(rgb, 1);
    return field;
  }
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
