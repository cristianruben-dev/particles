/**
 * Cometas: núcleo, coma y dos colas de partículas. Ver docs/ARQUITECTURA.md §8.
 *
 * - **Coma**: nube alrededor del núcleo con densidad ∝ 1/r² (brillo ∝ 1/ρ al proyectarla),
 *   algo desplazada hacia el Sol, verdosa hacia fuera (el C₂). Crece con la actividad.
 * - **Cola de polvo**: modelo de síndinas. Un grano soltado hace τ días con la velocidad del
 *   núcleo nota la gravedad del Sol rebajada en (1 − β) por la presión de la luz, y se queda
 *   atrás y hacia fuera: la cola se curva en el plano de la órbita. La CPU propaga (dos
 *   cuerpos, variables universales) una rejilla de edades × β y el shader interpola en ella.
 * - **Cola de iones**: recta, en contra del Sol con la aberración del viento solar
 *   (~400 km/s), azul y con filamentos que fluyen.
 *
 * Todo se coloca respecto al núcleo en km y pasa a escena con `ScaleSystem.distanceNode`
 * del propio cometa (§4.3): la cámara, que lo enfoca con la misma función, ve la coma y las
 * colas donde cree que están. El radio del cuerpo (`BodyData.radiusKm`) es el de referencia
 * de la coma; el del núcleo va en la ficha.
 */
import * as THREE from 'three/webgpu';
import { exp, float, floor, fract, length, max, min, mix, modelWorldMatrix, normalize, pow, sin, smoothstep, uniform, vec3, vec4 } from 'three/tsl';
import type { BodyData } from '../astro/bodies';
import { GM_SUN, cometActivity, cometElementsAt, cometPosition, cometVelocity, propagateUniversal, type CometElements } from '../astro/comets';
import { eclToScene } from '../astro/frames';
import { terrestrialTimeMs } from '../astro/units';
import { horizonMask } from '../core/Horizon';
import { pixelAngle, softDisc, type Vec3Node } from '../particles/nodes';
import { ParticleField } from '../particles/ParticleField';
import type { ScaleSystem } from '../scale/ScaleSystem';
import { BaseBody } from './BaseBody';
import type { CelestialBody, FrameContext } from './CelestialBody';
import { DetailTier, type TierKind } from './DetailTier';

export const cometLook = {
  brightness: uniform(1),
};

/** Rejilla de síndinas: edades (días, en escala log) × β. */
const AGES = 24;
const AGE_MIN_D = 0.12;
const AGE_MAX_D = 30;
const BETAS = [0.02, 0.05, 0.1, 0.2, 0.35, 0.6];
/** Viento solar (km/s): la cola de iones se inclina hacia atrás v/400. */
const SOLAR_WIND_KM_S = 400;

const COUNTS: Record<TierKind, { coma: number; dust: number; ion: number }> = {
  preview: { coma: 4_000, dust: 16_000, ion: 8_000 },
  full: { coma: 24_000, dust: 110_000, ion: 50_000 },
};

export class Comet extends BaseBody {
  /** Elementos de la aparición más cercana a la fecha (`cometElementsAt`). */
  private elements: CometElements;
  private readonly activity = uniform(0);
  /** Fase de la animación del flujo (0–1), reducida en la CPU. */
  private readonly phase = uniform(0);
  private readonly comaKm = uniform(2e4);
  private readonly sunward = uniform(new THREE.Vector3(1, 0, 0));
  private readonly ionDir = uniform(new THREE.Vector3(-1, 0, 0));
  private readonly ionSide = uniform(new THREE.Vector3(0, 1, 0));
  private readonly ionUp = uniform(new THREE.Vector3(0, 0, 1));
  private readonly ionKm = uniform(1e7);
  /** Desplazamientos (km, ejes de escena) de la rejilla de síndinas respecto al núcleo. */
  private readonly grid = new Float32Array(AGES * BETAS.length * 4);
  private gridAt = NaN;
  /** Sube con cada cálculo de la rejilla: cada nivel vuelve a subir su copia a la GPU. */
  private gridVersion = 0;
  private readonly fields: ParticleField[] = [];

  constructor(data: BodyData, parent: CelestialBody | null, private readonly scale: ScaleSystem) {
    super(data, parent);
    this.elements = cometElementsAt(data.comet!, 0);
    this.start();
  }

  /** Actividad actual (0–1), para la UI. */
  get activityLevel(): number {
    return this.activity.value;
  }

  protected async buildTier(kind: TierKind): Promise<DetailTier> {
    const tier = new DetailTier(kind);
    const n = COUNTS[kind];
    const rand = Math.random;

    // Del desplazamiento en km respecto al núcleo a unidades locales (radios del cometa).
    const place = (km: Vec3Node): Vec3Node => {
      const d = max(length(km), 1);
      return normalize(km).mul(this.scale.distanceNode(this.data, d)).div(this.objectScale);
    };
    const pointMaterial = (field: ParticleField, local: Vec3Node, px: number, rgb: Vec3Node) => {
      const m = field.material;
      m.sizeAttenuation = false;
      m.positionNode = local;
      m.scaleNode = pixelAngle.mul(px).div(this.objectScale);
      const world = modelWorldMatrix.mul(vec4(local, 1)).xyz;
      m.colorNode = vec4(rgb.mul(cometLook.brightness).mul(horizonMask(world)), 1);
      m.opacityNode = softDisc();
      this.fields.push(field);
      tier.addField(field, false, 0);
    };

    // Coma: dirección isótropa y radio uniforme (densidad ∝ 1/r²), con un poco hacia el Sol.
    {
      const data = new Float32Array(n.coma * 4);
      for (let i = 0; i < n.coma; i++) {
        const z = rand() * 2 - 1, a = rand() * Math.PI * 2, s = Math.sqrt(1 - z * z);
        data.set([s * Math.cos(a), z, s * Math.sin(a), rand()], i * 4);
      }
      const attr = tier.buffer(data).toAttribute();
      const u = attr.w;
      // Más concentrada que 1/r² en el centro: de lejos se lee como una cabeza, no como un disco.
      const radius = pow(u, 1.7);
      const km = attr.xyz.mul(radius).add(this.sunward.mul(radius.mul(0.35).mul(fract(u.mul(91.7))))).mul(this.comaKm);
      const inner = smoothstep(0.85, 0.05, u);
      const rgb = mix(vec3(0.45, 1.0, 0.68), vec3(1.0, 0.96, 0.88), inner).mul(this.activity).mul(float(1).sub(u).pow(0.6)).mul(0.05);
      pointMaterial(new ParticleField(n.coma, 'additive'), place(km), 2.4, rgb);
    }

    // Cola de polvo: (edad, β) en la rejilla, con dispersión lateral que crece con la edad.
    {
      const params = new Float32Array(n.dust * 4);
      const spread = new Float32Array(n.dust * 4);
      for (let i = 0; i < n.dust; i++) {
        params.set([rand(), rand(), rand(), rand()], i * 4);
        const z = rand() * 2 - 1, a = rand() * Math.PI * 2, s = Math.sqrt(1 - z * z);
        // Velocidad de salida del grano (km/s): de unas decenas de m/s a unos cientos.
        spread.set([s * Math.cos(a), z, s * Math.sin(a), 0.02 + rand() * rand() * 0.25], i * 4);
      }
      const p = tier.buffer(params).toAttribute();
      const j = tier.buffer(spread).toAttribute();
      const grid = tier.buffer(this.grid);
      let uploaded = -1;
      tier.updates.push(() => {
        if (uploaded === this.gridVersion) return;
        uploaded = this.gridVersion;
        grid.value.needsUpdate = true;
      });
      // La edad fluye con el tiempo real: los granos se alejan del núcleo y vuelven a salir.
      const age = fract(p.x.add(this.phase.mul(p.w.mul(0.5).add(0.75))));
      const fa = age.mul(AGES - 1), fb = p.y.mul(BETAS.length - 1);
      const ia = min(floor(fa), AGES - 2), ib = min(floor(fb), BETAS.length - 2);
      const ta = fa.sub(ia), tb = fb.sub(ib);
      const cell = (da: number, db: number) => grid.element(ia.add(da).mul(BETAS.length).add(ib).add(db).toUint()).xyz;
      const km0 = mix(mix(cell(0, 0), cell(0, 1), tb), mix(cell(1, 0), cell(1, 1), tb), ta);
      const days = exp(mix(float(Math.log(AGE_MIN_D)), float(Math.log(AGE_MAX_D)), age));
      const km = km0.add(j.xyz.mul(j.w).mul(days.mul(86_400)));
      const fade = float(1).sub(age).pow(1.4);
      const rgb = vec3(1.0, 0.9, 0.74).mul(this.activity).mul(fade).mul(0.065);
      pointMaterial(new ParticleField(n.dust, 'additive'), place(km), 1.9, rgb);
    }

    // Cola de iones: recta, con filamentos (rayos) que ondulan y fluyen deprisa.
    {
      const data = new Float32Array(n.ion * 4);
      for (let i = 0; i < n.ion; i++) data.set([rand(), Math.floor(rand() * 7) / 7 + rand() * 0.04, rand(), rand()], i * 4);
      const attr = tier.buffer(data).toAttribute();
      const s = pow(fract(attr.x.add(this.phase.mul(attr.w.mul(1.2).add(2.4)))), 1.5);
      const along = s.mul(this.ionKm);
      const angle = attr.y.mul(Math.PI * 2);
      const width = along.mul(0.022).add(6_000).mul(attr.z.mul(0.8).add(0.2));
      const wave = sin(along.div(this.ionKm.mul(0.11)).sub(this.phase.mul(40)).add(attr.y.mul(17))).mul(along.mul(0.018));
      const km = this.ionDir.mul(along)
        .add(this.ionSide.mul(angle.cos().mul(width).add(wave)))
        .add(this.ionUp.mul(angle.sin().mul(width)));
      const rgb = vec3(0.38, 0.62, 1.0).mul(this.activity).mul(float(1).sub(s).pow(0.9)).mul(0.04);
      pointMaterial(new ParticleField(n.ion, 'additive'), place(km), 1.7, rgb);
    }

    // Falso núcleo: el punto brillante del centro de la coma.
    {
      const field = new ParticleField(1, 'additive');
      const glow = this.activity.mul(2.2).add(0.25);
      pointMaterial(field, vec3(0, 0, 0), 5, vec3(1.0, 0.97, 0.9).mul(glow));
    }

    tier.total = n.dust;
    tier.updates.push(() => {
      for (const f of this.fields) f.object.visible = this.activity.value > 0.003 || f.count === 1;
    });
    return tier;
  }

  update(ctx: FrameContext): void {
    super.update(ctx);
    this.elements = cometElementsAt(this.data.comet!, terrestrialTimeMs(ctx.timeMs));
    const r = Math.hypot(this.positionKm.x, this.positionKm.y, this.positionKm.z);
    const act = cometActivity(this.elements, r);
    this.activity.value = act;
    this.markerGain = 0.3 + 0.7 * act;
    this.phase.value = (ctx.nowSeconds * 0.018) % 1;
    if (act <= 0.003) return;

    const p = eclToScene(this.positionKm);
    this.sunward.value.set(-p.x / r, -p.y / r, -p.z / r);
    this.comaKm.value = 8e3 + 7e4 * act * act;

    const tt = terrestrialTimeMs(ctx.timeMs);
    const v = eclToScene(cometVelocity(this.elements, tt));
    // Iones: en contra del Sol y hacia atrás, por el movimiento del cometa en el viento solar.
    const dir = new THREE.Vector3(p.x / r - v.x / SOLAR_WIND_KM_S, p.y / r - v.y / SOLAR_WIND_KM_S, p.z / r - v.z / SOLAR_WIND_KM_S).normalize();
    const normal = new THREE.Vector3(p.x, p.y, p.z).cross(new THREE.Vector3(v.x, v.y, v.z)).normalize();
    this.ionDir.value.copy(dir);
    this.ionSide.value.crossVectors(dir, normal).normalize();
    this.ionUp.value.crossVectors(dir, this.ionSide.value);
    this.ionKm.value = 8e7 * act;

    if (!(Math.abs(tt - this.gridAt) <= 1000)) this.updateGrid(tt);
  }

  /** Síndinas: dónde está ahora el polvo soltado hace τ días con cada β (km, respecto al núcleo). */
  private updateGrid(tt: number): void {
    this.gridAt = tt;
    const now = cometPosition(this.elements, tt);
    for (let k = 0; k < AGES; k++) {
      const days = AGE_MIN_D * Math.pow(AGE_MAX_D / AGE_MIN_D, k / (AGES - 1));
      const t0 = tt - days * 86_400_000;
      const r0 = cometPosition(this.elements, t0), v0 = cometVelocity(this.elements, t0);
      BETAS.forEach((beta, b) => {
        const q = propagateUniversal(r0, v0, days * 86_400, GM_SUN * (1 - beta));
        const d = eclToScene({ x: q.x - now.x, y: q.y - now.y, z: q.z - now.z });
        this.grid.set([d.x, d.y, d.z, 0], (k * BETAS.length + b) * 4);
      });
    }
    this.gridVersion++;
  }

  /** Sin giro propio: las colas se colocan en ejes de escena. */
  orient(_timeMs: number): void {
    this.object3d.quaternion.identity();
    this.spin.rotation.y = 0;
  }

}
