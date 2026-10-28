/**
 * Vuelo libre 6DOF con velocidad adaptativa. Ver docs/ARQUITECTURA.md §9.
 *
 * - La cámara va **anclada** al cuerpo más cercano: se guarda como (dirección, distancia en
 *   km) respecto a él, no como posición de escena. Así sigue al cuerpo en su órbita aunque
 *   el reloj vaya a 1 año/s, y el cambio de escala (comprimida ↔ real) la recoloca sola.
 * - Cada frame se mueve en escena (posición relativa al ancla + velocidad · dt) y se vuelve
 *   a (dirección, km) con la inversa de `localDistance`. El relevo de ancla parte de la
 *   posición de escena actual: no hay saltos.
 * - Velocidad ∝ altura sobre el suelo del ancla (en escena): cruzar de h a h/e cuesta lo
 *   mismo a 10 m que a 1 UA. Mayús multiplica; la rueda cambia la velocidad de crucero.
 * - Cerca del suelo, marco del cuerpo (gira con él), colisión con el relieve en km y
 *   nivelación suave del horizonte.
 */
import * as THREE from 'three/webgpu';
import type { CelestialBody } from '../bodies/CelestialBody';
import { HANDOFF_START_KM } from '../core/Handoff';
import type { CameraRig } from './CameraRig';
import type { NavigationMode } from './NavigationMode';

/** Velocidad: fracción de la altura recorrida por segundo. */
const SPEED = 0.8;
const BOOST = 5;
/** Altitud mínima sobre el suelo (km) en cuerpos con superficie y, en el resto, en radios. */
const MIN_GROUND_KM = 0.008;
const MIN_ALTITUDE_RADII = 0.03;
/** Marco del cuerpo por debajo de esta altitud (radios), con histéresis (como OrbitMode). */
const BODY_FRAME_ENTER = 0.1;
const BODY_FRAME_EXIT = 0.15;
/** Relevo de ancla: el candidato debe estar este factor más cerca (en radios propios). */
const HANDOFF = 0.7;
/** Por debajo de esta altitud (radios) el horizonte se nivela solo. */
const LEVEL_BELOW = 0.05;

type Frame = 'scene' | 'body';
const MOVE_KEYS = new Set(['w', 'a', 's', 'd', 'r', 'f', 'q', 'e', 'shift', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']);

export class FreeFlyMode implements NavigationMode {
  readonly name = 'freefly';

  anchor: CelestialBody;
  /** Dirección desde el centro del ancla (unitaria, en el marco actual) y distancia (km). */
  private readonly dir = new THREE.Vector3(1, 0, 0);
  private distanceKm = 1;
  private frame: Frame = 'scene';
  /** Orientación de la cámara en el marco actual. */
  private readonly look = new THREE.Quaternion();
  /** Velocidad en escena (unidades/s, ejes de escena). */
  private readonly velocity = new THREE.Vector3();
  /** Velocidad de crucero (rueda). */
  cruise = 1;
  /** Velocidad real respecto al ancla (km/s), suavizada, para la UI. */
  speedKmS = 0;
  /** 0–1: cuánto turbo se está usando. */
  boost = 0;
  /** Efecto warp (0–1): turbo hacia delante. */
  warp = 0;

  private readonly keys = new Set<string>();
  private dragging = false;
  private dragDistance = 0;
  private lastPointer = { x: 0, y: 0 };
  private abort = new AbortController();
  private lastKm = new THREE.Vector3();
  private hasLastKm = false;

  // Temporales.
  private readonly q = new THREE.Quaternion();
  private readonly lookScene = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly w = new THREE.Vector3();

  constructor(
    initial: CelestialBody,
    private readonly bodies: readonly CelestialBody[],
    private readonly element: HTMLElement,
    /** Clic sin arrastre: coordenadas normalizadas (−1…1). */
    private readonly onClick: (ndcX: number, ndcY: number) => void,
    /** Cambio de ancla (el motor enfoca el nuevo cuerpo: carga su detalle y su superficie). */
    private readonly onAnchor: (body: CelestialBody) => void,
  ) {
    this.anchor = initial;
  }

  /** Altitud sobre el suelo bajo la cámara (km). */
  get altitudeKm(): number {
    return Math.max(0, this.distanceKm - this.anchor.data.radiusKm - this.anchor.groundHeightKm(this.sceneDir()));
  }

  private get minAltitude(): number {
    return this.anchor.landable ? MIN_GROUND_KM : this.anchor.data.radiusKm * MIN_ALTITUDE_RADII;
  }

  /** Toma la cámara donde la dejó el modo anterior: misma posición y misma mirada. */
  enter(rig: CameraRig): void {
    this.abort = new AbortController();
    this.keys.clear();
    this.velocity.set(0, 0, 0);
    this.boost = 0;
    this.hasLastKm = false;
    this.frame = 'scene';
    this.adoptPosition(rig, this.anchor);
    rig.camera.updateMatrixWorld();
    this.look.copy(rig.camera.quaternion);
    this.bindInput();
  }

  exit(_rig: CameraRig): void {
    this.abort.abort();
    this.keys.clear();
  }

  update(rig: CameraRig, dt: number): void {
    const body = this.anchor;
    const r = body.data.radiusKm;

    // 1. Ancla: el cuerpo más cercano en radios propios (lo que se ve), con histéresis.
    // Con la posición de este frame (los cuerpos ya se han movido; durante el cambio de
    // escala, miles de unidades por frame) y nunca a mitad de ese cambio.
    const p = rig.position;
    const here = this.sceneDir();
    const reachNow = rig.scale.localDistance(body.data, this.distanceKm);
    p.x = body.sceneD.x + here.x * reachNow;
    p.y = body.sceneD.y + here.y * reachNow;
    p.z = body.sceneD.z + here.z * reachNow;
    if (!rig.scale.transitioning) {
      const ratio = (b: CelestialBody) => Math.hypot(p.x - b.sceneD.x, p.y - b.sceneD.y, p.z - b.sceneD.z) / b.sceneRadius;
      let best = body, bestRatio = ratio(body) * HANDOFF;
      for (const b of this.bodies) {
        const k = ratio(b);
        if (k < bestRatio) [best, bestRatio] = [b, k];
      }
      if (best !== body) {
        this.adoptPosition(rig, best);
        this.onAnchor(best);
        this.update(rig, dt);
        return;
      }
    }

    // 2. Marco: el del cuerpo a ras de suelo.
    const altitude = this.altitudeKm;
    if (body.landable) {
      if (this.frame === 'scene' && altitude < r * BODY_FRAME_ENTER) this.setFrame('body');
      else if (this.frame === 'body' && altitude > r * BODY_FRAME_EXIT) this.setFrame('scene');
    }
    const spin = this.frame === 'body' ? body.spinQuaternion : null;

    // 3. Giro sobre el eje (Q/E) y nivelación del horizonte cerca del suelo.
    const roll = (this.keys.has('q') ? 1 : 0) - (this.keys.has('e') ? 1 : 0);
    if (roll) this.look.multiply(this.q.setFromAxisAngle(AXIS_Z, roll * 1.4 * dt));
    if (!roll && altitude < r * LEVEL_BELOW) this.level(dt);
    // Flechas: mirar con el teclado.
    const yawKeys = (this.keys.has('arrowleft') ? 1 : 0) - (this.keys.has('arrowright') ? 1 : 0);
    const pitchKeys = (this.keys.has('arrowup') ? 1 : 0) - (this.keys.has('arrowdown') ? 1 : 0);
    if (yawKeys || pitchKeys) this.turn(yawKeys * 1.2 * dt, pitchKeys * 1.2 * dt);

    // 4. Velocidad deseada (escena): ∝ altura sobre el suelo en escena.
    const sceneDir = this.sceneDir();
    const groundKm = body.groundHeightKm(sceneDir);
    const sceneDistance = rig.scale.localDistance(body.data, this.distanceKm);
    const groundScene = rig.scale.localDistance(body.data, r + groundKm);
    const height = Math.max(sceneDistance - groundScene, 1e-12);
    const boosting = this.keys.has('shift');
    this.boost += ((boosting ? 1 : 0) - this.boost) * (1 - Math.exp(-dt * 3));
    const speed = height * SPEED * this.cruise * (1 + (BOOST - 1) * this.boost);
    const input = this.v.set(
      (this.keys.has('d') ? 1 : 0) - (this.keys.has('a') ? 1 : 0),
      (this.keys.has('r') ? 1 : 0) - (this.keys.has('f') ? 1 : 0),
      (this.keys.has('s') ? 1 : 0) - (this.keys.has('w') ? 1 : 0),
    );
    if (input.lengthSq() > 1) input.normalize();
    const ahead = Math.max(0, -input.z) * this.boost;
    this.warp += (ahead * 0.35 - this.warp) * (1 - Math.exp(-dt * 3));
    const lookScene = this.lookScene.copy(this.look);
    if (spin) lookScene.premultiply(spin);
    const desired = input.applyQuaternion(lookScene).multiplyScalar(speed);
    this.velocity.lerp(desired, 1 - Math.exp(-dt * 6));
    // Sin teclas, la velocidad tiende a cero aunque cambie la escala de la altura.
    if (this.velocity.length() > speed * 1.5) this.velocity.setLength(speed * 1.5);

    // 5. Mover en escena relativo al ancla y volver a (dirección, km).
    const rel = this.w.copy(sceneDir).multiplyScalar(sceneDistance).addScaledVector(this.velocity, dt);
    const newDistance = rel.length();
    const newDirScene = rel.divideScalar(newDistance);
    // Sin salir del sistema solar: el relevo al cosmos es solo con el zoom de la órbita (§14.5).
    let km = Math.min(rig.scale.inverseLocalDistance(body.data, newDistance), HANDOFF_START_KM);
    // Colisión con el relieve: nunca por debajo de la altitud mínima.
    const floor = r + body.groundHeightKm(newDirScene) + this.minAltitude;
    if (km < floor) {
      km = floor;
      const inward = this.velocity.dot(newDirScene);
      if (inward < 0) this.velocity.addScaledVector(newDirScene, -inward);
    }
    this.distanceKm = km;
    this.dir.copy(newDirScene);
    if (spin) this.dir.applyQuaternion(this.q.copy(spin).invert());

    // 6. Cámara.
    const finalDir = this.sceneDir();
    const d = rig.scale.localDistance(body.data, this.distanceKm);
    const f = body.sceneD;
    p.x = f.x + finalDir.x * d;
    p.y = f.y + finalDir.y * d;
    p.z = f.z + finalDir.z * d;
    rig.clearance = Math.max(d - rig.scale.localDistance(body.data, r + body.groundHeightKm(finalDir)), 1e-12);
    const forward = this.v.set(0, 0, -1).applyQuaternion(lookScene);
    const reach = Math.max(rig.clearance, 1e-9) * 10;
    Object.assign(rig.target, { x: p.x + forward.x * reach, y: p.y + forward.y * reach, z: p.z + forward.z * reach });
    const up = this.v.set(0, 1, 0).applyQuaternion(lookScene);
    Object.assign(rig.up, { x: up.x, y: up.y, z: up.z });

    // Velocidad respecto al suelo del ancla (km/s, en su marco), para la UI.
    const kmPos = this.v.copy(this.dir).multiplyScalar(this.distanceKm);
    if (this.hasLastKm && dt > 0) {
      const s = kmPos.distanceTo(this.lastKm) / dt;
      this.speedKmS += (s - this.speedKmS) * (1 - Math.exp(-dt * 4));
    }
    this.lastKm.copy(kmPos);
    this.hasLastKm = true;
  }

  /** (dirección, km) desde la posición de escena actual respecto a un cuerpo. */
  private adoptPosition(rig: CameraRig, body: CelestialBody): void {
    // La orientación se guarda en escena mientras se cambia de ancla.
    if (this.frame === 'body') this.setFrame('scene');
    this.anchor = body;
    const p = rig.position, c = body.sceneD;
    this.w.set(p.x - c.x, p.y - c.y, p.z - c.z);
    const d = this.w.length();
    if (d === 0) this.w.set(1, 0, 0);
    this.dir.copy(this.w).normalize();
    this.distanceKm = Math.max(rig.scale.inverseLocalDistance(body.data, d), body.data.radiusKm + this.minAltitude);
    this.velocity.set(0, 0, 0);
    this.hasLastKm = false;
  }

  /** Dirección de la cámara desde el centro del ancla, en escena. */
  private sceneDir(): THREE.Vector3 {
    const out = this.dirScene.copy(this.dir);
    if (this.frame === 'body') out.applyQuaternion(this.anchor.spinQuaternion);
    return out;
  }
  private readonly dirScene = new THREE.Vector3();

  /** Cambia de marco conservando la posición y la mirada en escena. */
  private setFrame(frame: Frame): void {
    if (frame === this.frame) return;
    const spin = this.q.copy(this.anchor.spinQuaternion);
    if (frame === 'scene') {
      this.dir.applyQuaternion(spin);
      this.look.premultiply(spin);
    } else {
      spin.invert();
      this.dir.applyQuaternion(spin);
      this.look.premultiply(spin);
    }
    this.frame = frame;
    this.hasLastKm = false;
  }

  /** Guiñada alrededor de la vertical del lugar (cerca del suelo) o de la cámara, y cabeceo. */
  private turn(yaw: number, pitch: number): void {
    const near = this.altitudeKm < this.anchor.data.radiusKm * LEVEL_BELOW;
    if (near) {
      // Vertical en el marco actual: la dirección desde el centro.
      this.look.premultiply(this.q.setFromAxisAngle(this.dir, yaw));
    } else {
      this.look.multiply(this.q.setFromAxisAngle(AXIS_Y, yaw));
    }
    this.look.multiply(this.q.setFromAxisAngle(AXIS_X, pitch));
    this.look.normalize();
  }

  /** Lleva el «arriba» de la cámara hacia la vertical del lugar, sin cambiar adónde mira. */
  private level(dt: number): void {
    const forward = this.v.set(0, 0, -1).applyQuaternion(this.look);
    const vertical = this.w.copy(this.dir);
    const desired = vertical.addScaledVector(forward, -vertical.dot(forward));
    if (desired.lengthSq() < 1e-8) return;
    desired.normalize();
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.look);
    const angle = Math.atan2(new THREE.Vector3().crossVectors(up, desired).dot(forward), up.dot(desired));
    this.look.premultiply(this.q.setFromAxisAngle(forward, angle * (1 - Math.exp(-dt * 2.5))));
  }

  private bindInput(): void {
    const opts = { signal: this.abort.signal };
    const el = this.element;
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (MOVE_KEYS.has(k)) {
        this.keys.add(k);
        e.preventDefault();
      }
    }, opts);
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()), opts);
    window.addEventListener('blur', () => this.keys.clear(), opts);
    el.addEventListener('contextmenu', (e) => e.preventDefault(), opts);
    el.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.dragDistance = 0;
      this.lastPointer = { x: e.clientX, y: e.clientY };
      el.setPointerCapture(e.pointerId);
    }, opts);
    el.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastPointer.x, dy = e.clientY - this.lastPointer.y;
      this.lastPointer = { x: e.clientX, y: e.clientY };
      this.dragDistance += Math.abs(dx) + Math.abs(dy);
      this.turn(-dx * 0.0035, -dy * 0.0035);
    }, opts);
    el.addEventListener('pointerup', (e) => {
      const wasClick = this.dragging && this.dragDistance < 5;
      this.dragging = false;
      if (wasClick) {
        const rect = el.getBoundingClientRect();
        this.onClick(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      }
    }, opts);
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.cruise = Math.min(20, Math.max(0.05, this.cruise * Math.exp(-e.deltaY * 0.002)));
    }, { ...opts, passive: false });
  }
}

const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);
