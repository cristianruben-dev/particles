/**
 * Órbita alrededor del cuerpo enfocado, con transición animada al cambiar de foco.
 * Ver docs/ARQUITECTURA.md §9.
 */
import type { CelestialBody } from '../bodies/CelestialBody';
import type { CameraRig } from './CameraRig';
import type { NavigationMode } from './NavigationMode';

/** Distancia por defecto al enfocar (en radios desde el centro). */
const DEFAULT_DISTANCE_RADII = 3.2;
/** Altitud mínima (relativa al radio). TODO(fase 3): bajar hasta la superficie. */
const MIN_ALTITUDE_RADII = 0.04;
const MAX_DISTANCE_KM = 6e9;
const TRANSITION_SECONDS = 2.6;

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

  private transition: { from: CelestialBody; t: number; startSceneDistance: number } | null = null;

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

  focusOn(body: CelestialBody, rig: CameraRig): void {
    if (body === this.focus && !this.transition) return;
    // Volar en línea recta desde donde está la cámara hacia el nuevo cuerpo.
    const p = rig.position;
    const dx = p.x - body.sceneD.x, dy = p.y - body.sceneD.y, dz = p.z - body.sceneD.z;
    const d = Math.hypot(dx, dy, dz);
    this.distanceKm = this.targetDistanceKm = body.data.radiusKm * DEFAULT_DISTANCE_RADII;
    // Cámara aún sin colocar (o justo en el centro): sin dirección de partida, no hay viaje.
    if (d > 1e-6) {
      this.azimuth = this.targetAzimuth = Math.atan2(dz, dx);
      this.elevation = this.targetElevation = Math.asin(dy / d);
      this.transition = { from: this.focus, t: 0, startSceneDistance: d };
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

    let sceneDistance = rig.scale.localDistance(r, this.distanceKm);
    const f = this.focus.sceneD;
    let target = f;

    if (this.transition) {
      const tr = this.transition;
      tr.t = Math.min(1, tr.t + dt / TRANSITION_SECONDS);
      const e = easeInOut(tr.t);
      sceneDistance = Math.exp(Math.log(tr.startSceneDistance) * (1 - e) + Math.log(sceneDistance) * e);
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

    const ce = Math.cos(this.elevation);
    const p = rig.position;
    p.x = f.x + Math.cos(this.azimuth) * ce * sceneDistance;
    p.y = f.y + Math.sin(this.elevation) * sceneDistance;
    p.z = f.z + Math.sin(this.azimuth) * ce * sceneDistance;
    Object.assign(rig.target, target);
    rig.clearance = Math.max(sceneDistance - this.focus.sceneRadius, 1e-6);
  }

  exit(_rig: CameraRig): void {
    this.abort.abort();
  }
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
