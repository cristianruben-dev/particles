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
 *
 * Entre los puntos hay aire, como en todo el sistema; para que de cerca no se vea negro entre
 * ellos (grano), detrás va una bruma: una de cada seis partículas como un disco grande, suave
 * y tenue con el mismo color, que solo asoma por los huecos.
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
  type FloatNode,
  type Vec3Node,
} from '../particles/nodes';
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
  /** Brillo de la bruma de detrás de los puntos respecto a ellos (0 = negro entre puntos). */
  haze: uniform(0.5),
};

/** Bruma: una de cada `HAZE_EVERY` partículas, con discos de `HAZE_OVERLAP` separaciones. */
const HAZE_EVERY = 6;
const HAZE_OVERLAP = 3;

const DEG = Math.PI / 180;

/** Por debajo de este radio en pantalla (px) el flujo no se distingue: se pausa. */
const FLOW_MIN_PX = 30;

/** Nitidez del borde entre bandas: más = bandas más rígidas y bordes más estrechos. */
const BAND_EDGE = 10;

/** Latitudes (rad) entre las que el flujo se apaga hacia el polo. */
function calmRange(preset: GasPreset): [number, number] {
  const end = preset.flow.calm !== undefined ? preset.flow.calm * DEG : 1.4;
  return [Math.min(1.05, end - 0.2), end];
}

/** Velocidad angular de la banda (rad/s) a una latitud (rad): bloques alternos, en calma cerca de los polos. */
function bandOmega(lat: number, preset: GasPreset): number {
  const [calm0, calm1] = calmRange(preset);
  const polar = 1 - THREE.MathUtils.smoothstep(Math.abs(lat), calm0, calm1);
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
      rings = new Rings(tier, this.data, p.rings, ringCount, this.scale, this.sunDirection, this.objectScale, direction, (ctx, radii) => this.inView(ctx, radii));
    }

    const { globe, haze } = this.createGlobe(tier, baked.directions, color, rings);
    tier.addField(globe, true);
    tier.addField(haze, true, 1 / HAZE_EVERY);
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
      [r, g, b] = this.features(directions, i, r, g, b);
      const gain = this.preset.gain;
      out[i * 4] = r * gain; out[i * 4 + 1] = g * gain; out[i * 4 + 2] = b * gain;
    }
    return out;
  }

  /** Manchas de color y hexágono polar (en el marco del cuerpo: giran con él). */
  private features(directions: Float32Array, i: number, r: number, g: number, b: number): [number, number, number] {
    const p = this.preset;
    if (!p.spots && !p.hexagon) return [r, g, b];
    const x = directions[i * 4], y = directions[i * 4 + 1], z = directions[i * 4 + 2];
    const lat = Math.asin(Math.min(1, Math.max(-1, y))), lon = Math.atan2(-z, x);
    const blend = (c: THREE.Color, k: number) => {
      r += (c.r - r) * k; g += (c.g - g) * k; b += (c.b - b) * k;
    };
    for (const s of p.spots ?? []) {
      let dLon = lon - s.lon * DEG;
      dLon -= Math.round(dLon / (2 * Math.PI)) * 2 * Math.PI;
      const e = (dLon * Math.cos(s.lat * DEG) / (s.width * DEG)) ** 2 + ((lat - s.lat * DEG) / (s.height * DEG)) ** 2;
      if (e < 1) blend(new THREE.Color(s.color), 1 - THREE.MathUtils.smoothstep(e, 0.45, 1));
    }
    const h = p.hexagon;
    if (h && lat > (h.lat - 8) * DEG) {
      // Distancia "hexagonal" al polo: la mayor proyección sobre las normales de los seis lados.
      const colat = Math.PI / 2 - lat, a = lon - h.rotation * DEG;
      const px = colat * Math.cos(a), py = colat * Math.sin(a);
      let d = 0;
      for (let k = 0; k < 6; k++) {
        const n = (k * 60 + 30) * DEG;
        d = Math.max(d, px * Math.cos(n) + py * Math.sin(n));
      }
      const apothem = (90 - h.lat) * DEG;
      blend(new THREE.Color(h.inside), 0.85 * (1 - THREE.MathUtils.smoothstep(d, apothem - 0.5 * DEG, apothem + 0.5 * DEG)));
      blend(new THREE.Color(h.jet), 0.75 * (1 - THREE.MathUtils.smoothstep(Math.abs(d - apothem), 0, 1.3 * DEG)));
      blend(new THREE.Color(h.eye), 1 - THREE.MathUtils.smoothstep(colat, 1.2 * DEG, 3 * DEG));
    }
    return [r, g, b];
  }

  private createGlobe(tier: DetailTier, directions: Float32Array, color: Float32Array, rings: Rings | null): { globe: ParticleField; haze: ParticleField } {
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
        disturbance.update(ctx.renderer, this.localPointerRay(ctx, field.object), ctx.dt, ctx.nowSeconds, field.object.count),
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
    const rgb = colorAttr.xyz.mul(lit.add(rockyLook.ambient)).mul(limb).mul(occlusion).mul(rockyLook.dotGain);
    const shade = this.shadows(restOf(stateAttr), rings);
    material.colorNode = vec4(rgb.mul(shade), 1);

    // Bruma de detrás: el mismo color con la luz plana, en discos grandes y suaves un poco por
    // debajo. Sin escribir profundidad: los puntos la tapan y solo asoma entre ellos.
    const haze = new ParticleField(count, 'translucent', HAZE_OVERLAP);
    const hazeCenter = this.condense(restOf(stateAttr).mul(0.996), stateAttr.w, tier.appear);
    const hm = haze.material;
    hm.positionNode = hazeCenter;
    hm.scaleNode = particleScale({ center: hazeCenter, size: haze.size, minPixels: 2, objectScale: this.objectScale })
      .mul(frontFacing(dir, hazeCenter, 0.05));
    const hazeRgb = colorAttr.xyz.mul(planetLit.add(rockyLook.ambient)).mul(limb).mul(rockyLook.dotGain).mul(gasLook.haze);
    hm.colorNode = vec4(hazeRgb.mul(shade), 1);
    hm.opacityNode = softDisc().mul(0.8).mul(tier.appear);
    return { globe: field, haze };
  }

  /** Sombra de los anillos y de las lunas (§5.3) en un punto del globo (espacio local). */
  private shadows(local: Vec3Node, rings: Rings | null): FloatNode | Vec3Node {
    let shade: FloatNode | Vec3Node = float(1);
    if (rings) {
      // Sombra de los anillos: el punto y el Sol en el espacio del planeta (sin el giro propio).
      shade = shade.mul(ringShadow(this.spinToBody(local), this.equatorialSun(), rings.bands));
    }
    // Tránsitos de sombra: las de las lunas, puntos negros que cruzan el disco.
    if (this.shadow) shade = shade.mul(this.shadow.lightNode(modelWorldMatrix.mul(vec4(local, 0)).xyz.div(this.objectScale)));
    return shade;
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
      const [calm0, calm1] = calmRange(p);
      const polar = smoothstep(calm1, calm0, lat.abs());
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
      // Sin verse (o con el planeta pequeño) el flujo se pausa entero, también el avance de los
      // vórtices: si siguiera solo en la CPU, su centro se separaría de sus partículas. No vale un
      // prefijo, como en el Sol: cada partícula lleva su color (la Gran Mancha Roja) y se quedaría atrás.
      if (this.radiusPx < FLOW_MIN_PX || !this.inView(ctx, 1.05)) return;
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
