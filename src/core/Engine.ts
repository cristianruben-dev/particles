/**
 * Bucle principal y orquestación de módulos. Ver docs/ARQUITECTURA.md §3.
 */
import * as THREE from 'three/webgpu';
import { BODIES, type BodyId } from '../astro/bodies';
import { AsteroidBelt } from '../bodies/AsteroidBelt';
import type { CelestialBody, FrameContext } from '../bodies/CelestialBody';
import { createBody } from '../bodies/createBody';
import { OrbitLines } from '../bodies/OrbitLines';
import { createStarfield, starLook } from '../bodies/Starfield';
import { config } from '../config';
import { CameraRig } from '../navigation/CameraRig';
import { OrbitMode } from '../navigation/OrbitMode';
import { pickBody } from '../navigation/picking';
import { updatePixelAngle } from '../particles/nodes';
import type { ParticleField } from '../particles/ParticleField';
import { createPipeline, type BloomControls } from '../postfx/Pipeline';
import { ScaleSystem } from '../scale/ScaleSystem';
import { createDebugGui } from '../ui/DebugGui';
import { Hud } from '../ui/Hud';
import { Labels } from '../ui/Labels';
import { FloatingOrigin } from './FloatingOrigin';
import { horizon, horizonBackground } from './Horizon';
import { createRenderer } from './Renderer';
import { SimClock } from './SimClock';
import { layoutSystem } from './SystemLayout';

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

  private renderer!: THREE.WebGPURenderer;
  private pipeline!: THREE.RenderPipeline;
  private bloom!: BloomControls;
  private isWebGLFallback = false;
  private orbit!: OrbitMode;
  private hud!: Hud;
  private labels!: Labels;
  private orbits!: OrbitLines;
  private readonly belts: AsteroidBelt[] = [];
  private stars: ParticleField | null = null;
  private lastFrameMs = performance.now();
  private fps = 60;
  /** Cursor sobre el canvas en coordenadas normalizadas, o null si está fuera. */
  private pointerNdc: THREE.Vector2 | null = null;
  private readonly pointerRaycaster = new THREE.Raycaster();

  async start(canvas: HTMLCanvasElement, hudEl: HTMLElement): Promise<void> {
    ({ renderer: this.renderer, isWebGLFallback: this.isWebGLFallback } = await createRenderer(canvas));
    ({ pipeline: this.pipeline, bloom: this.bloom } = createPipeline(this.renderer, this.scene, this.rig.camera));

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

    this.hud = new Hud(hudEl, {
      bodies: this.bodies.map((b) => {
        const key = KEY_BODIES.indexOf(b.data.id);
        return {
          id: b.data.id,
          name: b.data.name,
          parent: b.parent?.parent ? b.parent.data.id : null,
          key: key >= 0 ? String(key) : undefined,
        };
      }),
      onSelectBody: (id) => this.focus(this.byId(id)!),
      onSlower: () => this.clock.slower(),
      onFaster: () => this.clock.faster(),
      onTogglePause: () => (this.clock.paused = !this.clock.paused),
      onNow: () => (this.clock.timeMs = Date.now()),
      onSetDate: (ms) => (this.clock.timeMs = ms),
      onToggleScale: () => this.toggleScale(),
      onToggleOrbits: () => (this.orbits.visible = !this.orbits.visible),
      onToggleLabels: () => (this.labels.visible = !this.labels.visible),
    });
    this.labels = new Labels(hudEl, this.bodies, (body) => this.focus(body));
    this.hud.setActiveBody(earth.data.id);
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
    });

    this.onResize();
    window.addEventListener('resize', this.onResize);
    this.renderer.setAnimationLoop(this.frame);
  }

  focus(body: CelestialBody): void {
    for (const b of this.bodies) b.setFocused(b === body);
    this.orbit.focusOn(body, this.rig);
    this.hud.setActiveBody(body.data.id);
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
    canvas.addEventListener('pointermove', (e) => {
      const rect = canvas.getBoundingClientRect();
      this.pointerNdc ??= new THREE.Vector2();
      this.pointerNdc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    });
    canvas.addEventListener('pointerleave', () => (this.pointerNdc = null));
  }

  private bindKeys(): void {
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      const key = e.key.toLowerCase();
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
      else return;
      e.preventDefault();
    });
  }

  private frame = (): void => {
    // Con el canvas a 0×0 (pestaña oculta, panel colapsado) WebGPU no puede crear el swapchain.
    if (window.innerWidth === 0 || window.innerHeight === 0) return;
    const now = performance.now();
    const dt = Math.min((now - this.lastFrameMs) / 1000, 0.1);
    this.lastFrameMs = now;
    if (dt > 0) this.fps += (1 / dt - this.fps) * 0.05;

    this.clock.tick(dt);
    this.scale.update(dt);
    layoutSystem(this.bodies, this.clock.timeMs, this.scale);
    for (const body of this.bodies) body.orient(this.clock.timeMs);
    this.rig.update(dt);

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
    const sky = this.orbit.focus.sky;
    horizon.amount.value = sky.amount;
    horizon.up.value.copy(sky.up);
    horizon.dip.value = sky.dip;
    horizon.sky.value.set(sky.color.r, sky.color.g, sky.color.b);
    horizon.ground.value.set(sky.ground.r, sky.ground.g, sky.ground.b);
    const daySky = Math.min(1, (sky.color.r + sky.color.g + sky.color.b) * 2) * sky.amount;
    starLook.brightness.value = 1 - 0.95 * daySky;

    this.pipeline.render();
    this.labels.update(this.rig.camera, window.innerWidth, window.innerHeight, this.orbit.focus);
    this.hud.render({
      focusName: this.orbit.focus.data.name,
      altitudeKm: this.orbit.altitudeKm,
      date: this.clock.date,
      timeLabel: this.clock.rateLabel,
      paused: this.clock.paused,
      fps: this.fps,
      backend: this.isWebGLFallback ? 'WebGL2' : 'WebGPU',
      particles: this.bodies.reduce((n, b) => n + b.particleCount, this.stars?.count ?? 0),
      scale: this.scale.mode,
      orbits: this.orbits.visible,
      labels: this.labels.visible,
    });
  };

  private onResize = (): void => {
    if (window.innerWidth === 0 || window.innerHeight === 0) return;
    this.rig.camera.aspect = window.innerWidth / window.innerHeight;
    this.rig.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    updatePixelAngle(this.rig.camera, window.innerHeight);
  };
}
