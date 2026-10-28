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
import { eclToScene, type Vec3d } from '../astro/frames';
import { GALACTIC_CENTER_DIR, GALACTIC_CENTER_KM, GALACTIC_NORTH } from '../astro/galaxy';
import { LY_KM } from '../astro/units';
import type { CelestialBody } from '../bodies/CelestialBody';
import { HANDOFF_END_KM, HANDOFF_START_KM, logStep } from '../core/Handoff';
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
/**
 * Mirada más alta a ras de suelo (rad desde la vertical hacia abajo): ~68° sobre el horizonte,
 * para ver las constelaciones (§15.3). Arrastrar con el botón derecho llega hasta ahí.
 */
const MAX_LOOK_TILT = 2.75;
/** Tope del ajuste de inclinación: a media altura (`groundLook` < 1) hace falta más para llegar. */
const MAX_PITCH = MAX_LOOK_TILT;
/** Aterrizaje con el botón: altitud final (en radios), mirada inclinada hacia el horizonte y duración. */
const LAND_ALTITUDE_RADII = 1.5e-3;
const LAND_PITCH = 0.85;
const landSeconds = (ratio: number) => Math.min(9, Math.max(4.5, 2.5 + 0.55 * Math.log(Math.max(ratio, 1))));

/**
 * Más allá del sistema solar (§14.5), solo con el Sol enfocado: con otro cuerpo, en la
 * escala comprimida su dirección al Sol no es la real y el Sol-estrella no caería en su sitio.
 * Hasta ~320.000 años luz: la galaxia entera cabe en pantalla.
 */
const COSMIC_MAX_KM = 3e18;
/** Entre estas distancias el centro de la órbita pasa del Sol al centro galáctico. */
const PIVOT_START_KM = 2_000 * LY_KM;
const PIVOT_END_KM = 40_000 * LY_KM;
/** Y el «arriba» gira hacia el norte galáctico (el plano va ~60° inclinado sobre la eclíptica). */
const UP_START_KM = 300 * LY_KM;
const UP_END_KM = 5_000 * LY_KM;
/** Por encima, arrastrar gira alrededor del polo galáctico (histéresis al bajar). */
const GALAXY_FRAME_ENTER_KM = 3_000 * LY_KM;
const GALAXY_FRAME_EXIT_KM = 2_000 * LY_KM;

type Frame = 'scene' | 'body' | 'galaxy';

/** Marco galáctico → escena: x hacia el centro galáctico, y hacia el polo norte galáctico. */
const GALAXY_Q = (() => {
  const x = new THREE.Vector3(GALACTIC_CENTER_DIR.x, GALACTIC_CENTER_DIR.y, GALACTIC_CENTER_DIR.z);
  const y = new THREE.Vector3(GALACTIC_NORTH.x, GALACTIC_NORTH.y, GALACTIC_NORTH.z);
  const z = new THREE.Vector3().crossVectors(x, y);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
})();

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
  private readonly q2 = new THREE.Quaternion();
  /** Cámara respecto al Sol (km verdaderos, ejes de escena); no vale durante un viaje. */
  private readonly trueCamera: Vec3d = { x: 0, y: 0, z: 0 };
  private trueCameraValid = false;

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

  /** true mientras baja o sube con los botones (o con el zoom cósmico). */
  get descending(): boolean {
    return this.descent !== null;
  }

  /**
   * Cámara respecto al Sol en km verdaderos (ejes de escena), para la capa cósmica (§14.2).
   * Sale de la altitud en km, no de la posición de escena: más allá del relevo esta se queda
   * en el borde. Devuelve false durante un viaje (entonces vale la de escena).
   */
  cameraKm(out: Vec3d): boolean {
    Object.assign(out, this.trueCamera);
    return this.trueCameraValid;
  }

  /**
   * Lleva la altitud (escala logarítmica) hasta `altitudeKm` y, si se da, la dirección desde
   * el centro hasta `toDir` (unitaria, ejes de escena): el zoom hasta la galaxia y de vuelta.
   */
  zoomTo(altitudeKm: number, toDir?: Dir): void {
    if (this.transition) return;
    const toAltitude = Math.min(this.maxAltitude, Math.max(this.minAltitude, altitudeKm));
    const local = toDir ? this.fromScene(toDir) : null;
    const ratio = toAltitude / this.altitude;
    this.descent = {
      t: 0,
      duration: landSeconds(Math.max(ratio, 1 / ratio)),
      fromAltitude: this.altitude,
      toAltitude,
      fromDir: local ? fromAngles(this.azimuth, this.elevation) : null,
      toDir: local,
      fromPitch: this.pitch,
      toPitch: this.pitch,
    };
  }

  /** 0 en órbita, 1 a ras de suelo: cuánto se inclina la mirada hacia el horizonte. */
  private get groundLook(): number {
    const ratio = Math.max(this.altitude / this.focus.data.radiusKm, 1e-12);
    return 1 - THREE.MathUtils.smoothstep(Math.log(ratio), Math.log(TILT_END), Math.log(TILT_START));
  }

  /**
   * Gira la vista hacia una dirección del cielo (unitaria, ejes de escena) sin cambiar la
   * altitud (§15.3). En órbita, la cámara rodea el cuerpo, que sigue en el centro, hasta dejar
   * esa dirección a su lado y dentro de la pantalla; a ras de suelo gira la mirada.
   * @param fovDeg campo de visión vertical; `aspect`, ancho / alto.
   * @returns 'below' si a ras de suelo queda bajo el horizonte; 'busy' durante un viaje.
   */
  lookToward(target: Dir, fovDeg: number, aspect: number): 'ok' | 'below' | 'busy' {
    if (this.transition) return 'busy';
    this.descent = null;
    const dir = this.toScene(fromAngles(this.azimuth, this.elevation));
    const t = this.groundLook;
    if (this.frame === 'body' && t > 0.05) {
      // Rumbo e inclinación de la mirada, con la misma base que `update`.
      const height = dot(target, dir);
      if (height < Math.sin(-DEG)) return 'below';
      const tangent = tangentTo(dir, sub(this.toScene(fromAngles(this.azimuth, this.elevation + 1e-3)), dir));
      const side = cross(dir, tangent);
      // El giro que se ve es rumbo × t: el camino corto se busca en ese ángulo.
      const angle = Math.atan2(dot(target, side), dot(target, tangent));
      const current = this.heading * t;
      this.targetHeading = (current + Math.atan2(Math.sin(angle - current), Math.cos(angle - current))) / t;
      const tilt = Math.PI / 2 + Math.asin(Math.min(1, height));
      this.targetPitch = Math.max(-1.2, Math.min(MAX_PITCH, (tilt - t * MAX_TILT) / Math.min(1, t * 4)));
      return 'ok';
    }
    // En órbita la mirada es −dir: la dirección queda a un ángulo α del centro, hacia donde
    // se mira ahora (el giro más corto), fuera del disco del cuerpo y dentro de la pantalla.
    const view = { x: -dir.x, y: -dir.y, z: -dir.z };
    let side = tangentTo(target, view);
    if (!Number.isFinite(side.x) || Math.abs(dot(target, view)) > 0.9999) side = tangentTo(target, { x: 0, y: 1, z: 0 });
    const r = this.focus.data.radiusKm;
    const disc = Math.asin(Math.min(1, r / (r + this.altitude)));
    // Medio campo de visión en la dirección de `side` en pantalla (arriba ≈ el norte de la eclíptica).
    const tanV = Math.tan((fovDeg * DEG) / 2), tanH = tanV * aspect;
    const vertical = Math.abs(dot(side, tangentTo(target, { x: 0, y: 1, z: 0 })));
    const halfFov = Math.atan(Math.min(tanV / Math.max(vertical, 1e-6), tanH / Math.max(Math.sqrt(1 - vertical * vertical), 1e-6)));
    const alpha = Math.max(0, Math.min(disc + 12 * DEG, halfFov - 7 * DEG));
    const ca = Math.cos(alpha), sa = Math.sin(alpha);
    const look = normalize({ x: target.x * ca + side.x * sa, y: target.y * ca + side.y * sa, z: target.z * ca + side.z * sa });
    const toDir = { x: -look.x, y: -look.y, z: -look.z };
    // Como `zoomTo` con la misma altitud, pero con la duración según el giro.
    const turn = Math.acos(Math.max(-1, Math.min(1, dot(dir, toDir))));
    this.descent = {
      t: 0,
      duration: 2.2 + (1.6 * turn) / Math.PI,
      fromAltitude: this.altitude,
      toAltitude: this.altitude,
      fromDir: fromAngles(this.azimuth, this.elevation),
      toDir: this.fromScene(toDir),
      fromPitch: this.pitch,
      toPitch: this.pitch,
    };
    return 'ok';
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

  private get maxAltitude(): number {
    return this.focus.parent === null ? COSMIC_MAX_KM : MAX_DISTANCE_KM;
  }

  /** Coloca la cámara mirando el lado de día del cuerpo enfocado (al arrancar). */
  faceDaySide(): void {
    const s = this.focus.sceneD;
    if (Math.hypot(s.x, s.y, s.z) === 0) return;
    this.setFrame('scene');
    this.azimuth = this.targetAzimuth = Math.atan2(-s.z, -s.x) + ARRIVAL_SUN_ANGLE;
    this.elevation = this.targetElevation = ARRIVAL_ELEVATION;
  }

  /**
   * Viaja a un cuerpo. `arrival` (unitaria, ejes de escena) fija desde dónde se le mira al
   * llegar, en vez del lado de día (los eclipses: hacia la sombra). Con el mismo cuerpo y una
   * llegada, solo gira la cámara hasta allí.
   */
  focusOn(body: CelestialBody, rig: CameraRig, arrival?: Dir, distanceRadii?: number): void {
    if (body === this.focus && !this.transition && !arrival) return;
    this.descent = null;
    this.setFrame('scene');
    const p = rig.position;
    const dx = p.x - body.sceneD.x, dy = p.y - body.sceneD.y, dz = p.z - body.sceneD.z;
    const d = Math.hypot(dx, dy, dz);
    const viewRadii = distanceRadii ?? body.data.viewRadii ?? DEFAULT_DISTANCE_RADII;
    this.altitude = this.targetAltitude = body.data.radiusKm * (viewRadii - 1);
    this.heading = this.targetHeading = this.pitch = this.targetPitch = 0;
    // Cámara aún sin colocar (o justo en el centro): sin dirección de partida, no hay viaje.
    if (d > 1e-6) {
      const startDir = { x: dx / d, y: dy / d, z: dz / d };
      // Llegada por el lado de día: girada respecto al Sol (en el origen de la escena).
      let endAz = Math.atan2(dz, dx), endEl = Math.asin(startDir.y);
      const s = body.sceneD, sl = Math.hypot(s.x, s.y, s.z);
      if (arrival) [endAz, endEl] = toAngles(arrival);
      else if (sl > 0) {
        endAz = Math.atan2(-s.z, -s.x) + ARRIVAL_SUN_ANGLE;
        endEl = ARRIVAL_ELEVATION;
      }
      const ratio = d / rig.scale.localDistance(body.data, body.data.radiusKm * viewRadii);
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
        this.targetPitch = Math.max(-1.2, Math.min(MAX_PITCH, this.targetPitch - dy * 0.004));
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
      // Fuera del sistema solar, el triple de rápido: hay 8 órdenes de magnitud hasta la galaxia.
      const rate = 1 + 2 * logStep(this.targetAltitude, HANDOFF_START_KM, 1e17);
      const next = this.targetAltitude * Math.exp(e.deltaY * 0.0015 * rate);
      this.targetAltitude = Math.min(this.maxAltitude, Math.max(this.minAltitude, next));
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
    // Lejos del Sol, el marco galáctico (no a mitad de una animación: sus direcciones van en el marco de partida).
    if (!this.transition && !ds && !body.parent) {
      if (this.frame === 'scene' && r + this.altitude > GALAXY_FRAME_ENTER_KM) this.setFrame('galaxy');
      else if (this.frame === 'galaxy' && r + this.altitude < GALAXY_FRAME_EXIT_KM) this.setFrame('scene');
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
    // Más allá del relevo la escena solar ya no se dibuja: su cámara se queda en el borde (§14.4).
    let sceneDistance = rig.scale.localDistance(body.data, Math.min(distanceKm, HANDOFF_END_KM));

    // Cámara verdadera para la capa cósmica. Con el Sol enfocado y muy lejos, el centro de la
    // órbita pasa al centro galáctico: la mirada sigue siendo −dir, solo se desplaza la cámara.
    this.trueCameraValid = !tr;
    const pivot = body.parent ? 0 : logStep(distanceKm, PIVOT_START_KM, PIVOT_END_KM);
    const bodyKm = eclToScene(body.positionKm);
    this.trueCamera.x = bodyKm.x + GALACTIC_CENTER_KM.x * pivot + dir.x * distanceKm;
    this.trueCamera.y = bodyKm.y + GALACTIC_CENTER_KM.y * pivot + dir.y * distanceKm;
    this.trueCamera.z = bodyKm.z + GALACTIC_CENTER_KM.z * pivot + dir.z * distanceKm;
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
    const t = this.groundLook;
    const tilt = Math.max(0, Math.min(MAX_LOOK_TILT, t * MAX_TILT + this.pitch * Math.min(1, t * 4)));
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
    // Lejos del Sol, el «arriba» gira hacia el norte galáctico. Se calcula aparte del marco del
    // arrastre: al pasar al marco galáctico la imagen no da un giro de golpe.
    const w = body.parent ? 0 : logStep(distanceKm, UP_START_KM, UP_END_KM);
    if (w > 0) Object.assign(rig.up, rotateTowards(tangentTo(dir, { x: 0, y: 1, z: 0 }), tangentTo(dir, GALACTIC_NORTH), dir, w));
  }

  /** Orientación del marco → escena. */
  private frameQuaternion(frame: Frame, out: THREE.Quaternion): THREE.Quaternion {
    if (frame === 'body') return out.copy(this.focus.spinQuaternion);
    if (frame === 'galaxy') return out.copy(GALAXY_Q);
    return out.identity();
  }

  /** Dirección del marco actual → escena. */
  private toScene(d: Dir): Dir {
    if (this.frame === 'scene') return d;
    const v = vec(d).applyQuaternion(this.frameQuaternion(this.frame, this.q2));
    return { x: v.x, y: v.y, z: v.z };
  }

  /** Dirección de escena → marco actual. */
  private fromScene(d: Dir): Dir {
    if (this.frame === 'scene') return d;
    const v = vec(d).applyQuaternion(this.frameQuaternion(this.frame, this.q2).invert());
    return { x: v.x, y: v.y, z: v.z };
  }

  /** Cambia de marco conservando la posición y el objetivo del arrastre. */
  private setFrame(frame: Frame): void {
    if (frame === this.frame) return;
    // marco actual → escena → marco nuevo
    const q = this.frameQuaternion(frame, this.q).invert().multiply(this.frameQuaternion(this.frame, this.q2));
    const conv = (az: number, el: number) => toAngles(vec(fromAngles(az, el)).applyQuaternion(q));
    [this.azimuth, this.elevation] = conv(this.azimuth, this.elevation);
    [this.targetAzimuth, this.targetElevation] = conv(this.targetAzimuth, this.targetElevation);
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

/** Componente de `v` perpendicular a `dir` (unitaria): hacia dónde queda `v` en pantalla. */
function tangentTo(dir: Dir, v: Dir): Dir {
  const k = dot(v, dir);
  return normalize({ x: v.x - dir.x * k, y: v.y - dir.y * k, z: v.z - dir.z * k });
}

/** Gira `a` alrededor de `axis` (perpendicular a los dos) una fracción `t` del ángulo hasta `b`. */
function rotateTowards(a: Dir, b: Dir, axis: Dir, t: number): Dir {
  const angle = Math.atan2(dot(axis, cross(a, b)), dot(a, b)) * t;
  const c = Math.cos(angle), s = Math.sin(angle), ax = cross(axis, a);
  return { x: a.x * c + ax.x * s, y: a.y * c + ax.y * s, z: a.z * c + ax.z * s };
}

/** Interpolación esférica entre direcciones unitarias. */
function slerp(a: Dir, b: Dir, t: number): Dir {
  const d = Math.max(-1, Math.min(1, dot(a, b)));
  const omega = Math.acos(d);
  if (omega < 1e-4) return b;
  const sa = Math.sin((1 - t) * omega) / Math.sin(omega), sb = Math.sin(t * omega) / Math.sin(omega);
  return normalize({ x: a.x * sa + b.x * sb, y: a.y * sa + b.y * sb, z: a.z * sa + b.z * sb });
}
