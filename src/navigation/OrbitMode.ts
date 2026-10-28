/**
 * Órbita alrededor del cuerpo enfocado, con viaje cinematográfico al cambiar de foco.
 * Ver docs/ARQUITECTURA.md §9.
 */
import type { CelestialBody } from '../bodies/CelestialBody';
import type { CameraRig } from './CameraRig';
import type { NavigationMode } from './NavigationMode';

/** Distancia por defecto al enfocar (en radios desde el centro). */
const DEFAULT_DISTANCE_RADII = 3.2;
/** Altitud mínima (relativa al radio). TODO(fase 3): bajar hasta la superficie. */
const MIN_ALTITUDE_RADII = 0.04;
/** Unas 200 UA: desde el Sol cabe todo el sistema en pantalla (también en escala real). */
const MAX_DISTANCE_KM = 3e10;
/** Duración del viaje: más largo cuanto más cambia la escala (2,4–5,5 s). */
const travelSeconds = (ratio: number) => Math.min(5.5, Math.max(2.4, 2 + 0.8 * Math.log10(Math.max(ratio, 1))));
/** Al llegar, la cámara se coloca a este ángulo (rad) del Sol: se ve el lado de día con algo de relieve. */
const ARRIVAL_SUN_ANGLE = 0.65;
const ARRIVAL_ELEVATION = 0.28;

export class OrbitMode implements NavigationMode {
  readonly name = 'orbit';

  focus: CelestialBody;
  /** Ángulos alrededor del cuerpo (rad), en ejes de escena (y = norte de la eclíptica). */
  private azimuth = 0.6;
  private elevation = 0.25;
  /** Distancia al centro del cuerpo (km verdaderos). */
  private distanceKm: number;

  // Objetivos para el suavizado.
  private targetAzimuth = this.azimuth;
  private targetElevation = this.elevation;
  private targetDistanceKm: number;

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
  } | null = null;

  private dragging = false;
  private dragDistance = 0;
  private lastPointer = { x: 0, y: 0 };
  private readonly abort = new AbortController();

  constructor(
    initialFocus: CelestialBody,
    private readonly element: HTMLElement,
    /** Clic sin arrastre: coordenadas normalizadas (−1…1). */
    private readonly onClick: (ndcX: number, ndcY: number) => void,
  ) {
    this.focus = initialFocus;
    this.distanceKm = this.targetDistanceKm = initialFocus.data.radiusKm * DEFAULT_DISTANCE_RADII;
  }

  /** Altitud sobre la superficie del cuerpo enfocado (km). */
  get altitudeKm(): number {
    return this.distanceKm - this.focus.data.radiusKm;
  }

  get inTransition(): boolean {
    return this.transition !== null;
  }

  /** Coloca la cámara mirando el lado de día del cuerpo enfocado (al arrancar). */
  faceDaySide(): void {
    const s = this.focus.sceneD;
    if (Math.hypot(s.x, s.y, s.z) === 0) return;
    this.azimuth = this.targetAzimuth = Math.atan2(-s.z, -s.x) + ARRIVAL_SUN_ANGLE;
    this.elevation = this.targetElevation = ARRIVAL_ELEVATION;
  }

  focusOn(body: CelestialBody, rig: CameraRig): void {
    if (body === this.focus && !this.transition) return;
    const p = rig.position;
    const dx = p.x - body.sceneD.x, dy = p.y - body.sceneD.y, dz = p.z - body.sceneD.z;
    const d = Math.hypot(dx, dy, dz);
    this.distanceKm = this.targetDistanceKm = body.data.radiusKm * DEFAULT_DISTANCE_RADII;
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
      const ratio = d / rig.scale.localDistance(body.data, this.distanceKm);
      this.transition = {
        from: this.focus,
        t: 0,
        duration: travelSeconds(ratio),
        startSceneDistance: d,
        startDir,
        endDir: fromAngles(endAz, endEl),
        arc: 0.45 * Math.min(1, Math.log10(Math.max(ratio, 1)) / 3),
      };
      this.azimuth = this.targetAzimuth = endAz;
      this.elevation = this.targetElevation = endEl;
    }
    this.focus = body;
  }

  enter(_rig: CameraRig): void {
    const opts = { signal: this.abort.signal };
    const el = this.element;
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
      // Más lento cerca de la superficie.
      const k = 0.005 * Math.min(1, Math.max(0.03, this.altitudeKm / this.focus.data.radiusKm));
      this.targetAzimuth -= dx * k;
      this.targetElevation = Math.max(-1.5, Math.min(1.5, this.targetElevation + dy * k));
    }, opts);
    el.addEventListener('pointerup', (e) => {
      this.dragging = false;
      if (this.dragDistance < 5) {
        const rect = el.getBoundingClientRect();
        this.onClick(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      }
    }, opts);
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = this.focus.data.radiusKm;
      const altitude = Math.max(this.targetDistanceKm - r, r * MIN_ALTITUDE_RADII);
      const next = altitude * Math.exp(e.deltaY * 0.0015);
      this.targetDistanceKm = r + Math.min(MAX_DISTANCE_KM, Math.max(r * MIN_ALTITUDE_RADII, next));
    }, { ...opts, passive: false });
  }

  update(rig: CameraRig, dt: number): void {
    // Suavizado exponencial independiente del framerate; la distancia en escala logarítmica.
    const k = 1 - Math.exp(-dt * 8);
    this.azimuth += (this.targetAzimuth - this.azimuth) * k;
    this.elevation += (this.targetElevation - this.elevation) * k;
    const r = this.focus.data.radiusKm;
    const alt = Math.exp(Math.log(this.distanceKm - r) + (Math.log(this.targetDistanceKm - r) - Math.log(this.distanceKm - r)) * k);
    this.distanceKm = r + alt;

    let sceneDistance = rig.scale.localDistance(this.focus.data, this.distanceKm);
    const f = this.focus.sceneD;
    let target = f;

    let azimuth = this.azimuth, elevation = this.elevation;
    if (this.transition) {
      const tr = this.transition;
      tr.t = Math.min(1, tr.t + dt / tr.duration);
      const e = easeInOut(tr.t);
      sceneDistance = Math.exp(Math.log(tr.startSceneDistance) * (1 - e) + Math.log(sceneDistance) * e);
      // La dirección gira de la de salida a la de llegada; a mitad de viaje la cámara sube
      // sobre el plano del sistema y se ven los dos cuerpos.
      const dir = slerp(tr.startDir, tr.endDir, e);
      azimuth = Math.atan2(dir.z, dir.x);
      elevation = Math.max(-1.5, Math.min(1.5, Math.asin(Math.max(-1, Math.min(1, dir.y))) + Math.sin(Math.PI * e) * tr.arc));
      // La mirada gira hacia el nuevo cuerpo en el primer 40 % del viaje.
      const look = easeInOut(Math.min(1, tr.t / 0.4));
      const from = tr.from.sceneD;
      target = {
        x: from.x + (f.x - from.x) * look,
        y: from.y + (f.y - from.y) * look,
        z: from.z + (f.z - from.z) * look,
      };
      if (tr.t >= 1) this.transition = null;
    }

    const ce = Math.cos(elevation);
    const p = rig.position;
    p.x = f.x + Math.cos(azimuth) * ce * sceneDistance;
    p.y = f.y + Math.sin(elevation) * sceneDistance;
    p.z = f.z + Math.sin(azimuth) * ce * sceneDistance;
    Object.assign(rig.target, target);
    rig.clearance = Math.max(sceneDistance - this.focus.sceneRadius, 1e-6);
  }

  exit(_rig: CameraRig): void {
    this.abort.abort();
  }
}

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

/** Interpolación esférica entre direcciones unitarias. */
function slerp(a: Dir, b: Dir, t: number): Dir {
  const dot = Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z));
  const omega = Math.acos(dot);
  if (omega < 1e-4) return b;
  const sa = Math.sin((1 - t) * omega) / Math.sin(omega), sb = Math.sin(t * omega) / Math.sin(omega);
  const x = a.x * sa + b.x * sb, y = a.y * sa + b.y * sb, z = a.z * sa + b.z * sb;
  const l = Math.hypot(x, y, z) || 1;
  return { x: x / l, y: y / l, z: z / l };
}
