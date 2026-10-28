/**
 * Capa cósmica: lo que está más allá del sistema solar. Ver docs/ARQUITECTURA.md §14.2.
 *
 * Todo se proyecta sobre una cáscara de radio `COSMIC_SKY_RADIUS` alrededor de la cámara,
 * como las estrellas: cada partícula va en su dirección real desde la cámara cósmica, con
 * tamaño angular = diámetro / distancia real. Es aditivo: no hay que ordenar ni hace falta
 * otra pasada, y bloom, warp y horizonte funcionan igual. La escena solar queda siempre
 * delante, porque el relevo (§14.4) la mantiene dentro de la cáscara.
 *
 * Verdad en km float64 respecto al Sol, en ejes de escena. A la GPU sube en años luz
 * (`ScaleSystem.cosmic`): la resta objeto − cámara se hace en float64 en la CPU y cada
 * partícula guarda su posición respecto al centro de su galaxia.
 */
import * as THREE from 'three/webgpu';
import { float, max, min, mix, smoothstep, uniform, vec4 } from 'three/tsl';
import type { Vec3d } from '../astro/frames';
import { GALACTIC_CENTER_KM } from '../astro/galaxy';
import { PC_KM } from '../astro/units';
import { bvToRgb } from '../bodies/Starfield';
import { aboveHorizon, horizon } from '../core/Horizon';
import { pixelAngle, softDisc, type FloatNode, type Vec3Node } from '../particles/nodes';
import { ParticleField, vec4Buffer } from '../particles/ParticleField';
import type { ScaleSystem } from '../scale/ScaleSystem';
import type { GalaxyResult } from './milkyWayModel';

/** Radio de la cáscara (escena): por fuera de la escena solar entera (§14.4), dentro del plano lejano. */
export const COSMIC_SKY_RADIUS = 5e9;

export const cosmicLook = {
  /** Brillo de la galaxia y opacidad de su polvo (panel de debug). */
  galaxy: uniform(0.03),
  dust: uniform(0.2),
  /** De día se apaga como las estrellas (lo pone el Engine). */
  sky: uniform(1),
};

/** Diámetro mínimo de una partícula en pantalla (px). */
const MIN_PX = 1.4;
/**
 * Y máximo: de cerca, una nube de millones de estrellas no puede verse como una mancha de
 * cientos de píxeles. Se queda en un punto más brillante (la misma luz, hasta `MAX_BOOST`),
 * así la galaxia se resuelve en "estrellas" al acercarse.
 */
const MAX_PX = 7;
const MAX_BOOST = 4;
/** Radio del disco (años luz) para el LOD: partículas por píxel² del disco en pantalla. */
const DISK_RADIUS_LY = 50_000;
const PARTICLES_PER_PX2 = 1.5;
const MIN_VISIBLE = 30_000;

/** Partículas que genera el modelo (estrellas y polvo). */
const STAR_COUNT = 600_000;
const DUST_COUNT = 160_000;

/** Lo que sale de la cáscara para una partícula a `rel` años luz de la cámara. */
interface ShellPlacement {
  position: Vec3Node;
  scale: FloatNode;
  /** Con el tamaño mínimo o máximo en píxeles, el brillo cambia con el área: la luz se conserva. */
  dim: FloatNode;
  /** Desvanecido cercano: cada partícula representa millones de estrellas. */
  near: FloatNode;
  dir: Vec3Node;
}

function shell(rel: Vec3Node, size: FloatNode): ShellPlacement {
  const d = rel.length();
  const dir = rel.div(d);
  const angular = size.div(d);
  const minAngular = pixelAngle.mul(MIN_PX);
  const maxAngular = pixelAngle.mul(MAX_PX);
  const scale = min(max(angular, minAngular), maxAngular);
  const ratio = angular.div(scale);
  return {
    position: dir.mul(COSMIC_SKY_RADIUS),
    scale,
    dim: min(ratio.mul(ratio), MAX_BOOST),
    near: smoothstep(size.mul(2), size.mul(8), d),
    dir,
  };
}

/** Como las estrellas: a ras de suelo, nada bajo el horizonte. */
const skyVisible = (dir: Vec3Node) => mix(float(1), aboveHorizon(dir), horizon.amount.greaterThan(0).select(1, 0));

/** La Vía Láctea vista desde fuera: estrellas (aditivas) y polvo (absorbe). */
class MilkyWay {
  readonly stars: ParticleField;
  readonly dust: ParticleField;
  /** Centro de la galaxia respecto a la cámara (años luz). */
  private readonly centre = uniform(new THREE.Vector3());
  private readonly presence = uniform(0);
  /** Con menos partículas dibujadas, cada una lleva más luz. */
  private readonly gain = uniform(1);

  constructor(data: GalaxyResult) {
    this.stars = this.layer(data.stars.posSize, data.stars.color, 'stars');
    this.dust = this.layer(data.dust.posSize, data.dust.color, 'dust');
  }

  private layer(posSize: Float32Array, color: Float32Array, kind: 'stars' | 'dust'): ParticleField {
    const field = new ParticleField(posSize.length / 4, 'additive');
    const m = field.material;
    const a = vec4Buffer(posSize).toAttribute();
    const c = vec4Buffer(color).toAttribute();
    const s = shell(this.centre.add(a.xyz), a.w);
    // Tamaño angular: con sizeAttenuation = false la escala se multiplica por la profundidad.
    m.sizeAttenuation = false;
    m.positionNode = s.position;
    m.scaleNode = s.scale;
    const k = s.dim.mul(s.near).mul(this.presence).mul(skyVisible(s.dir)).mul(cosmicLook.sky);
    if (kind === 'stars') {
      m.colorNode = vec4(c.xyz.mul(k).mul(this.gain).mul(cosmicLook.galaxy), 1);
      m.opacityNode = softDisc();
      field.object.renderOrder = -4;
    } else {
      // dst · (1 − src): oscurece lo que ya hay (las estrellas de la galaxia) sin ordenar.
      m.blending = THREE.CustomBlending;
      m.blendEquation = THREE.AddEquation;
      m.blendSrc = THREE.ZeroFactor;
      m.blendDst = THREE.OneMinusSrcColorFactor;
      m.colorNode = vec4(min(c.xyz.mul(k).mul(this.gain).mul(cosmicLook.dust).mul(softDisc()), 1), 1);
      field.object.renderOrder = -3;
    }
    return field;
  }

  update(centreLy: Vec3d, presence: number): void {
    this.centre.value.set(centreLy.x, centreLy.y, centreLy.z);
    this.presence.value = presence;
    const visible = presence > 0;
    this.stars.object.visible = this.dust.object.visible = visible;
    if (!visible) return;
    // LOD por densidad (§6.3): las partículas van en orden aleatorio, vale cualquier prefijo.
    const d = Math.hypot(centreLy.x, centreLy.y, centreLy.z);
    let fraction = 1;
    if (d > DISK_RADIUS_LY) {
      const radiusPx = DISK_RADIUS_LY / d / pixelAngle.value;
      fraction = Math.min(1, (PARTICLES_PER_PX2 * Math.PI * radiusPx * radiusPx) / this.stars.count);
    }
    this.stars.setVisibleFraction(fraction, MIN_VISIBLE);
    this.dust.setVisibleFraction(fraction, MIN_VISIBLE / 4);
    this.gain.value = this.stars.count / this.stars.object.count;
  }
}

/** El Sol visto desde fuera del sistema solar: una estrella más (magnitud absoluta 4,83). */
class SunStar {
  readonly field = new ParticleField(1, 'additive');
  /** Dirección del Sol desde la cámara (unitaria: en km no cabría en float32 al cuadrado). */
  private readonly dir = uniform(new THREE.Vector3(1, 0, 0));
  private readonly color = uniform(new THREE.Vector3());
  private readonly sizePx = uniform(2);
  private readonly rgb = bvToRgb(0.65);

  constructor() {
    const m = this.field.material;
    m.sizeAttenuation = false;
    m.positionNode = this.dir.mul(COSMIC_SKY_RADIUS);
    m.scaleNode = this.sizePx.mul(pixelAngle);
    m.colorNode = vec4(this.color.mul(cosmicLook.sky), 1);
    m.opacityNode = softDisc();
    // En el relevo, el Sol de la escena solar (opaco, cada vez más oscuro) está delante en la
    // misma dirección: sin prueba de profundidad no lo tapa. Solo se ve fuera del sistema solar.
    m.depthTest = false;
    // Después del polvo: no lo oscurece.
    this.field.object.renderOrder = -2;
  }

  update(relKm: Vec3d, presence: number): void {
    const distanceKm = Math.hypot(relKm.x, relKm.y, relKm.z);
    this.field.object.visible = presence > 0 && distanceKm > 0;
    if (!this.field.object.visible) return;
    this.dir.value.set(relKm.x / distanceKm, relKm.y / distanceKm, relKm.z / distanceKm);
    // Magnitud aparente y la misma conversión que las estrellas de Yale, con un mínimo para
    // que siga marcando dónde está (a 30 años luz ya no se vería a simple vista).
    const m = 4.83 + 5 * Math.log10(distanceKm / PC_KM / 10);
    const t = Math.min(1, Math.max(0, (6.5 - m) / 8));
    this.sizePx.value = 1.6 + 5 * t * t;
    const intensity = presence * Math.min(3.5, Math.max(0.12, 0.3 * Math.pow(10, -0.4 * (m - 1.5))));
    this.color.value.set(this.rgb[0] * intensity, this.rgb[1] * intensity, this.rgb[2] * intensity);
  }
}

export class CosmicLayer {
  readonly group = new THREE.Group();
  private readonly sun = new SunStar();
  private milkyWay: MilkyWay | null = null;
  private loading: Promise<void> | null = null;
  private readonly tmp = { x: 0, y: 0, z: 0 };
  private readonly gcDir = { x: 1, y: 0, z: 0 };

  constructor(private readonly scale: ScaleSystem) {
    this.group.add(this.sun.field.object);
  }

  /** Partículas dibujadas (para el HUD). */
  get particleCount(): number {
    const mw = this.milkyWay;
    if (!mw?.stars.object.visible) return 0;
    return mw.stars.object.count + mw.dust.object.count;
  }

  /** Genera la galaxia en un worker (la primera vez que hace falta). */
  load(): Promise<void> {
    this.loading ??= new Promise<GalaxyResult>((resolve, reject) => {
      const worker = new Worker(new URL('./galaxy.worker.ts', import.meta.url), { type: 'module' });
      worker.addEventListener('message', (e: MessageEvent<GalaxyResult>) => {
        resolve(e.data);
        worker.terminate();
      });
      worker.addEventListener('error', reject);
      worker.postMessage({ stars: STAR_COUNT, dust: DUST_COUNT, seed: 20_261_028 });
    }).then((data) => {
      this.milkyWay = new MilkyWay(data);
      this.group.add(this.milkyWay.stars.object, this.milkyWay.dust.object);
    });
    return this.loading;
  }

  /**
   * @param cameraKm cámara respecto al Sol (km, ejes de escena).
   * @param solar presencia del sistema solar (1 → 0 en el relevo); el Sol-estrella entra a la vez.
   * @param galaxy presencia del modelo de la galaxia (0 dentro del sistema solar).
   */
  update(cameraKm: Vec3d, solar: number, galaxy: number): void {
    const t = this.tmp;
    t.x = -cameraKm.x;
    t.y = -cameraKm.y;
    t.z = -cameraKm.z;
    this.sun.update(t, 1 - solar);
    const c = GALACTIC_CENTER_KM;
    t.x = this.scale.cosmic(c.x - cameraKm.x);
    t.y = this.scale.cosmic(c.y - cameraKm.y);
    t.z = this.scale.cosmic(c.z - cameraKm.z);
    const d = Math.hypot(t.x, t.y, t.z) || 1;
    Object.assign(this.gcDir, { x: t.x / d, y: t.y / d, z: t.z / d });
    this.milkyWay?.update(t, galaxy);
  }

  /** Dirección del centro galáctico desde la cámara (unitaria, del último `update`). */
  galacticCenterFromCamera(): Vec3d {
    return this.gcDir;
  }
}
