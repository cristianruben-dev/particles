/**
 * Órbita alrededor del cuerpo enfocado, con viaje cinematográfico al cambiar de foco y
 * descenso hasta el suelo. Ver docs/ARQUITECTURA.md §9.
 *
 * - El zoom trabaja sobre la **altitud sobre el suelo** (km), siempre positiva: con el
 *   terreno por debajo del radio medio (cráteres, Hellas) la distancia al centro no sirve.
 * - Cerca de la superficie la cámara pasa al marco del cuerpo (gira con él: el suelo no se
 *   desliza bajo los pies) y la mirada se inclina hacia el horizonte.
 */
import * as THREE from 'three/webgpu';
import type { CelestialBody } from '../bodies/CelestialBody';
import type { CameraRig } from './CameraRig';
import type { NavigationMode } from './NavigationMode';

/** Distancia por defecto al enfocar (en radios desde el centro). */
const DEFAULT_DISTANCE_RADII = 3.2;
/** Altitud mínima sobre el suelo en cuerpos con superficie (km) y, en el resto, en radios. */
const MIN_GROUND_KM = 0.01;
const MIN_ALTITUDE_RADII = 0.04;
/** Unas 200 UA: desde el Sol cabe todo el sistema en pantalla (también en escala real). */
const MAX_DISTANCE_KM = 3e10;
/** Duración del viaje: más largo cuanto más cambia la escala (2,4–5,5 s). */
const travelSeconds = (ratio: number) => Math.min(5.5, Math.max(2.4, 2 + 0.8 * Math.log10(Math.max(ratio, 1))));
/** Al llegar, la cámara se coloca a este ángulo (rad) del Sol: se ve el lado de día con algo de relieve. */
const ARRIVAL_SUN_ANGLE = 0.65;
const ARRIVAL_ELEVATION = 0.28;
/** Altitud (en radios) por debajo de la cual la cámara gira con el cuerpo; histéresis al subir. */
const BODY_FRAME_ENTER = 0.1;
const BODY_FRAME_EXIT = 0.15;
/** La mirada se inclina hacia el horizonte entre estas altitudes (radios, escala log). */
const TILT_START = 0.05;
const TILT_END = 3e-6;
const MAX_TILT = 1.45;
/** Aterrizaje con el botón: altitud final (en radios), mirada inclinada hacia el horizonte y duración. */
const LAND_ALTITUDE_RADII = 1.5e-3;
const LAND_PITCH = 0.85;
const landSeconds = (ratio: number) => Math.min(9, Math.max(4.5, 2.5 + 0.55 * Math.log(Math.max(ratio, 1))));

type Frame = 'scene' | 'body';

export class OrbitMode implements NavigationMode {
  readonly name = 'orbit';

  focus: CelestialBody;
  /** Ángulos alrededor del cuerpo (rad) en el marco actual (escena: y = norte de la eclíptica; cuerpo: y = su polo). */
  private azimuth = 0.6;
  private elevation = 0.25;
  private frame: Frame = 'scene';
  /** Altitud sobre el suelo (km). */
  private altitude: number;

  // Objetivos para el suavizado.
  private targetAzimuth = this.azimuth;
  private targetElevation = this.elevation;
  private targetAltitude: number;
  /** Rumbo y ajuste de inclinación de la mirada a ras de suelo (arrastre con el botón derecho). */
  private heading = 0;
  private pitch = 0;
  private targetHeading = 0;
  private targetPitch = 0;

  private transition: {
    from: CelestialBody;
    t: number;
    duration: number;
    startSceneDistance: number;
    /** Dirección (unitaria) desde el nuevo cuerpo hacia la cámara al salir. */
    startDir: Dir;
    endDir: Dir;
    /** Cuánto sube la cámara sobre el plano a mitad de viaje (rad). */
    arc: number;
    /** Intensidad del warp (0–1): más cuanto más cambia la escala. */
    warp: number;
  } | null = null;

  /**
   * Bajada o subida animada (botones de aterrizar y despegar). Al aterrizar, la cámara va en
   * el marco del cuerpo desde el principio: el lugar elegido no se desliza al girar el cuerpo.
   */
  private descent: {
    t: number;
    duration: number;
    fromAltitude: number;
    toAltitude: number;
    /** Direcciones en el marco del cuerpo; null = mantener la actual (despegue). */
    fromDir: Dir | null;
    toDir: Dir | null;
    fromPitch: number;
    toPitch: number;
  } | null = null;

  private dragging: 0 | 1 | 2 = 0;
  private dragDistance = 0;
  private lastPointer = { x: 0, y: 0 };
  /** Uno nuevo en cada `enter`: `exit` lo aborta y quita los listeners. */
  private abort = new AbortController();
  private readonly q = new THREE.Quaternion();

  constructor(
    initialFocus: CelestialBody,
    private readonly element: HTMLElement,
    /** Clic sin arrastre: coordenadas normalizadas (−1…1). */
    private readonly onClick: (ndcX: number, ndcY: number) => void,
  ) {
    this.focus = initialFocus;
    this.altitude = this.targetAltitude = initialFocus.data.radiusKm * (DEFAULT_DISTANCE_RADII - 1);
  }

  /** Altitud sobre el suelo bajo la cámara (km). */
  get altitudeKm(): number {
    return this.altitude;
  }

  get inTransition(): boolean {
    return this.transition !== null;
  }

  /** Viaje en curso: de dónde, adónde y progreso (0–1, con la curva del movimiento). */
  get travel(): { from: CelestialBody; to: CelestialBody; progress: number } | null {
    const tr = this.transition;
    return tr ? { from: tr.from, to: this.focus, progress: easeInOut(tr.t) } : null;
  }

  /** Efecto warp del viaje (0–1): sube y baja con la velocidad del movimiento. */
  get warp(): number {
    const tr = this.transition;
    if (!tr) return 0;
    // La derivada de la curva de viaje (máxima a mitad), normalizada.
    const speed = Math.sin(Math.PI * Math.min(1, Math.max(0, (tr.t - 0.08) / 0.84)));
    return tr.warp * speed * speed;
  }

  /** true mientras baja o sube con los botones. */
  get descending(): boolean {
    return this.descent !== null;
  }

  /**
   * Baja hasta el suelo con una mirada inclinada hacia el horizonte. Con lugar (latitud y
   * longitud planetocéntricas, este positivo), la cámara se desplaza hasta encima de él.
   */
  land(site?: { lat: number; lon: number }): void {
    const body = this.focus;
    if (!body.landable || this.transition) return;
    this.setFrame('body');
    const toAltitude = body.data.radiusKm * LAND_ALTITUDE_RADII;
    const fromDir = fromAngles(this.azimuth, this.elevation);
    // Marco del cuerpo: y = polo, lon = atan2(−z, x) (la de las texturas) → azimut = −lon.
    const toDir = site ? fromAngles(-site.lon * DEG, site.lat * DEG) : fromDir;
    this.descent = {
      t: 0,
      duration: landSeconds(this.altitude / toAltitude),
      fromAltitude: this.altitude,
      toAltitude,
      fromDir,
      toDir,
      fromPitch: this.pitch,
      toPitch: LAND_PITCH,
    };
    this.heading = this.targetHeading = 0;
  }

  /** Vuelve a la altitud de llegada sobre el mismo punto. */
  ascend(): void {
    if (this.transition) return;
    const toAltitude = this.focus.data.radiusKm * (DEFAULT_DISTANCE_RADII - 1);
    this.descent = {
      t: 0,
      duration: landSeconds(toAltitude / this.altitude),
      fromAltitude: this.altitude,
      toAltitude,
      fromDir: null,
      toDir: null,
      fromPitch: this.pitch,
      toPitch: 0,
    };
  }

  /**
   * Toma la cámara donde esté (al salir del vuelo libre): mismo cuerpo, misma dirección y
   * altitud. Lo que cambia es la mirada, que pasa a apuntar al cuerpo (lo suaviza el rig).
   */
  adopt(rig: CameraRig, body: CelestialBody): void {
    this.transition = null;
    this.descent = null;
    this.focus = body;
    this.setFrame('scene');
    const p = rig.position, c = body.sceneD;
    const dx = p.x - c.x, dy = p.y - c.y, dz = p.z - c.z;
    const d = Math.hypot(dx, dy, dz) || 1;
    const dir = { x: dx / d, y: dy / d, z: dz / d };
    [this.azimuth, this.elevation] = toAngles(dir);
    this.elevation = Math.max(-1.5, Math.min(1.5, this.elevation));
    this.targetAzimuth = this.azimuth;
    this.targetElevation = this.elevation;
    const km = rig.scale.inverseLocalDistance(body.data, d);
    this.altitude = this.targetAltitude = Math.max(this.minAltitude, km - body.data.radiusKm - body.groundHeightKm(dir));
    this.heading = this.targetHeading = this.pitch = this.targetPitch = 0;
    if (body.landable && this.altitude < body.data.radiusKm * BODY_FRAME_ENTER) this.setFrame('body');
  }

  private get minAltitude(): number {
    return this.focus.landable ? MIN_GROUND_KM : this.focus.data.radiusKm * MIN_ALTITUDE_RADII;
  }

  /** Coloca la cámara mirando el lado de día del cuerpo enfocado (al arrancar). */
  faceDaySide(): void {
    const s = this.focus.sceneD;
    if (Math.hypot(s.x, s.y, s.z) === 0) return;
    this.setFrame('scene');
    this.azimuth = this.targetAzimuth = Math.atan2(-s.z, -s.x) + ARRIVAL_SUN_ANGLE;
    this.elevation = this.targetElevation = ARRIVAL_ELEVATION;
  }

  focusOn(body: CelestialBody, rig: CameraRig): void {
    if (body === this.focus && !this.transition) return;
    this.descent = null;
    this.setFrame('scene');
    const p = rig.position;
    const dx = p.x - body.sceneD.x, dy = p.y - body.sceneD.y, dz = p.z - body.sceneD.z;
    const d = Math.hypot(dx, dy, dz);
    this.altitude = this.targetAltitude = body.data.radiusKm * (DEFAULT_DISTANCE_RADII - 1);
    this.heading = this.targetHeading = this.pitch = this.targetPitch = 0;
    // Cámara aún sin colocar (o justo en el centro): sin dirección de partida, no hay viaje.
    if (d > 1e-6) {
      const startDir = { x: dx / d, y: dy / d, z: dz / d };
      // Llegada por el lado de día: girada respecto al Sol (en el origen de la escena).
      let endAz = Math.atan2(dz, dx), endEl = Math.asin(startDir.y);
      const s = body.sceneD, sl = Math.hypot(s.x, s.y, s.z);
      if (sl > 0) {
        endAz = Math.atan2(-s.z, -s.x) + ARRIVAL_SUN_ANGLE;
        endEl = ARRIVAL_ELEVATION;
      }
      const ratio = d / rig.scale.localDistance(body.data, body.data.radiusKm * DEFAULT_DISTANCE_RADII);
      this.transition = {
        from: this.focus,
        t: 0,
        duration: travelSeconds(ratio),
        startSceneDistance: d,
        startDir,
        endDir: fromAngles(endAz, endEl),
        arc: 0.45 * Math.min(1, Math.log10(Math.max(ratio, 1)) / 3),
        warp: Math.min(1, Math.log10(Math.max(ratio, 1)) / 2.5),
      };
      this.azimuth = this.targetAzimuth = endAz;
      this.elevation = this.targetElevation = endEl;
    }
    this.focus = body;
  }

  enter(_rig: CameraRig): void {
    this.abort = new AbortController();
    const opts = { signal: this.abort.signal };
    const el = this.element;
    el.addEventListener('contextmenu', (e) => e.preventDefault(), opts);
    el.addEventListener('pointerdown', (e) => {
      // Izquierdo: moverse alrededor del cuerpo. Derecho (o con Mayús): mirar alrededor.
      this.dragging = e.button === 2 || e.shiftKey ? 2 : 1;
      this.dragDistance = 0;
      this.lastPointer = { x: e.clientX, y: e.clientY };
      el.setPointerCapture(e.pointerId);
    }, opts);
    el.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastPointer.x, dy = e.clientY - this.lastPointer.y;
      this.lastPointer = { x: e.clientX, y: e.clientY };
      this.dragDistance += Math.abs(dx) + Math.abs(dy);
      if (this.dragDistance > 4) this.descent = null;
      if (this.dragging === 2) {
        this.targetHeading -= dx * 0.004;
        this.targetPitch = Math.max(-1.2, Math.min(1, this.targetPitch - dy * 0.004));
        return;
      }
      // Más lento cuanto más cerca del suelo: a 10 m, unos centímetros por píxel.
      const k = 0.005 * Math.min(1, Math.max(1e-10, this.altitude / this.focus.data.radiusKm));
      this.targetAzimuth -= dx * k;
      this.targetElevation = Math.max(-1.5, Math.min(1.5, this.targetElevation + dy * k));
    }, opts);
    el.addEventListener('pointerup', (e) => {
      const wasClick = this.dragging === 1 && this.dragDistance < 5;
      this.dragging = 0;
      if (wasClick) {
        const rect = el.getBoundingClientRect();
        this.onClick(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      }
    }, opts);
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.descent = null;
      const next = this.targetAltitude * Math.exp(e.deltaY * 0.0015);
      this.targetAltitude = Math.min(MAX_DISTANCE_KM, Math.max(this.minAltitude, next));
    }, { ...opts, passive: false });
  }

  update(rig: CameraRig, dt: number): void {
    const body = this.focus;
    const r = body.data.radiusKm;
    // Bajada o subida con los botones: altitud en escala logarítmica, dirección y mirada
    // en la primera mitad (arriba, donde moverse de lado no marea).
    const ds = this.descent;
    if (ds) {
      ds.t = Math.min(1, ds.t + dt / ds.duration);
      const e = easeInOut(ds.t);
      this.altitude = this.targetAltitude = Math.exp(Math.log(ds.fromAltitude) * (1 - e) + Math.log(ds.toAltitude) * e);
      if (ds.fromDir && ds.toDir) {
        [this.azimuth, this.elevation] = toAngles(slerp(ds.fromDir, ds.toDir, easeInOut(Math.min(1, ds.t / 0.6))));
        this.targetAzimuth = this.azimuth;
        this.targetElevation = this.elevation;
      }
      this.pitch = this.targetPitch = ds.fromPitch + (ds.toPitch - ds.fromPitch) * easeInOut(Math.max(0, (ds.t - 0.3) / 0.7));
      if (ds.t >= 1) this.descent = null;
    }

    // Marco: el del cuerpo a ras de suelo, el de la escena en órbita (al aterrizar, siempre el del cuerpo).
    if (!this.transition && body.landable && !(ds?.toDir)) {
      if (this.frame === 'scene' && this.altitude < r * BODY_FRAME_ENTER) this.setFrame('body');
      else if (this.frame === 'body' && this.altitude > r * BODY_FRAME_EXIT) this.setFrame('scene');
    }

    // Suavizado exponencial independiente del framerate; la altitud en escala logarítmica.
    const k = 1 - Math.exp(-dt * 8);
    this.azimuth += (this.targetAzimuth - this.azimuth) * k;
    this.elevation += (this.targetElevation - this.elevation) * k;
    this.heading += (this.targetHeading - this.heading) * k;
    this.pitch += (this.targetPitch - this.pitch) * k;
    this.targetAltitude = Math.max(this.minAltitude, this.targetAltitude);
    this.altitude = Math.exp(Math.log(this.altitude) + (Math.log(this.targetAltitude) - Math.log(this.altitude)) * k);

    // Dirección de la cámara desde el centro, en ejes de escena.
    let azimuth = this.azimuth, elevation = this.elevation;
    let tr = this.transition;
    if (tr) {
      tr.t = Math.min(1, tr.t + dt / tr.duration);
      const e = easeInOut(tr.t);
      // La dirección gira de la de salida a la de llegada; a mitad de viaje la cámara sube
      // sobre el plano del sistema y se ven los dos cuerpos.
      const d = slerp(tr.startDir, tr.endDir, e);
      azimuth = Math.atan2(d.z, d.x);
      elevation = Math.max(-1.5, Math.min(1.5, Math.asin(Math.max(-1, Math.min(1, d.y))) + Math.sin(Math.PI * e) * tr.arc));
    }
    const dir = this.toScene(fromAngles(azimuth, elevation));

    // El suelo bajo la cámara (con su relieve) define la distancia al centro.
    const groundKm = body.groundHeightKm(dir);
    const distanceKm = r + groundKm + this.altitude;
    let sceneDistance = rig.scale.localDistance(body.data, distanceKm);
    const groundScene = rig.scale.localDistance(body.data, r + groundKm);
    const f = body.sceneD;
    let target = f;

    if (tr) {
      const e = easeInOut(tr.t);
      sceneDistance = Math.exp(Math.log(tr.startSceneDistance) * (1 - e) + Math.log(sceneDistance) * e);
      // La mirada pasa al nuevo cuerpo en el primer 40 % del viaje.
      const look = easeInOut(Math.min(1, tr.t / 0.4));
      const from = tr.from.sceneD;
      target = {
        x: from.x + (f.x - from.x) * look,
        y: from.y + (f.y - from.y) * look,
        z: from.z + (f.z - from.z) * look,
      };
      if (tr.t >= 1) this.transition = tr = null;
    }

    const p = rig.position;
    p.x = f.x + dir.x * sceneDistance;
    p.y = f.y + dir.y * sceneDistance;
    p.z = f.z + dir.z * sceneDistance;
    rig.clearance = Math.max(sceneDistance - groundScene, 1e-12);

    if (tr) {
      Object.assign(rig.target, target);
      Object.assign(rig.up, { x: 0, y: 1, z: 0 });
      return;
    }
    // A ras de suelo, la mirada se inclina hacia el horizonte (con el rumbo elegido).
    const ratio = Math.max(this.altitude / r, 1e-12);
    const t = 1 - THREE.MathUtils.smoothstep(Math.log(ratio), Math.log(TILT_END), Math.log(TILT_START));
    const tilt = Math.max(0, Math.min(1.55, t * MAX_TILT + this.pitch * Math.min(1, t * 4)));
    // Tangente hacia el "norte" del marco (más elevación), girada por el rumbo.
    const north = this.toScene(fromAngles(azimuth, elevation + 1e-3));
    const tn = sub(north, dir), along = dot(tn, dir);
    const tangent = normalize({ x: tn.x - dir.x * along, y: tn.y - dir.y * along, z: tn.z - dir.z * along });
    const side = cross(dir, tangent);
    const ch = Math.cos(this.heading * t), sh = Math.sin(this.heading * t);
    const fwd = { x: tangent.x * ch + side.x * sh, y: tangent.y * ch + side.y * sh, z: tangent.z * ch + side.z * sh };
    const ct = Math.cos(tilt), st = Math.sin(tilt);
    const view = { x: -dir.x * ct + fwd.x * st, y: -dir.y * ct + fwd.y * st, z: -dir.z * ct + fwd.z * st };
    const reach = Math.max(rig.clearance, 1e-9) * 10;
    Object.assign(rig.target, { x: p.x + view.x * reach, y: p.y + view.y * reach, z: p.z + view.z * reach });
    Object.assign(rig.up, { x: dir.x * st + fwd.x * ct, y: dir.y * st + fwd.y * ct, z: dir.z * st + fwd.z * ct });
  }

  /** Dirección del marco actual → escena. */
  private toScene(d: Dir): Dir {
    if (this.frame === 'scene') return d;
    const v = new THREE.Vector3(d.x, d.y, d.z).applyQuaternion(this.focus.spinQuaternion);
    return { x: v.x, y: v.y, z: v.z };
  }

  /** Cambia de marco conservando la posición y el objetivo del arrastre. */
  private setFrame(frame: Frame): void {
    if (frame === this.frame) return;
    const q = this.q.copy(this.focus.spinQuaternion);
    if (frame === 'scene') {
      // cuerpo → escena
      const conv = (az: number, el: number) => toAngles(new THREE.Vector3().copy(vec(fromAngles(az, el))).applyQuaternion(q));
      [this.azimuth, this.elevation] = conv(this.azimuth, this.elevation);
      [this.targetAzimuth, this.targetElevation] = conv(this.targetAzimuth, this.targetElevation);
    } else {
      q.invert();
      const conv = (az: number, el: number) => toAngles(new THREE.Vector3().copy(vec(fromAngles(az, el))).applyQuaternion(q));
      [this.azimuth, this.elevation] = conv(this.azimuth, this.elevation);
      [this.targetAzimuth, this.targetElevation] = conv(this.targetAzimuth, this.targetElevation);
    }
    this.frame = frame;
  }

  exit(_rig: CameraRig): void {
    this.abort.abort();
  }
}

const DEG = Math.PI / 180;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

interface Dir {
  x: number;
  y: number;
  z: number;
}

const fromAngles = (az: number, el: number): Dir => ({
  x: Math.cos(az) * Math.cos(el),
  y: Math.sin(el),
  z: Math.sin(az) * Math.cos(el),
});
const toAngles = (v: Dir): [number, number] => [Math.atan2(v.z, v.x), Math.asin(Math.max(-1, Math.min(1, v.y)))];
const vec = (d: Dir) => new THREE.Vector3(d.x, d.y, d.z);
const sub = (a: Dir, b: Dir): Dir => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: Dir, b: Dir) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Dir, b: Dir): Dir => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const normalize = (a: Dir): Dir => {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};

/** Interpolación esférica entre direcciones unitarias. */
function slerp(a: Dir, b: Dir, t: number): Dir {
  const d = Math.max(-1, Math.min(1, dot(a, b)));
  const omega = Math.acos(d);
  if (omega < 1e-4) return b;
  const sa = Math.sin((1 - t) * omega) / Math.sin(omega), sb = Math.sin(t * omega) / Math.sin(omega);
  return normalize({ x: a.x * sa + b.x * sb, y: a.y * sa + b.y * sb, z: a.z * sa + b.z * sb });
}
