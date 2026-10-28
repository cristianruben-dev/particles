/**
 * Bucle principal y orquestación de módulos. Ver docs/ARQUITECTURA.md §3.
 */
import * as THREE from 'three/webgpu';
import { BODIES, type BodyId } from '../astro/bodies';
import { FACTS, type LandingSite } from '../astro/facts';
import { eclToScene } from '../astro/frames';
import { AsteroidBelt } from '../bodies/AsteroidBelt';
import type { CelestialBody, FrameContext } from '../bodies/CelestialBody';
import { createBody } from '../bodies/createBody';
import { OrbitLines } from '../bodies/OrbitLines';
import { createStarfield, starLook } from '../bodies/Starfield';
import { config } from '../config';
import { CameraRig } from '../navigation/CameraRig';
import { FreeFlyMode } from '../navigation/FreeFlyMode';
import { OrbitMode } from '../navigation/OrbitMode';
import { pickBody } from '../navigation/picking';
import { disturbanceLook } from '../particles/Disturbance';
import { particleLook } from '../particles/LodManager';
import { updatePixelAngle } from '../particles/nodes';
import type { ParticleField } from '../particles/ParticleField';
import { createPipeline, warpLook, type BloomControls } from '../postfx/Pipeline';
import { ScaleSystem } from '../scale/ScaleSystem';
import { surfaceBudget } from '../surface/Surface';
import { createDebugGui } from '../ui/DebugGui';
import { Hud } from '../ui/Hud';
import { Labels } from '../ui/Labels';
import { FloatingOrigin } from './FloatingOrigin';
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
  private hud!: Hud;
  private labels!: Labels;
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
    const earth = this.byId('earth') ?? this.bodies[0];
    // Primer frame: posiciones calculadas antes de colocar la cámara.
    layoutSystem(this.bodies, this.clock.timeMs, this.scale);

    this.orbit = new OrbitMode(earth, canvas, (x, y) => {
      const hit = pickBody(x, y, this.rig.camera, this.bodies, canvas.clientHeight);
      if (hit) this.focus(hit);
    });
    this.orbit.faceDaySide();
    this.rig.setMode(this.orbit);
    this.fly = new FreeFlyMode(earth, this.bodies, canvas, (x, y) => {
      const hit = pickBody(x, y, this.rig.camera, this.bodies, canvas.clientHeight);
      if (hit) this.focus(hit);
    }, (body) => this.setReference(body));

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
        };
      }),
      quality: this.quality,
      toggles: [
        { id: 'meter', label: 'Medidor de rendimiento', get: () => !hudEl.classList.contains('no-perf'), set: (on) => this.setPref('meter', on, () => hudEl.classList.toggle('no-perf', !on)) },
        { id: 'mouse', label: 'Las partículas reaccionan al ratón', get: () => disturbanceLook.strength.value > 0, set: (on) => this.setPref('mouse', on, () => (disturbanceLook.strength.value = on ? mouseStrength : 0)) },
        { id: 'labels', label: 'Nombres de los cuerpos', key: 'L', get: () => this.labels.visible, set: (on) => (this.labels.visible = on) },
        { id: 'orbits', label: 'Órbitas', key: 'O', get: () => this.orbits.visible, set: (on) => (this.orbits.visible = on) },
      ],
      onSelectBody: (id) => this.focus(this.byId(id)!),
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
      onLand: () => this.land(),
      onAscend: () => this.orbit.ascend(),
      onInfo: () => undefined,
    });
    // Preferencias guardadas de la interfaz.
    if (this.getPref('meter') === false) hudEl.classList.add('no-perf');
    if (this.getPref('mouse') === false) disturbanceLook.strength.value = 0;
    this.quality.onChange((p, reason) => {
      if (reason === 'auto') this.hud.toasts.show(`Calidad ajustada a ${p.name} para ir más fluido`, 'settings', 4.5);
    });
    this.labels = new Labels(hudEl, this.bodies, (body) => this.focus(body));
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

  focus(body: CelestialBody): void {
    if (this.flying) this.exitFly();
    this.setReference(body);
    this.orbit.focusOn(body, this.rig);
    this.hud.coach.dismiss();
  }

  /** La pantalla de carga se ha ido: entra la interfaz. */
  revealed(): void {
    this.hud.reveal();
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

  /** Aterriza en el lugar destacado del cuerpo enfocado (o bajo la cámara). */
  land(): void {
    const body = this.orbit.focus;
    if (!body.landable || this.orbit.inTransition) return;
    const site = FACTS[body.data.id].site;
    if (site) {
      // En la superficie el tiempo va despacio: si no, el Sol cruza el cielo en segundos.
      const slowed = this.clock.rateIndex > 1;
      if (slowed) this.clock.rateIndex = 1;
      const hours = this.morningAt(body, site);
      const notes = [hours !== 0 ? `el reloj avanza ${formatHours(hours)} para llegar de día` : '', slowed ? 'tiempo a 1 min/s' : ''].filter(Boolean);
      if (notes.length) this.hud.toasts.show(`Rumbo a ${site.name} · ${notes.join(' · ')}`, 'land', 5);
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
    else this.enterFly();
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

  private byId(id: string): CelestialBody | undefined {
    return this.bodies.find((b) => b.data.id === id);
  }

  private createBodies(): void {
    const byId = new Map<string, CelestialBody>();
    for (const id of config.bodies) {
      const data = BODIES[id];
      const body = createBody(data, data.parent ? byId.get(data.parent) ?? null : null, this.scale);
      if (!body) continue;
      byId.set(id, body);
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
    this.rig.update(dt);
    this.updateWarp();

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
    };
    for (const body of this.bodies) body.update(ctx);
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
    starLook.brightness.value = 1 - 0.95 * daySky;

    this.pipeline.render();
    this.labels.update(this.rig.camera, window.innerWidth, window.innerHeight, this.reference);
    const focus = this.reference;
    const travel = this.flying ? null : this.orbit.travel;
    const altitudeKm = this.flying ? this.fly.altitudeKm : this.orbit.altitudeKm;
    const earth = this.byId('earth');
    const km = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    this.hud.render({
      focusId: focus.data.id,
      focusName: focus.data.name,
      altitudeKm,
      speedKmS: this.flying ? this.fly.speedKmS : null,
      landable: focus.landable,
      nearGround: altitudeKm < focus.data.radiusKm * NEAR_GROUND_RADII,
      descending: !this.flying && this.orbit.descending,
      sunDistanceKm: Math.hypot(focus.positionKm.x, focus.positionKm.y, focus.positionKm.z),
      earthDistanceKm: earth ? km(focus.positionKm, earth.positionKm) : 0,
      cameraDistanceKm: altitudeKm + focus.data.radiusKm,
      time: { date: this.clock.date, rateIndex: this.clock.rateIndex, paused: this.clock.paused },
      tools: { scale: this.scale.mode, orbits: this.orbits.visible, labels: this.labels.visible, flying: this.flying },
      travel: travel && {
        name: travel.to.data.name,
        progress: travel.progress,
        distanceKm: km(travel.from.positionKm, travel.to.positionKm) * (1 - travel.progress),
      },
      stats: this.stats,
      particles: this.bodies.reduce((n, b) => n + b.particleCount, this.stars?.count ?? 0),
      pixelRatio: this.renderer.getPixelRatio(),
      backend: this.isWebGLFallback ? 'WebGL2' : 'WebGPU',
    }, now);
  };

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
