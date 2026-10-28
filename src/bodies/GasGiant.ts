/**
 * Gigantes gaseosos: bandas que fluyen según la latitud y vórtices. Ver docs/ARQUITECTURA.md §8.
 *
 * Las partículas llevan su color (de la textura o de un perfil de bandas) y se mueven:
 * una pasada compute integra cada frame dos giros que conservan el área, así que la
 * densidad sigue uniforme por mucho que fluyan:
 * - bandas: cada una gira como un bloque rígido, en sentidos alternos, con bordes
 *   estrechos. Una cizalla continua desharía el reparto uniforme de los puntos (grumos y
 *   huecos); así solo se remueven los bordes, que es donde Júpiter tiene turbulencia,
 * - vórtices: giro rígido alrededor del centro del vórtice (la Gran Mancha Roja gira
 *   entera, sin deshacerse en una raya), con un anillo de cizalla en el borde.
 * El flujo usa tiempo real con velocidades artísticas (como la granulación del Sol): el
 * real es tan lento que no se vería.
 */
import * as THREE from 'three/webgpu';
import {
  Fn,
  acos,
  asin,
  cos,
  exp,
  float,
  instanceIndex,
  max,
  mix,
  modelWorldMatrix,
  modelWorldMatrixInverse,
  sin,
  smoothstep,
  uniform,
  vec3,
  vec4,
} from 'three/tsl';
import type { Node } from 'three/webgpu';
import type { BodyData } from '../astro/bodies';
import { bakeSphere } from '../particles/bake';
import { Disturbance } from '../particles/Disturbance';
import { ball, ballDepth, ballSprite, frontFacing, hardDisc, viewDirection, worldNormal, type Vec3Node } from '../particles/nodes';
import { ParticleField } from '../particles/ParticleField';
import type { ScaleSystem } from '../scale/ScaleSystem';
import { Atmosphere } from './Atmosphere';
import { BaseBody } from './BaseBody';
import type { CelestialBody, FrameContext } from './CelestialBody';
import { DetailTier, type TierKind } from './DetailTier';
import type { GasPreset } from './presets';
import { Rings, ringShadow } from './Rings';
import { hashString, previewCount, rockyLook } from './RockyPlanet';

export const gasLook = {
  /** Multiplicador de la velocidad de las bandas y los vórtices. */
  flow: uniform(1),
  /** Tamaño de punto respecto a la separación (rocosos: 0,72). */
  overlap: 0.9,
  /** Cuánto se nota la bola de cada partícula (rocosos: `rockyLook.ballShading`). */
  ballShading: uniform(0.55),
};

const DEG = Math.PI / 180;

/** Nitidez del borde entre bandas: más = bandas más rígidas y bordes más estrechos. */
const BAND_EDGE = 10;

/** Velocidad angular de la banda (rad/s) a una latitud (rad): bloques alternos, en calma cerca de los polos. */
function bandOmega(lat: number, preset: GasPreset): number {
  const polar = 1 - THREE.MathUtils.smoothstep(Math.abs(lat), 1.05, 1.4);
  return Math.tanh(BAND_EDGE * Math.cos(lat * preset.flow.jets * 2)) * polar * preset.flow.speed;
}

export class GasGiant extends BaseBody {
  private readonly flatten: number;

  constructor(
    data: BodyData,
    parent: CelestialBody | null,
    private readonly preset: GasPreset,
    private readonly scale: ScaleSystem,
  ) {
    super(data, parent);
    this.flatten = 1 - (data.flattening ?? 0);
    this.start();
  }

  protected async buildTier(kind: TierKind): Promise<DetailTier> {
    const p = this.preset;
    const tier = new DetailTier(kind);
    const full = kind === 'full';
    const count = full ? p.count : previewCount(p.count, p.count);

    const baked = await bakeSphere({
      count,
      seed: hashString(this.data.id),
      distribution: { kind: 'progressive' },
      textures: p.texture ? { albedo: { url: p.texture, channels: 3, srgb: true } } : {},
      noise: p.noise,
    });
    const color = this.colors(baked.directions, baked.samples.albedo, baked.samples.noise);

    // Anillos antes que el globo: el globo necesita sus bordes para la sombra.
    let rings: Rings | null = null;
    if (p.rings) {
      const ringCount = full ? p.rings.count : previewCount(p.rings.count, p.count);
      const direction = Math.sign(this.data.pole.wRate) || 1;
      rings = new Rings(tier, this.data, p.rings, ringCount, this.scale, this.sunDirection, this.objectScale, direction);
    }

    const globe = this.createGlobe(tier, baked.directions, color, rings);
    tier.addField(globe, true);
    tier.total = count;

    const atmosphere = new Atmosphere(
      tier, p.atmosphere, full ? p.atmosphere.count : previewCount(p.atmosphere.count, p.count),
      this.sunDirection, this.objectScale, this.flatten,
    );
    tier.addField(atmosphere.field, false);

    if (rings) {
      // Los anillos tienen otra área y otro total: su propia fracción de detalle.
      const ringCount = rings.field.count;
      tier.addField(rings.field, false, (count / ringCount) * (rings.areaRatio() * 2));
    }
    return tier;
  }

  /** Color lineal por partícula: textura real o perfil de bandas con turbulencia. */
  private colors(directions: Float32Array, albedo: Float32Array | undefined, noise: Float32Array): Float32Array {
    const count = directions.length / 4;
    const out = new Float32Array(count * 4);
    // Sin textura (o si no ha cargado): perfil de bandas, o el color medio del cuerpo.
    const bands = this.preset.bands ?? { colors: [this.data.color], jitter: 0, contrast: 0.3 };
    const ramp = bands.colors.map((c) => new THREE.Color(c));
    for (let i = 0; i < count; i++) {
      const n = noise[i] - 0.5;
      let r: number, g: number, b: number;
      if (albedo) {
        // La textura ya trae el detalle; el ruido solo añade un poco de grano.
        const k = 1 + n * 0.12;
        r = albedo[i * 3] * k; g = albedo[i * 3 + 1] * k; b = albedo[i * 3 + 2] * k;
      } else {
        // Latitud → posición en la rampa (de norte a sur), ondulada por el ruido.
        const lat = Math.asin(directions[i * 4 + 1]);
        const t = Math.min(0.9999, Math.max(0, 0.5 - lat / Math.PI + n * bands.jitter)) * (ramp.length - 1);
        const k0 = Math.floor(t), f = t - k0;
        const c0 = ramp[k0], c1 = ramp[Math.min(k0 + 1, ramp.length - 1)];
        const k = 1 + n * bands.contrast;
        r = (c0.r + (c1.r - c0.r) * f) * k;
        g = (c0.g + (c1.g - c0.g) * f) * k;
        b = (c0.b + (c1.b - c0.b) * f) * k;
      }
      const gain = this.preset.gain;
      out[i * 4] = r * gain; out[i * 4 + 1] = g * gain; out[i * 4 + 2] = b * gain;
    }
    return out;
  }

  private createGlobe(tier: DetailTier, directions: Float32Array, color: Float32Array, rings: Rings | null): ParticleField {
    const count = directions.length / 4;
    const full = tier.kind === 'full';
    // Estado: dirección actual (xyz) + aleatorio (w). En la vista previa no se mueve.
    const state = tier.buffer(directions);
    const colorAttr = tier.buffer(color).toAttribute();
    const flat = vec3(1, this.flatten, 1);
    const restOf = (s: Node<'vec4'>) => s.xyz.mul(flat);

    // Puntos algo más grandes que en los rocosos: las bandas se leen como nubes continuas.
    const field = new ParticleField(count, 'solid', gasLook.overlap);
    const stateAttr = state.toAttribute();
    let center = this.condense(restOf(stateAttr), stateAttr.w, tier.appear);

    if (full) {
      this.createFlow(tier, state, count);
      const disturbance = new Disturbance(count, (i) => restOf(state.element(i)));
      tier.track(disturbance.resources.buffers, disturbance.resources.computes);
      center = center.add(disturbance.offsetNode());
      tier.updates.push((ctx) =>
        disturbance.update(ctx.renderer, this.localPointerRay(ctx, field.object), ctx.dt, ctx.nowSeconds),
      );
    }

    const dir = stateAttr.xyz;
    const material = field.material;
    const { scale, visibility } = ballSprite({
      center,
      size: field.size,
      minPixels: 1.2,
      objectScale: this.objectScale,
      cull: frontFacing(dir, center, 0.2),
    });
    material.positionNode = center;
    material.scaleNode = scale;
    material.opacityNode = hardDisc();
    const b = ball();
    material.depthNode = ballDepth(b, scale.mul(this.objectScale).mul(0.5));

    // Luz: como los rocosos, con oscurecimiento del limbo (las nubes altas absorben en el borde).
    const n = worldNormal(dir);
    const ndl = n.dot(this.sunDirection);
    const planetLit = ndl.add(0.05).div(1.05).clamp(0, 1);
    const daylight = smoothstep(-0.05, 0.1, ndl);
    const ballLit = max(b.normal.dot(this.sunDirection), 0).mul(daylight);
    const ballAmount = visibility.mul(gasLook.ballShading);
    const lit = mix(planetLit, ballLit, ballAmount);
    const mu = max(n.dot(viewDirection(center)), 0);
    const limb = float(0.55).add(mu.pow(0.5).mul(0.45));
    const occlusion = mix(float(1), float(0.5).add(b.facing.mul(0.5)), ballAmount);
    let rgb = colorAttr.xyz.mul(lit.add(rockyLook.ambient)).mul(limb).mul(occlusion).mul(rockyLook.dotGain);

    if (rings) {
      // Sombra de los anillos: el punto y el Sol en el espacio del planeta (sin el giro propio).
      const sunLocal = this.equatorialSun();
      const local = this.spinToBody(restOf(stateAttr));
      rgb = rgb.mul(ringShadow(local, sunLocal, rings.bands));
    }
    // Tránsitos de sombra (§5.3): las de las lunas, puntos negros que cruzan el disco.
    if (this.shadow) rgb = rgb.mul(this.shadow.lightNode(modelWorldMatrix.mul(vec4(restOf(stateAttr), 0)).xyz.div(this.objectScale)));
    material.colorNode = vec4(rgb, 1);
    return field;
  }

  /** Flujo de bandas y vórtices: una pasada compute por frame sobre el estado. */
  private createFlow(tier: DetailTier, state: ReturnType<DetailTier['buffer']>, count: number): void {
    const p = this.preset;
    const dt = uniform(0);
    const vortices = p.vortices.map((v) => ({
      ...v,
      lonRad: v.lon * DEG,
      center: uniform(new THREE.Vector3()),
    }));

    const step = Fn(() => {
      const s = state.element(instanceIndex);
      const d = s.xyz.toVar();
      // Bandas: giro alrededor de +y (hacia el este) según la latitud.
      const lat = asin(d.y.clamp(-1, 1));
      // tanh(x) = 1 − 2 / (e^{2x} + 1): la misma función que `bandOmega` en la CPU.
      const x = cos(lat.mul(p.flow.jets * 2)).mul(BAND_EDGE * 2).clamp(-30, 30);
      const band = float(1).sub(float(2).div(exp(x).add(1)));
      const polar = smoothstep(1.4, 1.05, lat.abs());
      const omega = band.mul(polar).mul(p.flow.speed);
      const a = omega.mul(dt);
      const ca = cos(a), sa = sin(a);
      d.assign(vec3(d.x.mul(ca).add(d.z.mul(sa)), d.y, d.z.mul(ca).sub(d.x.mul(sa))));
      // Vórtices: giro rígido alrededor de su centro (Rodrigues), que se apaga en el borde.
      for (const v of vortices) {
        const angle = acos(d.dot(v.center).clamp(-1, 1));
        const k = smoothstep(v.radius * 2, v.radius, angle);
        const w = k.mul(v.spin).mul(dt);
        const cw = cos(w), sw = sin(w);
        const axis = v.center as unknown as Vec3Node;
        d.assign(d.mul(cw).add(axis.cross(d).mul(sw)).add(axis.mul(axis.dot(d).mul(float(1).sub(cw)))));
      }
      s.assign(vec4(d.normalize(), s.w));
    })().compute(count);
    tier.track([], [step]);

    tier.updates.push((ctx: FrameContext) => {
      const t = Math.min(ctx.dt, 1 / 20) * gasLook.flow.value;
      dt.value = t;
      // Cada vórtice viaja con la banda de su latitud.
      for (const v of vortices) {
        const lat = v.lat * DEG;
        v.lonRad += bandOmega(lat, p) * t;
        v.center.value.set(Math.cos(lat) * Math.cos(v.lonRad), Math.sin(lat), -Math.cos(lat) * Math.sin(v.lonRad));
      }
      ctx.renderer.compute(step);
    });
  }

  /** Dirección del Sol en el espacio del planeta sin giro (plano de los anillos: y = 0). */
  private equatorialSun(): Vec3Node {
    // modelWorldMatrixInverse del material del globo incluye el giro propio: se deshace con spinToBody.
    return this.spinToBody(modelWorldMatrixInverse.mul(vec4(this.sunDirection, 0)).xyz.normalize());
  }

  /** Del espacio del grupo que gira al del cuerpo (giro alrededor de y). */
  private spinToBody(v: Vec3Node): Vec3Node {
    const a = this.spinAngle;
    const c = cos(a), s = sin(a);
    return vec3(v.x.mul(c).add(v.z.mul(s)), v.y, v.z.mul(c).sub(v.x.mul(s)));
  }

  /** Ángulo de giro propio actual (uniform, para deshacerlo en el shader). */
  private readonly spinAngle = uniform(0);

  update(ctx: FrameContext): void {
    super.update(ctx);
    this.spinAngle.value = this.spin.rotation.y;
  }
}
