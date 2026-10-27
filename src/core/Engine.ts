/**
 * Bucle principal y orquestación de módulos. Ver docs/ARQUITECTURA.md §3.
 */
import * as THREE from 'three/webgpu';
import { BODIES } from '../astro/bodies';
import type { CelestialBody, FrameContext } from '../bodies/CelestialBody';
import { createBody } from '../bodies/createBody';
import { createStarfield } from '../bodies/Starfield';
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
import { FloatingOrigin } from './FloatingOrigin';
import { createRenderer } from './Renderer';
import { SimClock } from './SimClock';
import { layoutSystem } from './SystemLayout';

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
  private stars: ParticleField | null = null;
  private lastFrameMs = performance.now();
  private fps = 60;
  /** Cursor sobre el canvas en coordenadas normalizadas, o null si está fuera. */
  private pointerNdc: THREE.Vector2 | null = null;
  private readonly pointerRaycaster = new THREE.Raycaster();

  async start(canvas: HTMLCanvasElement, hudEl: HTMLElement): Promise<void> {
    ({ renderer: this.renderer, isWebGLFallback: this.isWebGLFallback } = await createRenderer(canvas));
    ({ pipeline: this.pipeline, bloom: this.bloom } = createPipeline(this.renderer, this.scene, this.rig.camera));

    this.createBodies();
    const earth = this.bodies.find((b) => b.data.id === 'earth') ?? this.bodies[0];
    // Primer frame: posiciones calculadas antes de colocar la cámara.
    layoutSystem(this.bodies, this.clock.timeMs, this.scale);

    this.orbit = new OrbitMode(earth, canvas, (x, y) => {
      const hit = pickBody(x, y, this.rig.camera, this.bodies, canvas.clientHeight);
      if (hit) this.focus(hit);
    });
    this.rig.setMode(this.orbit);

    this.hud = new Hud(hudEl, {
      bodies: this.bodies.map((b) => ({ id: b.data.id, name: b.data.name })),
      onSelectBody: (id) => this.focus(this.bodies.find((b) => b.data.id === id)!),
      onSlower: () => this.clock.slower(),
      onFaster: () => this.clock.faster(),
      onTogglePause: () => (this.clock.paused = !this.clock.paused),
      onNow: () => (this.clock.timeMs = Date.now()),
    });
    this.hud.setActiveBody(earth.data.id);
    this.bindKeys();
    this.bindPointer(canvas);

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
    this.orbit.focusOn(body, this.rig);
    this.hud.setActiveBody(body.data.id);
  }

  private createBodies(): void {
    const byId = new Map<string, CelestialBody>();
    for (const id of config.bodies) {
      const data = BODIES[id];
      const body = createBody(data, data.parent ? byId.get(data.parent) ?? null : null);
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
      const n = Number(e.key);
      if (n >= 1 && n <= this.bodies.length) this.focus(this.bodies[n - 1]);
      else if (e.key === ',') this.clock.slower();
      else if (e.key === '.') this.clock.faster();
      else if (e.key === ' ') this.clock.paused = !this.clock.paused;
      else if (e.key.toLowerCase() === 'n') this.clock.timeMs = Date.now();
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
    this.rig.update(dt);

    let pointer: THREE.Vector3 | null = null;
    if (this.pointerNdc) {
      this.rig.camera.updateMatrixWorld();
      this.pointerRaycaster.setFromCamera(this.pointerNdc, this.rig.camera);
      pointer = this.pointerRaycaster.ray.direction;
    }

    const ctx: FrameContext = {
      timeMs: this.clock.timeMs,
      dt,
      scale: this.scale,
      origin: this.origin,
      renderer: this.renderer,
      pointer,
      nowSeconds: now / 1000,
    };
    for (const body of this.bodies) body.update(ctx);

    this.pipeline.render();
    this.hud.render({
      focusName: this.orbit.focus.data.name,
      altitudeKm: this.orbit.altitudeKm,
      date: this.clock.date,
      timeLabel: this.clock.rateLabel,
      paused: this.clock.paused,
      fps: this.fps,
      backend: this.isWebGLFallback ? 'WebGL2' : 'WebGPU',
      particles: this.bodies.reduce((n, b) => n + b.particleCount, this.stars?.count ?? 0),
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
