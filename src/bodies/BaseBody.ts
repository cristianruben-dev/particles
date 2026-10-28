/**
 * Base común: colocación con origen flotante, orientación IAU, uniforms de iluminación,
 * niveles de detalle (vista previa y completo) con su "condensación", y el punto lejano.
 * Ver docs/ARQUITECTURA.md §5, §6.3 y §8.
 */
import * as THREE from 'three/webgpu';
import { cameraPosition, float, modelWorldMatrix, modelWorldMatrixInverse, uniform, vec3, vec4 } from 'three/tsl';
import { handoff } from '../core/Handoff';
import { horizonMask } from '../core/Horizon';
import type { BodyData } from '../astro/bodies';
import { spinAngle } from '../astro/ephemeris';
import { eclToScene, vec3d, type Vec3d } from '../astro/frames';
import { bodyFrame, cross3d } from '../astro/orientation';
import { config } from '../config';
import { disturbanceLook, type LocalRay } from '../particles/Disturbance';
import { detailFraction, projectedRadiusPx } from '../particles/LodManager';
import { pixelAngle, softDisc } from '../particles/nodes';
import type { FloatNode, Vec3Node } from '../particles/nodes';
import type { CelestialBody, FrameContext } from './CelestialBody';
import { DetailTier, type TierKind } from './DetailTier';
import { EclipseShadow } from './Shadows';

/** Segundos que tarda un cuerpo en condensarse desde el polvo al cargar. */
const APPEAR_SECONDS = 2.2;
/** Paso de vista previa a detalle completo: más corto, el cuerpo ya estaba ahí. */
const UPGRADE_SECONDS = 1.4;
/** Diámetro del punto lejano (px CSS). */
const MARKER_PX = 3.5;
/**
 * Perturbación del ratón (§6.4): radio de influencia máximo en radios del cuerpo, y radio en
 * pantalla (px) entre los que entra. De lejos, los 90 px del cursor abarcaban el cuerpo entero
 * y el empuje, proporcional a ese radio, lo inflaba al doble o al triple.
 */
const DISTURB_MAX_RADII = 0.3;
const DISTURB_FADE_PX: [number, number] = [40, 140];

export abstract class BaseBody implements CelestialBody {
  /**
   * Mientras es true, nadie se condensa: la pantalla de carga lo suelta al irse y todos los
   * cuerpos se forman a la vez desde el polvo, a la vista.
   */
  static formationHeld = false;

  /** Posición, escala (radio en escena) y orientación del polo. */
  readonly object3d = new THREE.Group();
  /** Hijo que gira sobre el eje del cuerpo. La superficie cuelga de aquí. */
  protected readonly spin = new THREE.Group();

  readonly positionKm = vec3d();
  readonly sceneD = vec3d();
  sceneRadius = 1;
  /** Se resuelve cuando la vista previa está en la GPU. */
  readonly ready: Promise<void>;
  private resolveReady!: () => void;

  /** Radio del cuerpo en escena (para tamaños mínimos en píxeles). */
  protected readonly objectScale = uniform(1);
  /** Dirección hacia el Sol en mundo (ejes de escena). */
  protected readonly sunDirection = uniform(new THREE.Vector3(1, 0, 0));
  /** Radio en pantalla (px CSS) en el último frame. */
  protected radiusPx = 0;
  get screenRadiusPx(): number {
    return this.radiusPx;
  }
  /** false = un solo nivel, siempre completo (el Sol). */
  protected readonly hasFullTier: boolean = true;

  private preview: DetailTier | null = null;
  private full: DetailTier | null = null;
  private fullLoading = false;
  private focused = false;
  private smallSeconds = 0;
  private renderer: THREE.WebGPURenderer | null = null;

  private readonly markerAlpha = uniform(0);

  /** Brillo del punto lejano (los cometas inactivos apenas se ven). */
  protected markerGain = 1;

  /** Sombras de eclipse que pueden caer sobre el cuerpo (§5.3), o null. */
  protected readonly shadow: EclipseShadow | null;

  constructor(readonly data: BodyData, readonly parent: CelestialBody | null) {
    this.shadow = EclipseShadow.for(data.id);
    this.object3d.name = data.id;
    this.object3d.add(this.spin);
    this.object3d.add(this.createMarker());
    this.ready = new Promise((resolve) => (this.resolveReady = resolve));
  }

  /** Construye las capas de partículas de un nivel. */
  protected abstract buildTier(kind: TierKind): Promise<DetailTier>;

  /** Llamar al final del constructor de cada subclase: hornea la vista previa. */
  protected start(): void {
    void this.loadTier('preview');
  }

  get particleCount(): number {
    let n = 0;
    for (const tier of [this.preview, this.full]) {
      if (tier?.visible) n += tier.fields.reduce((s, f) => s + (f.field.object.visible ? f.field.object.count : 0), 0);
    }
    return n;
  }

  setFocused(focused: boolean): void {
    this.focused = focused;
  }

  protected get isFocused(): boolean {
    return this.focused;
  }

  /** Nivel completo, si está cargado. */
  protected get fullTier(): DetailTier | null {
    return this.full;
  }

  /** ¿Se puede bajar hasta el suelo? Solo los rocosos con superficie (§7). */
  get landable(): boolean {
    return false;
  }

  /** Altura del suelo (km) bajo una dirección de escena. Sin superficie, el radio medio. */
  groundHeightKm(_dir: Vec3d): number {
    return 0;
  }

  private readonly spinQ = new THREE.Quaternion();
  /** Orientación del grupo que gira (cuerpo × giro propio), en ejes de escena. */
  get spinQuaternion(): THREE.Quaternion {
    return this.spinQ.copy(this.object3d.quaternion).multiply(this.spin.quaternion);
  }

  /**
   * Fondo visto desde la cámara: cielo (cuerpos con atmósfera, de día) y suelo bajo el
   * horizonte. `amount` = 0 en el espacio.
   */
  readonly sky = {
    color: new THREE.Color(0, 0, 0),
    ground: new THREE.Color(0, 0, 0),
    up: new THREE.Vector3(0, 1, 0),
    dip: -1,
    amount: 0,
  };

  private async loadTier(kind: TierKind): Promise<void> {
    const tier = await this.buildTier(kind);
    for (const r of tier.roots) (r.spin ? this.spin : this.object3d).add(r.object);
    if (kind === 'preview') {
      this.preview = tier;
      this.resolveReady();
    } else {
      // Si la vista previa aún se está condensando (al arrancar), seguir desde ahí.
      if (this.preview && this.preview.appear.value < 1) tier.appear.value = this.preview.appear.value;
      this.full = tier;
      this.fullLoading = false;
    }
  }

  update(ctx: FrameContext): void {
    this.renderer = ctx.renderer;
    this.object3d.scale.setScalar(this.sceneRadius);
    this.objectScale.value = this.sceneRadius;
    ctx.origin.place(this.object3d, this.sceneD);
    this.orient(ctx.timeMs);

    const toSun = eclToScene({ x: -this.positionKm.x, y: -this.positionKm.y, z: -this.positionKm.z });
    this.sunDirection.value.set(toSun.x, toSun.y, toSun.z).normalize();

    this.shadow?.update(this, ctx.body, ctx.timeMs);

    this.radiusPx = projectedRadiusPx(this.sceneRadius, this.object3d.position.length());
    // De lejos, el punto también se apaga en un eclipse (Ío al entrar en la sombra de Júpiter).
    const light = this.shadow ? this.shadow.lightAt({ x: 0, y: 0, z: 0 }) : 1;
    this.markerAlpha.value = (1 - THREE.MathUtils.smoothstep(this.radiusPx, 1.5, 4)) * (0.15 + 0.85 * light) * this.markerGain;
    this.updateTiers(ctx);
  }

  /** Niveles de detalle: carga y libera el completo, condensa y aplica el LOD por densidad (§6.3). */
  private updateTiers(ctx: FrameContext): void {
    const { preview, full } = this;
    if (this.hasFullTier && !full && !this.fullLoading && (this.focused || this.radiusPx > config.lod.fullDetailPx)) {
      this.fullLoading = true;
      void this.loadTier('full');
    }

    if (preview && preview.appear.value < 1 && !BaseBody.formationHeld) {
      preview.appear.value = Math.min(1, preview.appear.value + ctx.dt / APPEAR_SECONDS);
    }
    if (full) {
      if (full.appear.value < 1 && !BaseBody.formationHeld) full.appear.value = Math.min(1, full.appear.value + ctx.dt / UPGRADE_SECONDS);
      preview?.setVisible(full.appear.value < 1);

      // Lejos y sin foco durante un rato: se libera el detalle completo.
      const small = !this.focused && this.radiusPx < config.lod.releasePx;
      this.smallSeconds = small ? this.smallSeconds + ctx.dt : 0;
      if (this.smallSeconds > config.lod.releaseSeconds) this.releaseFull();
    }

    for (const tier of [this.preview, this.full]) {
      if (!tier?.visible) continue;
      const fraction = detailFraction(tier.total, this.radiusPx);
      for (const { field, scale } of tier.fields) field.setVisibleFraction(Math.min(1, fraction * scale));
      for (const u of tier.updates) u(ctx);
    }
  }

  private releaseFull(): void {
    if (!this.full || !this.renderer) return;
    this.full.dispose(this.renderer);
    this.full = null;
    this.smallSeconds = 0;
    this.preview?.setVisible(true);
  }

  /** Polo y nodo IAU de la fecha → orientación del cuerpo en ejes de escena, y giro propio. */
  orient(timeMs: number): void {
    if (timeMs === this.orientedAt) return;
    this.orientedAt = timeMs;
    const f = bodyFrame(this.data.pole, timeMs);
    const x = eclToScene(f.node), y = eclToScene(f.pole), z = cross3d(x, y);
    basis.set(x.x, y.x, z.x, 0, x.y, y.y, z.y, 0, x.z, y.z, z.z, 0, 0, 0, 0, 1);
    this.object3d.quaternion.setFromRotationMatrix(basis);
    this.spin.rotation.y = this.rotationAngle(timeMs);
  }
  private orientedAt = NaN;

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
    const gain = THREE.MathUtils.smoothstep(this.radiusPx, DISTURB_FADE_PX[0], DISTURB_FADE_PX[1]);
    if (gain <= 0) return null;
    const missSq = c.lengthSq() - along * along;
    const bodyRadius = this.sceneRadius * 1.1;
    const hitDistance = missSq < bodyRadius * bodyRadius ? along - Math.sqrt(bodyRadius * bodyRadius - missSq) : along;
    const worldRadius = Math.min(
      disturbanceLook.radiusPx * pixelAngle.value * Math.max(hitDistance, 1e-6),
      DISTURB_MAX_RADII * this.sceneRadius,
    );
    if (Math.sqrt(Math.max(missSq, 0)) > bodyRadius + worldRadius) return null;

    space.updateWorldMatrix(true, false);
    const inverse = space.matrixWorld.clone().invert();
    return {
      origin: new THREE.Vector3().applyMatrix4(inverse),
      direction: dir.clone().transformDirection(inverse),
      radius: worldRadius / this.sceneRadius,
      gain,
    };
  }

  /**
   * ¿Se ve este frame la esfera de `radii` radios alrededor del cuerpo (cuerpo dibujado y dentro
   * del campo de visión)? Lo que no se ve no gasta pasadas compute (§6.3). Cada capa pasa lo que
   * abarca: la superficie ~1, los anillos su borde exterior.
   */
  protected inView(ctx: FrameContext, radii: number): boolean {
    if (!this.object3d.visible) return false;
    viewSphere.center.copy(this.object3d.position);
    viewSphere.radius = this.sceneRadius * radii;
    return ctx.frustum.intersectsSphere(viewSphere);
  }

  /** Ángulo de giro propio (rad) alrededor del eje local y, desde el nodo Q. */
  protected rotationAngle(timeMs: number): number {
    if (this.data.id === 'moon' && this.parent) {
      // La Luna: lon 0° hacia la Tierra (su W de la IAU necesita términos de libración).
      const p = this.parent.sceneD;
      const toParent = new THREE.Vector3(p.x - this.sceneD.x, p.y - this.sceneD.y, p.z - this.sceneD.z)
        .applyQuaternion(this.object3d.quaternion.clone().invert());
      return Math.atan2(-toParent.z, toParent.x);
    }
    return spinAngle(this.data, timeMs);
  }

  /**
   * Posición durante la condensación: cada partícula llega desde fuera, con un
   * retraso propio según su valor aleatorio `rand`.
   */
  protected condense(position: Vec3Node, rand: FloatNode, appear: FloatNode): Vec3Node {
    const t = appear.mul(1.6).sub(rand.mul(0.6)).clamp(0, 1);
    const scatter = float(1).sub(t).pow(2).mul(rand.mul(1.5).add(0.4));
    return position.mul(scatter.add(1));
  }

  /** Punto brillante con el color del cuerpo cuando mide menos de unos píxeles (escala real). */
  private createMarker(): THREE.Sprite {
    const material = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    material.sizeAttenuation = false;
    // En la cara del cuerpo que mira a la cámara: no lo tapan sus propias partículas.
    const toCamera = modelWorldMatrixInverse.mul(vec4(cameraPosition, 1)).xyz.normalize();
    material.positionNode = toCamera.mul(1.05);
    material.scaleNode = pixelAngle.mul(MARKER_PX).div(this.objectScale);
    const c = new THREE.Color(this.data.color);
    const gain = this.data.kind === 'star' ? 8 : 1.6;
    const world = modelWorldMatrix.mul(vec4(toCamera.mul(1.05), 1)).xyz;
    material.colorNode = vec4(vec3(c.r, c.g, c.b).mul(gain).mul(this.markerAlpha).mul(horizonMask(world)).mul(handoff.solar), 1);
    material.opacityNode = softDisc();
    const marker = new THREE.Sprite(material);
    marker.frustumCulled = false;
    return marker;
  }

  dispose(): void {
    if (!this.renderer) return;
    this.preview?.dispose(this.renderer);
    this.full?.dispose(this.renderer);
  }
}

const basis = new THREE.Matrix4();
const viewSphere = new THREE.Sphere();
