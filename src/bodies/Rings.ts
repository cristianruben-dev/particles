/**
 * Anillos planetarios con velocidad kepleriana. Ver docs/ARQUITECTURA.md §8.
 *
 * - Radios muestreados del perfil de cada anillo (en km) y pasados a escena con la misma
 *   función que las lunas (`ScaleSystem.distanceNode`): en escala comprimida el borde
 *   interior nunca se mete en el planeta inflado y la transición a escala real es continua.
 * - Cada partícula gira con ω = √(GM/r³): las de dentro van más rápido. El ángulo se integra
 *   en una pasada compute (cada partícula tiene su ω: no hay un tiempo común que reducir).
 * - Sombra del planeta sobre los anillos y de los anillos sobre el planeta (`ringShadow`).
 */
import type * as THREE from 'three/webgpu';
import {
  Fn,
  cameraPosition,
  cos,
  float,
  floor,
  instanceIndex,
  length,
  max,
  mix,
  modelWorldMatrix,
  pow,
  sin,
  smoothstep,
  sqrt,
  step,
  uniform,
  vec3,
  vec4,
} from 'three/tsl';
import type { BodyData } from '../astro/bodies';
import { ball, ballDepth, ballSprite, hardDisc, worldPosition, type FloatNode, type Vec3Node } from '../particles/nodes';
import { ParticleField } from '../particles/ParticleField';
import type { ScaleSystem } from '../scale/ScaleSystem';
import { linearColor } from './Atmosphere';
import type { FrameContext } from './CelestialBody';
import type { DetailTier } from './DetailTier';
import type { RingsPreset } from './presets';

/** Parámetro gravitatorio GM (km³/s²). */
const GM: Record<string, number> = { saturn: 37_931_187, uranus: 5_793_939 };

/** Giro máximo de las partículas más rápidas por frame: más rápido se ve como ruido. */
const MAX_STEP_RAD = 0.015;

export const ringLook = {
  brightness: uniform(1),
};

const floatUniform = () => uniform(1);
type FloatUniform = ReturnType<typeof floatUniform>;

/** Anillo en coordenadas locales del planeta (radios), actualizado cada frame. */
interface LocalBand {
  inner: FloatUniform;
  outer: FloatUniform;
  density: number;
}

export class Rings {
  readonly field: ParticleField;
  /** Bordes de cada anillo en radios locales (para la sombra sobre el planeta). */
  readonly bands: LocalBand[];
  private readonly dt = uniform(0);
  private readonly step: THREE.ComputeNode;
  private readonly innerOmega: number;

  constructor(
    tier: DetailTier,
    private readonly data: BodyData,
    private readonly preset: RingsPreset,
    count: number,
    scale: ScaleSystem,
    sunDirection: Vec3Node,
    objectScale: FloatNode,
    /** +1 si los anillos giran como el planeta en sentido directo, −1 si retrógrado. */
    direction: number,
  ) {
    const gm = GM[data.id] ?? 1e7;
    this.innerOmega = Math.sqrt(gm / Math.pow(preset.bands[0].inner, 3));
    this.bands = preset.bands.map((b) => ({ inner: floatUniform(), outer: floatUniform(), density: b.density }));

    // (ángulo, radio km, altura local, brillo). Orden aleatorio: cualquier prefijo es uniforme.
    const buffer = tier.buffer(sampleRings(preset, count));
    const omegaOf = (rKm: FloatNode) => sqrt(float(gm).div(rKm.mul(rKm).mul(rKm)));

    this.step = Fn(() => {
      const d = buffer.element(instanceIndex);
      const a = d.x.add(omegaOf(d.y).mul(this.dt).mul(direction));
      const twoPi = Math.PI * 2;
      d.x.assign(a.sub(floor(a.div(twoPi)).mul(twoPi)));
    })().compute(count);
    tier.track([], [this.step]);
    tier.updates.push((ctx) => this.update(ctx));

    const attr = buffer.toAttribute();
    const angle = attr.x;
    const radius = scale.distanceNode(data, attr.y).div(objectScale);
    // Giro positivo alrededor de +y lleva x hacia −z (como el giro propio del planeta).
    const center = vec3(cos(angle).mul(radius), attr.z, sin(angle).negate().mul(radius));

    this.field = new ParticleField(count, 'solid', preset.overlap);
    const material = this.field.material;
    const { scale: spriteScale, visibility } = ballSprite({
      center,
      size: this.field.size,
      minPixels: 1,
      objectScale,
    });
    material.positionNode = center;
    material.scaleNode = spriteScale;
    material.opacityNode = hardDisc();
    const b = ball();
    material.depthNode = ballDepth(b, spriteScale.mul(objectScale).mul(0.5));

    // Luz: cara iluminada o en contraluz, y lo inclinado que llega el Sol al plano.
    const world = worldPosition(center);
    const planetCenter = modelWorldMatrix.mul(vec4(0, 0, 0, 1)).xyz;
    const normal = modelWorldMatrix.mul(vec4(0, 1, 0, 0)).xyz.normalize();
    const sunSide = sunDirection.dot(normal);
    const cameraSide = cameraPosition.sub(world).dot(normal);
    const sameSide = step(0, sunSide.mul(cameraSide));
    const incidence = float(0.35).add(pow(sunSide.abs(), 0.4).mul(0.65));
    const lit = mix(float(0.3), float(1), sameSide).mul(incidence);

    // Sombra del planeta (esfera de radio 1 en local): detrás de él respecto al Sol.
    const rel = world.sub(planetCenter);
    const along = rel.dot(sunDirection);
    const perp = length(rel.sub(sunDirection.mul(along))).div(objectScale);
    const inShadow = step(along, 0).mul(smoothstep(1.02, 0.97, perp));
    const shadow = float(1).sub(inShadow.mul(0.93));

    const ballLit = mix(float(1), max(b.normal.dot(sunDirection), 0).mul(0.7).add(0.45), visibility);
    const rgb = linearColor(preset.color).mul(attr.w).mul(lit).mul(shadow).mul(ballLit).mul(ringLook.brightness).mul(tier.appear);
    material.colorNode = vec4(rgb, 1);
  }

  /** Superficie de los anillos respecto a la de la esfera unidad (4π), para el LOD. */
  areaRatio(): number {
    const r = this.data.radiusKm;
    const area = this.preset.bands.reduce((a, b) => a + ((b.outer / r) ** 2 - (b.inner / r) ** 2), 0);
    return Math.max(0.01, area / 4);
  }

  private update(ctx: FrameContext): void {
    const simSeconds = ctx.dt * ctx.timeRate;
    // Con el tiempo muy acelerado, el giro se limita: si no, los anillos se vuelven ruido.
    this.dt.value = Math.min(simSeconds, MAX_STEP_RAD / this.innerOmega);
    ctx.renderer.compute(this.step);

    const r = this.sceneRadius(ctx);
    this.preset.bands.forEach((band, i) => {
      this.bands[i].inner.value = ctx.scale.localDistance(this.data, band.inner) / r;
      this.bands[i].outer.value = ctx.scale.localDistance(this.data, band.outer) / r;
    });
  }

  private sceneRadius(ctx: FrameContext): number {
    return ctx.scale.radius(this.data.radiusKm);
  }
}

/**
 * Transmisión de luz (0–1) en un punto del planeta por la sombra de los anillos:
 * rayo hacia el Sol contra el plano del ecuador. `local` = punto en el espacio del
 * planeta (radios; el plano de los anillos es y = 0).
 */
export function ringShadow(local: Vec3Node, sunLocal: Vec3Node, bands: readonly LocalBand[]): FloatNode {
  const t = local.y.negate().div(sunLocal.y);
  const hit = local.add(sunLocal.mul(t));
  const r = length(vec3(hit.x, 0, hit.z));
  let opacity: FloatNode = float(0);
  for (const b of bands) opacity = opacity.add(step(b.inner, r).mul(step(r, b.outer)).mul(b.density));
  // Solo si el Sol está al otro lado del plano respecto al punto (t > 0).
  return float(1).sub(opacity.clamp(0, 1).mul(0.75).mul(step(0, t)));
}

/** Partículas de los anillos: radio según la densidad de cada anillo, ángulo al azar. */
function sampleRings(preset: RingsPreset, count: number): Float32Array {
  // Peso de cada anillo = densidad × área.
  const weights = preset.bands.map((b) => b.density * (b.outer * b.outer - b.inner * b.inner));
  const total = weights.reduce((a, b) => a + b, 0);
  const out = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    let pick = Math.random() * total, k = 0;
    while (k < weights.length - 1 && pick > weights[k]) pick -= weights[k++];
    const b = preset.bands[k];
    // Uniforme en área dentro del anillo.
    const r = Math.sqrt(b.inner * b.inner + Math.random() * (b.outer * b.outer - b.inner * b.inner));
    out[i * 4] = Math.random() * Math.PI * 2;
    out[i * 4 + 1] = r;
    out[i * 4 + 2] = (Math.random() - 0.5) * 0.004;
    out[i * 4 + 3] = b.brightness * (0.75 + Math.random() * 0.5);
  }
  return out;
}
