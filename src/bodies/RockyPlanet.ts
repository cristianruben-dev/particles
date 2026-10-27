/**
 * Planetas rocosos y lunas: albedo + relieve real + iluminación por partícula.
 * Ver docs/ARQUITECTURA.md §6.2 y §8.
 */
import { float, max, mix, pow, smoothstep, uniform, vec3, vec4 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import type { BodyData } from '../astro/bodies';
import { bakeSphere, type BakeTexture } from '../particles/bake';
import { Disturbance } from '../particles/Disturbance';
import { ball, ballDepth, ballSprite, frontFacing, hardDisc, viewDirection, worldNormal } from '../particles/nodes';
import { ParticleField, vec4Buffer } from '../particles/ParticleField';
import { Atmosphere } from './Atmosphere';
import { BaseBody } from './BaseBody';
import type { CelestialBody, FrameContext } from './CelestialBody';
import { CloudLayer } from './CloudLayer';
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

export class RockyPlanet extends BaseBody {
  readonly ready: Promise<void>;
  /** Exageración del relieve (ajustable en vivo). */
  readonly relief = uniform(0);

  private surface: ParticleField | null = null;
  private disturbance: Disturbance | null = null;
  private clouds: CloudLayer | null = null;
  private atmosphere: Atmosphere | null = null;

  constructor(data: BodyData, parent: CelestialBody | null, private readonly preset: RockyPreset) {
    super(data, parent);
    this.relief.value = preset.reliefScale;
    this.ready = this.build();
  }

  private async build(): Promise<void> {
    const p = this.preset;
    const textures: Record<string, BakeTexture> = {
      albedo: { url: p.textures.albedo, channels: 3, srgb: true },
      height: { url: p.textures.height, channels: 1, srgb: false },
    };
    if (p.textures.night) textures.night = { url: p.textures.night, channels: 1, srgb: true };

    const baked = await bakeSphere({
      count: p.count,
      seed: hashString(this.data.id),
      distribution: { kind: 'progressive' },
      textures,
    });

    // Empaquetado en vec4: color = (albedo.rgb, agua), surf = (altura, luces, 0, 0).
    const { albedo, height, night } = baked.samples;
    const color = new Float32Array(p.count * 4);
    const surf = new Float32Array(p.count * 4);
    for (let i = 0; i < p.count; i++) {
      color[i * 4] = albedo[i * 3];
      color[i * 4 + 1] = albedo[i * 3 + 1];
      color[i * 4 + 2] = albedo[i * 3 + 2];
      color[i * 4 + 3] = p.waterBelow !== undefined && height[i] < p.waterBelow ? 1 : 0;
      surf[i * 4] = height[i];
      surf[i * 4 + 1] = night ? night[i] : 0;
    }

    this.surface = this.createSurface(baked.directions, color, surf);
    this.spin.add(this.surface.object);
    this.detailTotal = p.count;
    this.lodFields.push(this.surface);

    if (p.atmosphere) {
      this.atmosphere = new Atmosphere(p.atmosphere, this.sunDirection, this.objectScale, this.appear);
      this.object3d.add(this.atmosphere.field.object);
      this.lodFields.push(this.atmosphere.field);
    }
    this.startAppearing();

    if (p.clouds) {
      this.clouds = await CloudLayer.create(p.clouds, this.sunDirection, this.objectScale, this.appear);
      this.spin.add(this.clouds.group);
      this.lodFields.push(this.clouds.field);
    }
  }

  private createSurface(directions: Float32Array, color: Float32Array, surf: Float32Array): ParticleField {
    const p = this.preset;
    const dirBuffer = vec4Buffer(directions);
    const surfBuffer = vec4Buffer(surf);
    const dirAttr = dirBuffer.toAttribute();
    const colorAttr = vec4Buffer(color).toAttribute();
    const surfAttr = surfBuffer.toAttribute();

    // Posición de reposo: la misma expresión en el material (atributos) y en la pasada
    // compute de la perturbación (elementos del buffer).
    const restOf = (d: Node<'vec4'>, sf: Node<'vec4'>) =>
      d.xyz.mul(float(1).add(sf.x.sub(p.heightReference).mul(this.relief)));
    this.disturbance = new Disturbance(p.count, (i) => restOf(dirBuffer.element(i), surfBuffer.element(i)));

    const dir = dirAttr.xyz;
    const center = this.condense(restOf(dirAttr, surfAttr), dirAttr.w).add(this.disturbance.offsetNode());

    // Puntos más pequeños que la separación: aire entre partículas.
    const field = new ParticleField(p.count, 'solid', 0.72);
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

  update(ctx: FrameContext): void {
    super.update(ctx);
    if (this.surface && this.disturbance) {
      this.disturbance.update(ctx.renderer, this.localPointerRay(ctx, this.surface.object), ctx.dt, ctx.nowSeconds);
    }
    if (this.clouds) {
      this.clouds.update(ctx);
      this.clouds.disturbance.update(ctx.renderer, this.localPointerRay(ctx, this.clouds.field.object), ctx.dt, ctx.nowSeconds);
    }
  }

  dispose(): void {
    this.surface?.dispose();
    this.clouds?.dispose();
    this.atmosphere?.dispose();
  }
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
