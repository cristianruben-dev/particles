/**
 * Base común: colocación con origen flotante, orientación, uniforms de iluminación
 * y la animación de "condensación" al aparecer.
 */
import * as THREE from 'three/webgpu';
import { float, uniform } from 'three/tsl';
import type { BodyData } from '../astro/bodies';
import { eclToScene, vec3d } from '../astro/frames';
import { genericRotationAngle, greenwichMeanSiderealTime } from '../astro/ephemeris';
import { DEG } from '../astro/units';
import { disturbanceLook, type LocalRay } from '../particles/Disturbance';
import { detailFraction, LodLevel, projectedRadiusPx } from '../particles/LodManager';
import { pixelAngle } from '../particles/nodes';
import type { ParticleField } from '../particles/ParticleField';
import type { FloatNode, Vec3Node } from '../particles/nodes';
import type { CelestialBody, FrameContext } from './CelestialBody';

/** Segundos que tarda un cuerpo en condensarse desde el polvo. */
const APPEAR_SECONDS = 2.2;

export abstract class BaseBody implements CelestialBody {
  /** Posición, escala (radio en escena) e inclinación del eje. */
  readonly object3d = new THREE.Group();
  /** Hijo que gira sobre el eje del cuerpo. La superficie cuelga de aquí. */
  protected readonly spin = new THREE.Group();

  readonly positionKm = vec3d();
  readonly sceneD = vec3d();
  sceneRadius = 1;
  /** Partículas dibujadas en el último frame. */
  get particleCount(): number {
    return this.lodFields.reduce((n, f) => n + f.object.count, 0);
  }
  abstract readonly ready: Promise<void>;

  /** Radio del cuerpo en escena (para tamaños mínimos en píxeles). */
  protected readonly objectScale = uniform(1);
  /** Dirección hacia el Sol en mundo (ejes de escena). */
  protected readonly sunDirection = uniform(new THREE.Vector3(1, 0, 0));
  /** 0 → 1 mientras el cuerpo se condensa. */
  protected readonly appear = uniform(0);
  private appearing = false;

  protected lod = LodLevel.Globe;
  /** Campos que se aligeran con la distancia (todos usan la misma fracción). */
  protected readonly lodFields: ParticleField[] = [];
  /** Partículas de la capa principal: referencia para calcular la fracción de detalle. */
  protected detailTotal = 1;

  constructor(readonly data: BodyData, readonly parent: CelestialBody | null) {
    this.object3d.name = data.id;
    // Aproximación: polo inclinado hacia la longitud eclíptica 90°. Exacto para la Tierra.
    // TODO(fase 2): orientación de polos IAU para el resto de cuerpos.
    this.object3d.rotation.x = -data.axialTiltDeg * DEG;
    this.object3d.add(this.spin);
  }

  /** Llamar cuando las partículas estén en la GPU: arranca la condensación. */
  protected startAppearing(): void {
    this.appearing = true;
  }

  update(ctx: FrameContext): void {
    this.object3d.scale.setScalar(this.sceneRadius);
    this.objectScale.value = this.sceneRadius;
    ctx.origin.place(this.object3d, this.sceneD);
    this.spin.rotation.y = this.rotationAngle(ctx.timeMs);

    const toSun = eclToScene({ x: -this.positionKm.x, y: -this.positionKm.y, z: -this.positionKm.z });
    this.sunDirection.value.set(toSun.x, toSun.y, toSun.z).normalize();

    // LOD por densidad (§6.3): solo las partículas que caben en el disco en pantalla.
    const radiusPx = projectedRadiusPx(this.sceneRadius, this.object3d.position.length());
    const fraction = detailFraction(this.detailTotal, radiusPx);
    for (const field of this.lodFields) field.setVisibleFraction(fraction);

    if (this.appearing && this.appear.value < 1) {
      this.appear.value = Math.min(1, this.appear.value + ctx.dt / APPEAR_SECONDS);
    }
  }

  /**
   * Rayo del cursor en el espacio local de `space` (una capa de partículas del cuerpo),
   * o null si el cursor no pasa cerca del cuerpo. Ver docs/ARQUITECTURA.md §6.4.
   */
  protected localPointerRay(ctx: FrameContext, space: THREE.Object3D): LocalRay | null {
    const dir = ctx.pointer;
    if (!dir) return null;
    // La cámara está en el origen: rayo (0, dir) contra la esfera del cuerpo, en mundo.
    const c = this.object3d.position;
    const along = c.dot(dir);
    if (along <= 0) return null;
    const missSq = c.lengthSq() - along * along;
    const bodyRadius = this.sceneRadius * 1.1;
    const hitDistance = missSq < bodyRadius * bodyRadius ? along - Math.sqrt(bodyRadius * bodyRadius - missSq) : along;
    const worldRadius = disturbanceLook.radiusPx * pixelAngle.value * Math.max(hitDistance, 1e-6);
    if (Math.sqrt(Math.max(missSq, 0)) > bodyRadius + worldRadius) return null;

    space.updateWorldMatrix(true, false);
    const inverse = space.matrixWorld.clone().invert();
    return {
      origin: new THREE.Vector3().applyMatrix4(inverse),
      direction: dir.clone().transformDirection(inverse),
      radius: worldRadius / this.sceneRadius,
    };
  }

  /** Ángulo de giro propio (rad) alrededor del eje local y. */
  protected rotationAngle(timeMs: number): number {
    if (this.data.id === 'earth') return greenwichMeanSiderealTime(timeMs);
    if (this.data.tidallyLocked && this.parent) {
      // lon 0° hacia el padre: dirección al padre en el marco inclinado del cuerpo.
      const p = this.parent.sceneD;
      const toParent = new THREE.Vector3(p.x - this.sceneD.x, p.y - this.sceneD.y, p.z - this.sceneD.z)
        .applyQuaternion(this.object3d.quaternion.clone().invert());
      return Math.atan2(-toParent.z, toParent.x);
    }
    return genericRotationAngle(this.data, timeMs);
  }

  /**
   * Posición durante la condensación: cada partícula llega desde fuera, con un
   * retraso propio según su valor aleatorio `rand`.
   */
  protected condense(position: Vec3Node, rand: FloatNode): Vec3Node {
    const t = this.appear.mul(1.6).sub(rand.mul(0.6)).clamp(0, 1);
    const scatter = float(1).sub(t).pow(2).mul(rand.mul(1.5).add(0.4));
    return position.mul(scatter.add(1));
  }

  setLod(level: LodLevel): void {
    this.lod = level;
  }

  abstract dispose(): void;
}
