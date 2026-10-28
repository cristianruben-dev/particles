/**
 * Bucle principal y orquestación de módulos. Ver docs/ARQUITECTURA.md §3.
 */
import * as THREE from 'three/webgpu';
import { BODIES, COMET_IDS, type BodyId } from '../astro/bodies';
import { cometElementsAt, cometPosition, cometVelocity, perihelionNear, type CometId } from '../astro/comets';
import type { ShadowEvent } from '../astro/eclipses';
import { findShadowEvents } from '../astro/eclipses';
import { FACTS, type LandingSite } from '../astro/facts';
import { refreshIssTle } from '../astro/iss';
import { eclToScene, vec3d } from '../astro/frames';
import { GALAXIES, GALAXY_IDS, galaxyBasis, galaxyCenterKm, type GalaxyId } from '../astro/galaxies';
import { GALACTIC_CENTER_DIR, GALACTIC_CENTER_KM, GALACTIC_NORTH } from '../astro/galaxy';
import { AU_KM, LY_KM } from '../astro/units';
import { Soundscape } from '../audio/Soundscape';
import { AsteroidBelt } from '../bodies/AsteroidBelt';
import type { CelestialBody, FrameContext } from '../bodies/CelestialBody';
import { createBody } from '../bodies/createBody';
import { OrbitLines } from '../bodies/OrbitLines';
import { createStarfield, starLook } from '../bodies/Starfield';
import { config } from '../config';
import { CosmicLayer, cosmicLook } from '../cosmos/CosmicLayer';
import { CameraRig } from '../navigation/CameraRig';
import { FreeFlyMode } from '../navigation/FreeFlyMode';
import { OrbitMode, type CosmicDestination } from '../navigation/OrbitMode';
import { pickBody } from '../navigation/picking';
import { disturbanceLook } from '../particles/Disturbance';
import { particleLook } from '../particles/LodManager';
import { pixelAngle, updatePixelAngle } from '../particles/nodes';
import type { ParticleField } from '../particles/ParticleField';
import { createPipeline, warpLook, type BloomControls } from '../postfx/Pipeline';
import { ScaleSystem } from '../scale/ScaleSystem';
import { surfaceBudget } from '../surface/Surface';
import { createDebugGui } from '../ui/DebugGui';
import type { PerihelionEvent } from '../ui/EventsPanel';
import { Hud } from '../ui/Hud';
import { Labels, MarkerLabels, type Marker } from '../ui/Labels';
import { FloatingOrigin } from './FloatingOrigin';
import { HANDOFF_START_KM, STARS_FADE_END_KM, STARS_FADE_START_KM, handoff, logStep, solarPresence } from './Handoff';
import { horizon, horizonBackground } from './Horizon';
import { FrameStats, Quality, detectDevice, type QualityProfile } from './Quality';
import { createRenderer } from './Renderer';
import { SimClock } from './SimClock';
import { layoutSystem } from './SystemLayout';

const formatHours = (h: number) => (h >= 48 ? `${Math.round(h / 24)} días` : `${Math.round(h)} h`);

/** Por debajo de esta altitud (radios) la acción principal es volver a la órbita. */
const NEAR_GROUND_RADII = 0.05;

const BASE_FOV = 50;
const REDUCED_MOTION = matchMedia('(prefers-reduced-motion: reduce)');

/** Teclas del vuelo libre (las gestiona `FreeFlyMode`). */
const FLY_KEYS = new Set(['w', 'a', 's', 'd', 'q', 'e', 'r', 'f', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']);

/** Teclas 0–9: el Sol y los planetas. */
const KEY_BODIES: BodyId[] = ['sun', 'mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'];

/**
 * Zoom cósmico (§14.5): la Vía Láctea entera desde ~130.000 años luz, por encima del disco
 * y del lado del Sol (así queda debajo del centro, como en los mapas)…
 */
const GALAXY_VIEW_KM = 1.2e18;
const GALAXY_VIEW_DIR = (() => {
  const c = GALACTIC_CENTER_DIR, n = GALACTIC_NORTH, a = Math.cos(1.2), b = Math.sin(1.2);
  return { x: -c.x * a + n.x * b, y: -c.y * a + n.y * b, z: -c.z * a + n.z * b };
})();
/** …y de vuelta, el sistema solar entero antes de viajar a un cuerpo. */
const SOLAR_RETURN_KM = 600 * AU_KM;

/** Nombres de las galaxias por importancia: las grandes antes que sus satélites. */
const MARKER_ORDER = GALAXY_IDS.filter((id) => id !== 'milkyway').sort((a, b) => Number(!!GALAXIES[a].parent) - Number(!!GALAXIES[b].parent));

export class Engine {
  readonly scene = new THREE.Scene();
  readonly clock = new SimClock();
  readonly scale = new ScaleSystem();
  readonly origin = new FloatingOrigin();
  readonly rig = new CameraRig(window.innerWidth / window.innerHeight, this.origin, this.scale);
  /** Cada padre antes que sus hijos (lo exige `layoutSystem`). */
  readonly bodies: CelestialBody[] = [];

  quality!: Quality;
  readonly stats = new FrameStats();

  private renderer!: THREE.WebGPURenderer;
  private pipeline!: THREE.RenderPipeline;
  private bloom!: BloomControls;
  private isWebGLFallback = false;
  private orbit!: OrbitMode;
  private fly!: FreeFlyMode;
  private flying = false;
  /** «Aterrizar» pulsado durante el viaje: se ejecuta al llegar (en `pendingSite`, si lo hay). */
  private pendingLand = false;
  private pendingSite: LandingSite | null = null;
  /** Desde fuera del sistema solar se vuelve al borde antes de viajar (si no, la cámara saltaría). */
  private pendingFocus: (() => void) | null = null;
  /** «Vía Láctea» pulsado lejos del Sol: primero el viaje al Sol. */
  private pendingGalaxy = false;
  /** Una galaxia elegida desde un planeta: primero el viaje al Sol. */
  private pendingGalaxyId: GalaxyId | null = null;
  /** Capa cósmica (§14) y la cámara respecto al Sol en km verdaderos. */
  readonly cosmic = new CosmicLayer(this.scale);
  private readonly galaxyCenters = Object.fromEntries(GALAXY_IDS.map((id) => [id, galaxyCenterKm(GALAXIES[id])])) as Record<GalaxyId, { x: number; y: number; z: number }>;
  private readonly cameraKm = vec3d();
  private cameraSunKm = 0;
  /** Presencia del sistema solar en el relevo (1 → 0). */
  private solar = 1;
  private solarHidden = false;
  private hud!: Hud;
  private labels!: Labels;
  private markers!: MarkerLabels;
  private orbits!: OrbitLines;
  private readonly belts: AsteroidBelt[] = [];
  private stars: ParticleField | null = null;
  private resolveStars!: () => void;
  /** Se resuelve con las estrellas ya en la escena (o si no se pudieron cargar). */
  readonly starsReady = new Promise<void>((resolve) => (this.resolveStars = resolve));
  private lastFrameMs = performance.now();
  /** Cursor sobre el canvas en coordenadas normalizadas, o null si está fuera. */
  private pointerNdc: THREE.Vector2 | null = null;
  private readonly pointerRaycaster = new THREE.Raycaster();
  /** Sonido ambiente (§13): activado salvo que se apagara en otra visita. */
  private sound!: Soundscape;

  /**
   * @param progress Avance de la carga (0–1) y qué se está haciendo, para la pantalla de carga.
   */
  async start(canvas: HTMLCanvasElement, hudEl: HTMLElement, progress: (p: number, text: string) => void = () => undefined): Promise<void> {
    this.quality = new Quality(await detectDevice());
    progress(0.08, 'Preparando el motor gráfico…');
    const profile = this.quality.profile;
    this.applyLook(profile);
    ({ renderer: this.renderer, isWebGLFallback: this.isWebGLFallback } = await createRenderer(canvas, profile.msaa, profile.pixelRatio));
    ({ pipeline: this.pipeline, bloom: this.bloom } = createPipeline(this.renderer, this.scene, this.rig.camera));
    this.bloom.setResolutionScale(profile.bloomScale);
    this.quality.onChange((p) => this.applyQuality(p));
    progress(0.16, 'Horneando los planetas…');

    this.scene.backgroundNode = horizonBackground();
    this.createBodies();
    // TLE de la ISS del día, si hay red (sin bloquear: mientras, el incluido).
    void refreshIssTle();
    const earth = this.byId('earth') ?? this.bodies[0];
    // Primer frame: posiciones calculadas antes de colocar la cámara.
    layoutSystem(this.bodies, this.clock.timeMs, this.scale);

    // Fuera del sistema solar los cuerpos ya no se ven: el clic no los elige (§14.4).
    const pick = (x: number, y: number) => {
      const hit = this.solar >= 0.5 ? pickBody(x, y, this.rig.camera, this.bodies, canvas.clientHeight) : null;
      if (hit) this.focus(hit);
    };
    this.orbit = new OrbitMode(earth, canvas, pick);
    this.orbit.faceDaySide();
    this.rig.setMode(this.orbit);
    this.fly = new FreeFlyMode(earth, this.bodies, canvas, pick, (body) => this.setReference(body));
    this.scene.add(this.cosmic.group);

    const mouseStrength = disturbanceLook.strength.value;
    this.hud = new Hud(hudEl, {
      bodies: this.bodies.map((b) => {
        const key = KEY_BODIES.indexOf(b.data.id);
        return {
          id: b.data.id,
          name: b.data.name,
          parent: b.parent?.parent ? b.parent.data.id : null,
          key: key >= 0 ? String(key) : undefined,
          color: b.data.color,
          radiusKm: b.data.radiusKm,
          rings: b.data.id === 'saturn',
          comet: b.data.kind === 'comet',
        };
      }),
      quality: this.quality,
      toggles: [
        { id: 'meter', label: 'Medidor de rendimiento', get: () => !hudEl.classList.contains('no-perf'), set: (on) => this.setPref('meter', on, () => hudEl.classList.toggle('no-perf', !on)) },
        { id: 'mouse', label: 'Las partículas reaccionan al ratón', get: () => disturbanceLook.strength.value > 0, set: (on) => this.setPref('mouse', on, () => (disturbanceLook.strength.value = on ? mouseStrength : 0)) },
        { id: 'labels', label: 'Nombres de los cuerpos', key: 'L', get: () => this.labels.visible, set: (on) => (this.labels.visible = on) },
        { id: 'orbits', label: 'Órbitas', key: 'O', get: () => this.orbits.visible, set: (on) => (this.orbits.visible = on) },
        { id: 'sound', label: 'Sonido ambiente', key: 'M', get: () => this.sound.enabled, set: (on) => this.setSound(on) },
      ],
      onSelectBody: (id) => this.focus(this.byId(id)!),
      onSelectGalaxy: (id) => this.focusGalaxy(id),
      onSolarSystem: () => this.leaveCosmos(() => undefined),
      events: {
        shadows: (group, from, direction) => findShadowEvents(group, from, direction, group === 'jupiter' ? 6 : 4),
        perihelia: (from, direction) => this.perihelia(from, direction),
        onGo: (e, ground) => this.goToEvent(e, ground),
        onGoComet: (e) => this.goToPerihelion(e),
      },
      onSlower: () => this.clock.slower(),
      onFaster: () => this.clock.faster(),
      onSetRate: (i) => {
        this.clock.rateIndex = i;
        this.clock.paused = false;
      },
      onTogglePause: () => (this.clock.paused = !this.clock.paused),
      onNow: () => (this.clock.timeMs = Date.now()),
      onSetDate: (ms) => (this.clock.timeMs = ms),
      onSetScale: (mode) => this.scale.setMode(mode),
      onToggleOrbits: () => (this.orbits.visible = !this.orbits.visible),
      onToggleLabels: () => (this.labels.visible = !this.labels.visible),
      onToggleFly: () => this.toggleFly(),
      onToggleSound: () => this.setSound(!this.sound.enabled, true),
      onLand: () => this.land(),
      onAscend: () => this.orbit.ascend(),
      onInfo: () => undefined,
    });
    // Preferencias guardadas de la interfaz.
    if (this.getPref('meter') === false) hudEl.classList.add('no-perf');
    this.sound = new Soundscape(this.getPref('sound') !== false);
    // El navegador solo deja sonar tras un gesto: el primero que llegue lo arranca.
    const unlock = () => this.sound.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    if (this.getPref('mouse') === false) disturbanceLook.strength.value = 0;
    this.quality.onChange((p, reason) => {
      if (reason === 'auto') this.hud.toasts.show(`Calidad ajustada a ${p.name} para ir más fluido`, 'settings', 4.5);
    });
    this.labels = new Labels(hudEl, this.bodies, (body) => this.focus(body));
    this.markers = new MarkerLabels(hudEl);
    this.hud.setActiveBody(earth.data.id, earth.landable);
    earth.setFocused(true);
    this.bindKeys();
    this.bindPointer(canvas);

    this.orbits = new OrbitLines(this.bodies, this.scale);
    this.scene.add(this.orbits.group);
    this.belts.push(
      new AsteroidBelt({ population: 'main', count: 60_000, sizePx: 1.3, color: 0xb8a48c }, this.scale),
      new AsteroidBelt({ population: 'trojans', count: 15_000, sizePx: 1.2, color: 0xa8957d }, this.scale),
      new AsteroidBelt({ population: 'kuiper', count: 30_000, sizePx: 1.2, color: 0x8fa3b8 }, this.scale),
    );
    for (const belt of this.belts) this.scene.add(belt.object);

    if (config.debug) createDebugGui({ renderer: this.renderer, bloom: this.bloom, bodies: this.bodies });

    createStarfield().then((stars) => {
      this.stars = stars;
      this.scene.add(stars.object);
    }).finally(() => this.resolveStars());

    this.onResize();
    window.addEventListener('resize', this.onResize);
    this.renderer.setAnimationLoop(this.frame);
  }

  /**
   * Desde el cosmos, todo viaje vuelve antes al sistema solar: parte de la posición de escena,
   * que más allá del relevo se queda en el borde (§14.5). Devuelve true si `then` queda para
   * cuando acabe el zoom de vuelta (entero: también lo que deja pendiente, como aterrizar).
   */
  private leaveCosmos(then: () => void): boolean {
    this.pendingGalaxy = false;
    this.pendingGalaxyId = null;
    if (!this.inCosmos) {
      this.pendingFocus = null;
      return false;
    }
    if (this.flying) this.exitFly();
    this.pendingFocus = then;
    // Desde otra galaxia, un viaje cósmico de vuelta; desde la Vía Láctea, el zoom de `G`.
    if (this.orbit.galaxyTarget || this.orbit.cosmicTraveling) this.orbit.travelTo(this.sunReturn());
    else this.orbit.zoomTo(SOLAR_RETURN_KM);
    return true;
  }

  /** Fuera del sistema solar: en otra galaxia, de viaje entre galaxias o más allá del relevo. */
  private get inCosmos(): boolean {
    return this.orbit.galaxyTarget !== null || this.orbit.cosmicTraveling || this.cameraSunKm > HANDOFF_START_KM;
  }

  /**
   * Viaja a una galaxia (§14.5). La Vía Láctea es la vista desde fuera con el Sol enfocado
   * (la de `G`); las demás se orbitan. Desde un planeta, primero al Sol.
   */
  focusGalaxy(id: GalaxyId): void {
    if (this.flying) this.exitFly();
    this.pendingFocus = null;
    this.pendingLand = false;
    this.pendingSite = null;
    this.pendingGalaxy = false;
    this.pendingGalaxyId = null;
    const sun = this.bodies[0];
    if (this.orbit.focus !== sun || this.orbit.inTransition) {
      this.focus(sun);
      this.pendingGalaxyId = id;
      return;
    }
    void this.cosmic.load();
    this.setReference(sun);
    this.orbit.travelTo(id === 'milkyway' ? this.milkyWayView() : this.galaxyDestination(id));
    this.hud.coach.dismiss();
  }

  /** La Vía Láctea entera, como la deja `G`: la vuelta a la órbita del Sol, sin saltos. */
  private milkyWayView(): CosmicDestination {
    return { id: 'milkyway', centerKm: GALACTIC_CENTER_KM, radiusKm: 50_000 * LY_KM, normal: GALACTIC_NORTH, arrivalDir: GALAXY_VIEW_DIR, viewKm: GALAXY_VIEW_KM, mode: 'sun' };
  }

  /** De vuelta al sistema solar: a 600 UA del Sol, un poco por encima de la eclíptica. */
  private sunReturn(): CosmicDestination {
    const c = this.cameraKm, az = Math.atan2(c.z, c.x), el = 0.35;
    const dir = { x: Math.cos(az) * Math.cos(el), y: Math.sin(el), z: Math.sin(az) * Math.cos(el) };
    return { id: 'sun', centerKm: { x: 0, y: 0, z: 0 }, radiusKm: this.bodies[0].data.radiusKm, normal: { x: 0, y: 1, z: 0 }, arrivalDir: dir, viewKm: SOLAR_RETURN_KM, mode: 'sun' };
  }

  /**
   * Otra galaxia: se llega por el lado del Sol, viéndola como desde la Tierra (de canto el
   * Sombrero, de cara el Molinete: como en las fotos), a 2,6 radios, con su eje mayor en
   * horizontal. Después se puede girar alrededor con el arrastre.
   */
  private galaxyDestination(id: GalaxyId): CosmicDestination {
    const data = GALAXIES[id];
    const centerKm = galaxyCenterKm(data);
    const { normal } = galaxyBasis(data);
    const d = Math.hypot(centerKm.x, centerKm.y, centerKm.z);
    const toSun = { x: -centerKm.x / d, y: -centerKm.y / d, z: -centerKm.z / d };
    // La normal hacia nuestro lado: el «arriba» al orbitarla y el eje del arrastre.
    const side = Math.sign(normal.x * toSun.x + normal.y * toSun.y + normal.z * toSun.z) || 1;
    const radiusKm = (data.diameterLy / 2) * LY_KM;
    return {
      id,
      centerKm,
      radiusKm,
      normal: { x: normal.x * side, y: normal.y * side, z: normal.z * side },
      arrivalDir: toSun,
      viewKm: radiusKm * 2.6,
      mode: 'galaxy',
    };
  }

  /**
   * Exposición del cosmos (como el ojo): alrededor de una galaxia pequeña y brillante (el
   * Sombrero, M87) baja para que no salga blanca; con la Vía Láctea, 1. Se adapta en ~1 s.
   */
  private updateCosmicExposure(dt: number): void {
    const dest = this.orbit.cosmicDestination;
    let target = 1;
    if (dest?.mode === 'galaxy') {
      const g = GALAXIES[dest.id as GalaxyId];
      // Brillo superficial respecto a la Vía Láctea: luz / área del disco.
      const surface = g.light / Math.pow(g.diameterLy / GALAXIES.milkyway.diameterLy, 2);
      const c = this.cameraKm, k = dest.centerKm;
      const near = 1 - logStep(Math.hypot(k.x - c.x, k.y - c.y, k.z - c.z), dest.radiusKm * 6, dest.radiusKm * 60);
      target = 1 + (Math.min(1, Math.max(0.12, 1.2 / surface)) - 1) * near;
    }
    const e = cosmicLook.exposure.value;
    cosmicLook.exposure.value = Math.exp(Math.log(e) + (Math.log(target) - Math.log(e)) * (1 - Math.exp(-dt * 3)));
  }

  focus(body: CelestialBody, arrival?: { x: number; y: number; z: number }): void {
    if (this.leaveCosmos(() => this.focus(body, arrival))) return;
    if (this.flying) this.exitFly();
    this.pendingLand = false;
    this.pendingSite = null;
    this.setReference(body);
    this.orbit.focusOn(body, this.rig, arrival);
    this.hud.coach.dismiss();
  }

  /**
   * Lleva el reloj y la cámara a un eclipse o tránsito: un poco antes del máximo (o de que
   * empiece, en los de Júpiter), con el tiempo a 1 min/s (10 min/s en Júpiter) y mirando
   * hacia la sombra. `fromGround`: aterriza en el lugar del máximo para verlo desde el suelo.
   */
  goToEvent(e: ShadowEvent, fromGround: boolean): void {
    const receiver = this.byId(e.receiver);
    if (!receiver || this.leaveCosmos(() => this.goToEvent(e, fromGround))) return;
    const MIN = 60_000;
    const jupiter = e.kind === 'transit' || e.kind === 'moonEclipse';
    const t = jupiter ? e.startMs - 10 * MIN : e.maxMs - (e.kind === 'lunar' ? 50 : fromGround ? 12 : 40) * MIN;
    this.clock.timeMs = t;
    this.clock.paused = false;
    this.clock.rateIndex = jupiter ? 2 : 1;
    // Posiciones de la nueva fecha antes de elegir desde dónde se mira.
    layoutSystem(this.bodies, t, this.scale);
    for (const b of this.bodies) b.orient(t);
    // La sombra cae en la cara que mira al ocultador (eclipses de Sol, tránsitos).
    let arrival: { x: number; y: number; z: number } | undefined;
    const occluder = this.byId(e.occluder);
    if (occluder && (e.kind === 'solar' || e.kind === 'transit')) {
      const a = occluder.sceneD, b = receiver.sceneD;
      const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
      arrival = { x: (a.x - b.x) / d, y: (a.y - b.y) / d, z: (a.z - b.z) / d };
    }
    this.focus(receiver, arrival);
    if (fromGround && e.site) {
      this.pendingLand = true;
      this.pendingSite = { name: 'el lugar del máximo', ...e.site };
    }
    const when = new Date(jupiter ? e.startMs : e.maxMs).toISOString().slice(11, 16);
    const rate = jupiter ? '10 min/s' : '1 min/s';
    this.hud.toasts.show(`${jupiter ? 'Empieza' : 'Máximo'} a las ${when} UTC · tiempo a ${rate}`, 'eclipse', 5);
  }

  /** La pantalla de carga se ha ido: entra la interfaz. */
  revealed(): void {
    this.hud.reveal();
    // Lo medido detrás del telón (horneados, subida de buffers) no cuenta para la calidad.
    this.quality.restartMeasure();
  }

  /** Cuerpo de referencia: el enfocado en órbita o el ancla en vuelo libre. */
  get reference(): CelestialBody {
    return this.flying ? this.fly.anchor : this.orbit.focus;
  }

  /** El de referencia carga su detalle completo y su superficie (§6.3, §7). */
  private setReference(body: CelestialBody): void {
    for (const b of this.bodies) b.setFocused(b === body);
    this.hud.setActiveBody(body.data.id, body.landable);
  }

  /** Próximos (o anteriores) pasos de los cometas por el perihelio, en un plazo de 150 años. */
  private perihelia(fromMs: number, direction: 1 | -1): PerihelionEvent[] {
    const span = 150 * 365.25 * 86_400_000;
    const out: PerihelionEvent[] = [];
    for (const id of COMET_IDS) {
      const t = perihelionNear(id, fromMs, direction);
      if (t !== null && Math.abs(t - fromMs) < span) out.push({ id, name: BODIES[id].name, timeMs: t, qAU: cometElementsAt(id, t).q });
    }
    return out.sort((a, b) => (a.timeMs - b.timeMs) * direction);
  }

  /**
   * Lleva el reloj unos días después del perihelio (la cola es más larga) a 6 h/s y mira el
   * cometa desde encima del plano de su órbita, donde se ve la cola de polvo curvarse.
   */
  goToPerihelion(e: PerihelionEvent): void {
    const comet = this.byId(e.id);
    if (!comet || this.leaveCosmos(() => this.goToPerihelion(e))) return;
    const t = e.timeMs + 4 * 86_400_000;
    this.clock.timeMs = t;
    this.clock.paused = false;
    this.clock.rateIndex = 4;
    layoutSystem(this.bodies, t, this.scale);
    const el = cometElementsAt(e.id as CometId, t);
    const p = eclToScene(cometPosition(el, t)), v = eclToScene(cometVelocity(el, t));
    const normal = new THREE.Vector3(p.x, p.y, p.z).cross(new THREE.Vector3(v.x, v.y, v.z)).normalize();
    const sunward = new THREE.Vector3(-p.x, -p.y, -p.z).normalize();
    const arrival = normal.multiplyScalar(0.85).addScaledVector(sunward, 0.4).normalize();
    if (this.flying) this.exitFly();
    this.pendingLand = false;
    this.pendingSite = null;
    this.setReference(comet);
    this.orbit.focusOn(comet, this.rig, arrival, 1500);
    this.hud.coach.dismiss();
    this.hud.toasts.show(`${e.name} · perihelio el ${new Date(e.timeMs).toISOString().slice(0, 10)} · tiempo a 6 h/s`, 'sparkle', 5);
  }

  /**
   * Aterriza en el lugar destacado del cuerpo enfocado (o bajo la cámara). Con `custom`
   * (el lugar de un eclipse), allí y sin tocar el reloj.
   */
  land(custom?: LandingSite): void {
    const body = this.orbit.focus;
    if (!body.landable || this.flying) {
      this.pendingLand = false;
      return;
    }
    // A mitad de viaje: se aterriza al llegar.
    if (this.orbit.inTransition) {
      this.pendingLand = true;
      return;
    }
    this.pendingLand = false;
    this.pendingSite = null;
    const site = custom ?? FACTS[body.data.id].site;
    if (custom) this.hud.toasts.show(`Aterrizando en ${custom.name}`, 'land', 4);
    else if (site) {
      // En la superficie el tiempo va despacio: si no, el Sol cruza el cielo en segundos.
      const slowed = this.clock.rateIndex > 1;
      if (slowed) this.clock.rateIndex = 1;
      const hours = this.morningAt(body, site);
      const notes = [hours !== 0 ? `el reloj avanza ${formatHours(hours)} para llegar de día` : '', slowed ? 'tiempo a 1 min/s' : ''].filter(Boolean);
      if (notes.length) this.hud.toasts.show(`Aterrizando en ${site.name} · ${notes.join(' · ')}`, 'land', 5);
    }
    this.orbit.land(site);
    this.hud.coach.dismiss();
  }

  /**
   * Si el lugar está de noche o con el Sol muy bajo, adelanta el reloj hasta su media mañana.
   * Devuelve las horas adelantadas (0 si ya era de día). Newton sobre el ángulo horario, con
   * las posiciones y el giro reales de cada fecha de prueba.
   */
  private morningAt(body: CelestialBody, site: LandingSite): number {
    const DEG = Math.PI / 180;
    const local = new THREE.Vector3(Math.cos(site.lat * DEG) * Math.cos(site.lon * DEG), Math.sin(site.lat * DEG), -Math.cos(site.lat * DEG) * Math.sin(site.lon * DEG));
    const sense = Math.sign(body.data.pole.wRate) || 1;
    // Ángulo horario del lugar (rad): 0 = mediodía, negativo = mañana.
    const hourAngle = (t: number) => {
      layoutSystem(this.bodies, t, this.scale);
      body.orient(t);
      const pole = new THREE.Vector3(0, 1, 0).applyQuaternion(body.object3d.quaternion);
      const at = local.clone().applyQuaternion(body.spinQuaternion);
      const p = body.positionKm;
      const s = eclToScene({ x: -p.x, y: -p.y, z: -p.z });
      const sun = new THREE.Vector3(s.x, s.y, s.z).normalize();
      at.addScaledVector(pole, -at.dot(pole));
      sun.addScaledVector(pole, -sun.dot(pole));
      return Math.atan2(new THREE.Vector3().crossVectors(sun, at).dot(pole), sun.dot(at)) * sense;
    };
    const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
    const TARGET = -0.6;
    const start = this.clock.timeMs;
    if (Math.abs(wrap(hourAngle(start) - TARGET)) < 0.9) return 0;
    const step = Math.abs(body.data.rotationPeriodH) * 3600e3 / 60;
    let t = start;
    for (let i = 0; i < 8; i++) {
      const err = wrap(TARGET - hourAngle(t));
      if (Math.abs(err) < 0.005) break;
      const rate = wrap(hourAngle(t + step) - hourAngle(t)) / step;
      if (rate <= 0) break;
      // El primer paso siempre hacia delante (la mañana siguiente, no la anterior); después, afinar.
      t += (i === 0 && err < 0 ? err + 2 * Math.PI : err) / rate;
    }
    this.clock.timeMs = t;
    layoutSystem(this.bodies, t, this.scale);
    body.orient(t);
    return (t - start) / 3600e3;
  }

  toggleFly(): void {
    if (this.flying) this.exitFly();
    else if (this.cameraSunKm > HANDOFF_START_KM) this.hud.toasts.show('El vuelo libre es dentro del sistema solar', 'fly', 3.5);
    else this.enterFly();
  }

  /**
   * Vía Láctea ↔ sistema solar (tecla `G`, §14.5): zoom con el Sol enfocado hasta ver la
   * galaxia entera, y de vuelta hasta ver el sistema solar.
   */
  toggleGalaxy(): void {
    if (this.flying) this.exitFly();
    this.pendingFocus = null;
    const sun = this.bodies[0];
    // Desde otra galaxia, de vuelta al sistema solar.
    if (this.orbit.galaxyTarget || this.orbit.cosmicTraveling) {
      this.leaveCosmos(() => undefined);
      return;
    }
    if (this.cameraSunKm > HANDOFF_START_KM) {
      this.orbit.zoomTo(SOLAR_RETURN_KM);
      return;
    }
    if (this.orbit.focus !== sun || this.orbit.inTransition) {
      this.focus(sun);
      this.pendingGalaxy = true;
      return;
    }
    void this.cosmic.load();
    this.orbit.zoomTo(GALAXY_VIEW_KM, GALAXY_VIEW_DIR);
    this.hud.coach.dismiss();
  }

  private enterFly(): void {
    this.fly.anchor = this.orbit.focus;
    this.rig.setMode(this.fly);
    this.flying = true;
    this.hud.coach.dismiss();
  }

  /** Vuelve a la órbita alrededor del ancla, desde donde esté la cámara. */
  private exitFly(): void {
    this.orbit.adopt(this.rig, this.fly.anchor);
    this.rig.setMode(this.orbit);
    this.flying = false;
  }

  /** Activa o silencia el sonido; con `notify`, lo cuenta un aviso. */
  private setSound(on: boolean, notify = false): void {
    this.setPref('sound', on, () => this.sound.setEnabled(on));
    if (notify) this.hud.toasts.show(on ? 'Sonido activado' : 'Sonido silenciado · M para volver a oírlo', on ? 'sound' : 'muted', 2.2);
  }

  private getPref(key: string): boolean | null {
    try {
      const v = localStorage.getItem(`particles.${key}`);
      return v === null ? null : v === '1';
    } catch {
      return null;
    }
  }

  private setPref(key: string, on: boolean, apply: () => void): void {
    apply();
    try {
      localStorage.setItem(`particles.${key}`, on ? '1' : '0');
    } catch {
      // Sin almacenamiento: vale para esta sesión.
    }
  }

  /** Lo que el perfil cambia en caliente (§12). */
  private applyQuality(p: QualityProfile): void {
    this.applyLook(p);
    this.bloom.setResolutionScale(p.bloomScale);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, p.pixelRatio));
    this.onResize();
  }

  /** Lo que no depende del renderer: separación, pool de la superficie y paneles. */
  private applyLook(p: QualityProfile): void {
    particleLook.spacingPx = p.spacingPx;
    surfaceBudget.chunks = p.surfaceChunks;
    document.documentElement.classList.toggle('no-glass', !p.glass);
  }

  toggleScale(): void {
    this.scale.setMode(this.scale.mode === 'real' ? 'compressed' : 'real');
  }

  private readonly bodyMap = new Map<string, CelestialBody>();

  private byId(id: string): CelestialBody | undefined {
    return this.bodyMap.get(id);
  }

  private createBodies(): void {
    const byId = new Map<string, CelestialBody>();
    for (const id of config.bodies) {
      const data = BODIES[id];
      const body = createBody(data, data.parent ? byId.get(data.parent) ?? null : null, this.scale);
      if (!body) continue;
      byId.set(id, body);
      this.bodyMap.set(id, body);
      this.bodies.push(body);
      this.scene.add(body.object3d);
    }
  }

  private bindPointer(canvas: HTMLCanvasElement): void {
    // La pista de bienvenida se va en cuanto se usan los controles.
    let dragged = 0;
    canvas.addEventListener('wheel', () => this.hud.coach.dismiss(), { passive: true });
    canvas.addEventListener('pointermove', (e) => {
      if (e.buttons && (dragged += Math.abs(e.movementX) + Math.abs(e.movementY)) > 120) this.hud.coach.dismiss();
    });
    canvas.addEventListener('pointermove', (e) => {
      const rect = canvas.getBoundingClientRect();
      this.pointerNdc ??= new THREE.Vector2();
      this.pointerNdc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    });
    canvas.addEventListener('pointerleave', () => (this.pointerNdc = null));
  }

  private bindKeys(): void {
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return;
      // Espacio o Intro sobre un botón con foco (teclado): que lo pulse el botón.
      if (e.target instanceof HTMLButtonElement && (e.key === ' ' || e.key === 'Enter')) return;
      if (this.hud.handleKey(e)) {
        e.preventDefault();
        return;
      }
      const key = e.key.toLowerCase();
      // En vuelo libre las teclas de movimiento son del modo (Q/E giran, no cambian la escala).
      if (this.flying && FLY_KEYS.has(key)) return;
      if (this.flying && e.key === 'Escape') {
        this.exitFly();
        e.preventDefault();
        return;
      }
      const n = Number(e.key);
      const target = e.key.length === 1 && n >= 0 && n <= 9 ? this.byId(KEY_BODIES[n]) : undefined;
      if (target) this.focus(target);
      else if (e.key === ',') this.clock.slower();
      else if (e.key === '.') this.clock.faster();
      else if (e.key === ' ') this.clock.paused = !this.clock.paused;
      else if (key === 'n') this.clock.timeMs = Date.now();
      else if (key === 'e') this.toggleScale();
      else if (key === 'o') this.orbits.visible = !this.orbits.visible;
      else if (key === 'l') this.labels.visible = !this.labels.visible;
      else if (key === 't' && !this.flying) this.orbit.altitudeKm < this.orbit.focus.data.radiusKm * NEAR_GROUND_RADII ? this.orbit.ascend() : this.land();
      else if (key === 'v') this.toggleFly();
      else if (key === 'g') this.toggleGalaxy();
      else if (key === 'm') this.setSound(!this.sound.enabled, true);
      else return;
      e.preventDefault();
    });
  }

  private frame = (): void => {
    // Con el canvas a 0×0 (pestaña oculta, panel colapsado) WebGPU no puede crear el swapchain.
    if (window.innerWidth === 0 || window.innerHeight === 0) return;
    const now = performance.now();
    const frameMs = now - this.lastFrameMs;
    const dt = Math.min(frameMs / 1000, 0.1);
    this.lastFrameMs = now;
    if (frameMs > 0) {
      this.stats.push(frameMs);
      this.quality.sample(frameMs, dt);
    }

    this.clock.tick(dt);
    this.scale.update(dt);
    layoutSystem(this.bodies, this.clock.timeMs, this.scale);
    for (const body of this.bodies) body.orient(this.clock.timeMs);
    if (this.pendingLand && !this.pendingFocus && !this.flying && !this.orbit.inTransition) this.land(this.pendingSite ?? undefined);
    if (this.pendingFocus && !this.orbit.busy) {
      // De vuelta en el sistema solar, el viaje; si el usuario cortó el zoom con la rueda, nada.
      const then = this.pendingFocus;
      this.pendingFocus = null;
      if (!this.orbit.galaxyTarget && this.cameraSunKm <= HANDOFF_START_KM) then();
    }
    if (this.pendingGalaxy && !this.flying && !this.orbit.inTransition) {
      this.pendingGalaxy = false;
      this.toggleGalaxy();
    }
    if (this.pendingGalaxyId && !this.flying && !this.orbit.busy) {
      const id = this.pendingGalaxyId;
      this.pendingGalaxyId = null;
      this.focusGalaxy(id);
    }
    this.rig.update(dt);
    this.updateWarp();
    this.updateHandoff();

    let pointer: THREE.Vector3 | null = null;
    this.rig.camera.updateMatrixWorld();
    if (this.pointerNdc) {
      this.pointerRaycaster.setFromCamera(this.pointerNdc, this.rig.camera);
      pointer = this.pointerRaycaster.ray.direction;
    }

    const ctx: FrameContext = {
      timeMs: this.clock.timeMs,
      dt,
      timeRate: this.clock.paused ? 0 : this.clock.rate,
      scale: this.scale,
      origin: this.origin,
      renderer: this.renderer,
      pointer,
      nowSeconds: now / 1000,
      camera: this.rig.camera,
      body: (id) => this.bodyMap.get(id),
    };
    for (const body of this.bodies) body.update(ctx);
    // Fuera del sistema solar no se dibuja nada de él (la ISS se enciende sola en su update).
    if (this.solarHidden) for (const body of this.bodies) body.object3d.visible = false;
    this.orbits.update(ctx);
    const sun = this.bodies[0];
    for (const belt of this.belts) belt.update(ctx, sun.sceneD);

    // Fondo a ras de suelo (§7.4): cielo arriba, suelo abajo; de día las estrellas se apagan.
    const sky = this.reference.sky;
    horizon.amount.value = sky.amount;
    horizon.up.value.copy(sky.up);
    horizon.dip.value = sky.dip;
    horizon.sky.value.set(sky.color.r, sky.color.g, sky.color.b);
    horizon.ground.value.set(sky.ground.r, sky.ground.g, sky.ground.b);
    const daySky = Math.min(1, (sky.color.r + sky.color.g + sky.color.b) * 2) * sky.amount;
    // Las de Yale están en el infinito: lejos del Sol se apagan mientras entra la galaxia (§14.4).
    const galaxy = logStep(this.cameraSunKm, STARS_FADE_START_KM, STARS_FADE_END_KM);
    starLook.brightness.value = (1 - 0.95 * daySky) * (1 - galaxy);
    if (this.stars) this.stars.object.visible = galaxy < 1;
    cosmicLook.sky.value = 1 - 0.95 * daySky;
    this.updateCosmicExposure(dt);
    this.cosmic.update(this.cameraKm, this.solar, galaxy);

    this.pipeline.render();
    this.labels.suppressed = this.solar < 0.5;
    this.labels.update(this.rig.camera, window.innerWidth, window.innerHeight, this.reference);
    this.updateMarkers(galaxy);
    const focus = this.reference;
    const travel = this.flying ? null : this.orbit.travel;
    const altitudeKm = this.flying ? this.fly.altitudeKm : this.orbit.altitudeKm;
    const earth = this.byId('earth');
    const km = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    this.updateSound(focus, altitudeKm);
    this.hud.render({
      focusId: focus.data.id,
      focusName: focus.data.name,
      altitudeKm,
      speedKmS: this.flying ? this.fly.speedKmS : null,
      landable: focus.landable,
      nearGround: altitudeKm < focus.data.radiusKm * NEAR_GROUND_RADII,
      descending: !this.flying && (this.orbit.descending || this.pendingLand),
      sunDistanceKm: Math.hypot(focus.positionKm.x, focus.positionKm.y, focus.positionKm.z),
      earthDistanceKm: earth ? km(focus.positionKm, earth.positionKm) : 0,
      cameraDistanceKm: altitudeKm + focus.data.radiusKm,
      time: { date: this.clock.date, rateIndex: this.clock.rateIndex, paused: this.clock.paused },
      tools: { scale: this.scale.mode, orbits: this.orbits.visible, labels: this.labels.visible, flying: this.flying, sound: this.sound.enabled },
      travel: travel && {
        name: travel.to.data.name,
        progress: travel.progress,
        distanceKm: km(travel.from.positionKm, travel.to.positionKm) * (1 - travel.progress),
      },
      stats: this.stats,
      particles: this.bodies.reduce((n, b) => n + (this.solarHidden ? 0 : b.particleCount), (this.stars?.object.visible ? this.stars.count : 0) + this.cosmic.particleCount),
      pixelRatio: this.renderer.getPixelRatio(),
      backend: this.isWebGLFallback ? 'WebGL2' : 'WebGPU',
      cosmic: this.cosmicHud(),
    }, now);
  };

  /**
   * Galaxia de referencia para la interfaz (§14.5): la que se orbita o a la que se viaja; fuera
   * del sistema solar, si no, la Vía Láctea. Dentro, null (manda el cuerpo enfocado).
   */
  private cosmicHud(): { id: GalaxyId; distanceKm: number; sunKm: number } | null {
    const dest = this.orbit.cosmicDestination;
    let id: GalaxyId | null = null;
    if (dest?.mode === 'galaxy') id = dest.id as GalaxyId;
    else if (this.solar < 0.5) id = 'milkyway';
    if (!id) return null;
    const center = id === 'milkyway' ? GALACTIC_CENTER_KM : this.galaxyCenters[id];
    const c = this.cameraKm;
    return { id, distanceKm: Math.hypot(center.x - c.x, center.y - c.y, center.z - c.z), sunKm: this.cameraSunKm };
  }

  /**
   * Relevo sistema solar ↔ cosmos (§14.4): la cámara en km verdaderos respecto al Sol y,
   * según su distancia, cuánto se ve del sistema solar.
   */
  private updateHandoff(): void {
    const c = this.cameraKm;
    if (this.flying || !this.orbit.cameraKm(c)) {
      // En un viaje o en vuelo libre, desde la posición de escena (el Sol está en su origen).
      const p = this.rig.position, d = Math.hypot(p.x, p.y, p.z) || 1;
      const km = this.scale.inverseLocalDistance(this.bodies[0].data, d);
      c.x = (p.x / d) * km;
      c.y = (p.y / d) * km;
      c.z = (p.z / d) * km;
    }
    this.cameraSunKm = Math.hypot(c.x, c.y, c.z);
    // La galaxia se genera en cuanto la cámara se aleja (el zoom hasta el relevo da tiempo).
    if (this.cameraSunKm > HANDOFF_START_KM / 10) void this.cosmic.load();
    this.solar = solarPresence(this.cameraSunKm);
    handoff.solar.value = this.solar;
    const hidden = this.solar === 0;
    if (hidden !== this.solarHidden) {
      this.solarHidden = hidden;
      for (const body of this.bodies) body.object3d.visible = !hidden;
      for (const belt of this.belts) belt.object.visible = !hidden;
    }
  }

  /**
   * Nombres de la capa cósmica: dónde está el Sol, el centro galáctico y las galaxias, que se
   * pulsan para viajar. De lejos (desde otra galaxia), la nuestra lleva un solo nombre.
   */
  private updateMarkers(galaxy: number): void {
    const c = this.cameraKm, d = this.cameraSunKm || 1;
    const on = this.labels.visible;
    const gc = this.cosmic.galacticCenterFromCamera();
    const fromCenter = Math.hypot(GALACTIC_CENTER_KM.x - c.x, GALACTIC_CENTER_KM.y - c.y, GALACTIC_CENTER_KM.z - c.z);
    const far = fromCenter > 300_000 * LY_KM;
    const current = this.orbit.cosmicDestination?.id;
    const markers: Marker[] = [
      { key: 'sun', text: 'Sol · estás aquí', color: '#ffe6b0', dir: { x: -c.x / d, y: -c.y / d, z: -c.z / d }, show: on && this.solar < 0.5 && !far },
      { key: 'center', text: 'Centro galáctico', color: '#ffd38a', dir: gc, show: on && galaxy > 0.5 && this.cameraSunKm > 3e16 && !far },
      { key: 'milkyway', text: GALAXIES.milkyway.name, color: '#f2e6cf', dir: gc, show: on && galaxy > 0.5 && far, onClick: () => this.focusGalaxy('milkyway') },
    ];
    for (const id of MARKER_ORDER) {
      const centerKm = this.galaxyCenters[id];
      const rx = centerKm.x - c.x, ry = centerKm.y - c.y, rz = centerKm.z - c.z;
      const dist = Math.hypot(rx, ry, rz) || 1;
      const radiusPx = ((GALAXIES[id].diameterLy / 2) * LY_KM) / dist / pixelAngle.value;
      markers.push({
        key: id,
        text: GALAXIES[id].name,
        color: `#${GALAXIES[id].color.toString(16).padStart(6, '0')}`,
        dir: { x: rx / dist, y: ry / dist, z: rz / dist },
        show: on && galaxy > 0.5 && id !== current && radiusPx < 60,
        onClick: () => this.focusGalaxy(id),
      });
    }
    this.markers.update(this.rig.camera, window.innerWidth, window.innerHeight, markers);
  }

  /** Lo que suena (§13): el gigante que más se ve, el Sol, el viento del cuerpo y el warp. */
  private updateSound(focus: CelestialBody, altitudeKm: number): void {
    const cam = this.origin.cameraScene;
    const angular = (b: CelestialBody) => {
      const d = Math.hypot(b.sceneD.x - cam.x, b.sceneD.y - cam.y, b.sceneD.z - cam.z);
      return Math.asin(Math.min(1, b.sceneRadius / Math.max(d, b.sceneRadius)));
    };
    let giant: { id: BodyId; angularRadius: number } | null = null;
    for (const b of this.bodies) {
      if (b.data.kind !== 'gas') continue;
      const a = angular(b);
      if (!giant || a > giant.angularRadius) giant = { id: b.data.id, angularRadius: a };
    }
    this.sound.update({
      giant,
      sunAngularRadius: angular(this.bodies[0]),
      focusId: focus.data.id,
      altitudeKm,
      radiusKm: focus.data.radiusKm,
      warp: warpLook.amount.value,
    });
  }

  /** Warp de los viajes (§10) y un ligero aumento del campo de visión en su punto álgido. */
  private updateWarp(): void {
    let w = this.flying ? this.fly.warp : this.orbit.warp;
    if (REDUCED_MOTION.matches) w *= 0.3;
    warpLook.amount.value = w;
    const fov = BASE_FOV + 9 * w;
    if (Math.abs(this.rig.camera.fov - fov) > 0.01) {
      this.rig.camera.fov = fov;
      this.rig.camera.updateProjectionMatrix();
      updatePixelAngle(this.rig.camera, window.innerHeight);
    }
  }

  private onResize = (): void => {
    if (window.innerWidth === 0 || window.innerHeight === 0) return;
    this.rig.camera.aspect = window.innerWidth / window.innerHeight;
    this.rig.camera.updateProjectionMatrix();
    warpLook.aspect.value = this.rig.camera.aspect;
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    updatePixelAngle(this.rig.camera, window.innerHeight);
  };
}
