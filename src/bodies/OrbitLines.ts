/**
 * Órbitas hechas de partículas: puntos a lo largo de la trayectoria real de cada cuerpo,
 * más brillantes justo detrás de él, como una estela. Ver docs/ARQUITECTURA.md §8.
 *
 * Los puntos se muestrean en el tiempo (una vuelta hacia atrás) con las mismas
 * efemérides que mueven el cuerpo, en km relativos al padre, y pasan a escena en el
 * shader con `ScaleSystem.distanceNode`: siguen la transición entre escalas sin recalcular.
 */
import * as THREE from 'three/webgpu';
import { float, fract, instanceIndex, length, modelWorldMatrix, smoothstep, step, uniform, vec3, vec4 } from 'three/tsl';
import { horizonMask } from '../core/Horizon';
import { COMET_ELEMENTS, anomalyAtDistance, cometElementsAt, cometOrbitPoint, cometPeriodDays, jdToMs, type CometElements } from '../astro/comets';
import { positionRelativeToParent } from '../astro/ephemeris';
import { eclToScene, length3d } from '../astro/frames';
import { projectedRadiusPx } from '../particles/LodManager';
import { AU_KM } from '../astro/units';
import { pixelAngle, softDisc } from '../particles/nodes';
import { ParticleField, vec4Buffer, type ParticleBuffer } from '../particles/ParticleField';
import type { ScaleSystem } from '../scale/ScaleSystem';
import type { CelestialBody, FrameContext } from './CelestialBody';

export const orbitLook = {
  brightness: uniform(1),
};

const MS_PER_DAY = 86_400_000;

/** Semieje mayor aproximado (km), para saber cuánto ocupa la órbita en pantalla. */
function semiMajorKm(body: CelestialBody): number {
  const d = body.data;
  if (d.orbit) return d.orbit.a.value * 149_597_870.7;
  if (d.satellite) return d.satellite.a;
  if (d.kind === 'station') return 6_790;
  return 384_400; // la Luna
}

/** Periodo aproximado (días) para muestrear una vuelta. */
function periodDays(body: CelestialBody): number {
  const d = body.data;
  if (d.orbit) return 365.25 * Math.pow(d.orbit.a.value, 1.5);
  if (d.satellite) return 360 / d.satellite.meanMotion;
  if (d.kind === 'station') return d.rotationPeriodH / 24;
  return 27.32; // la Luna
}

class Orbit {
  readonly field: ParticleField;
  private readonly buffer: ParticleBuffer;
  private readonly data: Float32Array;
  private readonly period: number;
  private sampledAt = -Infinity;
  /** Días desde el muestreo (pequeño: cabe en float32). */
  private readonly since = uniform(0);
  /** Posición actual del cuerpo respecto al padre (escena) y su radio: allí se apaga la línea. */
  private readonly bodyLocal = uniform(new THREE.Vector3());
  private readonly bodyRadius = uniform(1);
  /** 0–1: una órbita diminuta en pantalla (lunas vistas de lejos) se apaga. */
  private readonly fade = uniform(1);
  private readonly semiMajorKm: number;

  constructor(readonly body: CelestialBody, scale: ScaleSystem, readonly count: number) {
    this.period = periodDays(body);
    this.semiMajorKm = semiMajorKm(body);
    this.data = new Float32Array(count * 4);
    this.buffer = vec4Buffer(this.data);
    const attr = this.buffer.toAttribute();
    const parent = body.parent!;

    // (dirección en escena xyz, distancia km w); el índice da el tiempo de cada punto.
    const local = attr.xyz.mul(scale.distanceNode(parent.data, attr.w));
    this.field = new ParticleField(count, 'additive');
    const material = this.field.material;
    material.sizeAttenuation = false;
    material.positionNode = local;
    material.scaleNode = pixelAngle.mul(1.6);

    // Edad del punto (0 = donde está el cuerpo, 1 = una vuelta atrás).
    const index = instanceIndex.toFloat();
    const age = fract(float(1).sub(index.div(count)).add(this.since.div(this.period)));
    const trail = float(1).sub(age).pow(2).mul(0.85).add(0.15);
    // Se apaga cerca del cuerpo para no cruzar su disco.
    const near = smoothstep(this.bodyRadius.mul(1.3), this.bodyRadius.mul(3), length(local.sub(this.bodyLocal)));
    const c = new THREE.Color(body.data.color).lerp(new THREE.Color(0xffffff), 0.35);
    const world = modelWorldMatrix.mul(vec4(local, 1)).xyz;
    material.colorNode = vec4(vec3(c.r, c.g, c.b).mul(trail).mul(near).mul(this.fade).mul(orbitLook.brightness).mul(horizonMask(world)).mul(0.5), 1);
    material.opacityNode = softDisc();
  }

  update(ctx: FrameContext): void {
    const parent = this.body.parent!;
    ctx.origin.place(this.field.object, parent.sceneD);
    const days = (ctx.timeMs - this.sampledAt) / MS_PER_DAY;
    // Remuestrear cada 1/16 de vuelta (o tras un salto de fecha).
    if (days < 0 || days > this.period / 16) this.sample(ctx.timeMs);
    this.since.value = (ctx.timeMs - this.sampledAt) / MS_PER_DAY;

    const b = this.body.sceneD, p = parent.sceneD;
    this.bodyLocal.value.set(b.x - p.x, b.y - p.y, b.z - p.z);
    this.bodyRadius.value = this.body.sceneRadius;
    const orbitPx = projectedRadiusPx(ctx.scale.localDistance(parent.data, this.semiMajorKm), this.field.object.position.length());
    this.fade.value = THREE.MathUtils.smoothstep(orbitPx, 25, 70);
    // Sin el cuerpo (la ISS antes de 1998 o con el reloj muy rápido), sin su órbita.
    this.field.object.visible = this.fade.value > 0 && this.body.object3d.visible;
  }

  private sample(timeMs: number): void {
    this.sampledAt = timeMs;
    const stepMs = (this.period * MS_PER_DAY) / this.count;
    for (let i = 0; i < this.count; i++) {
      // i = count − 1 es el presente; i = 0, una vuelta atrás.
      const rel = positionRelativeToParent(this.body.data, timeMs - (this.count - 1 - i) * stepMs);
      const d = length3d(rel);
      const dir = eclToScene(rel);
      this.data.set([dir.x / d, dir.y / d, dir.z / d, d], i * 4);
    }
    this.buffer.value.needsUpdate = true;
  }
}

/** Hasta dónde se dibuja la órbita de un cometa (UA): la del Hale-Bopp llega a 370. */
const COMET_ORBIT_MAX_AU = 50;
const COMET_ORBIT_POINTS = 900;
/** Días de estela brillante detrás de un cometa. */
const COMET_TRAIL_DAYS = 240;

/**
 * Órbita de un cometa: dos cuerpos con los elementos de la aparición más cercana (los
 * periódicos cambian de una vuelta a otra, y entonces se rehacen los puntos), repartidos por
 * la anomalía y no por el tiempo (cerca del Sol pasa en pocos días: por tiempo quedarían cinco
 * puntos en el perihelio). Cada punto guarda sus días respecto al perihelio para la estela.
 */
class CometOrbit {
  readonly field: ParticleField;
  /** Días desde el perihelio, reducidos en la CPU (en las cerradas, a ±medio periodo). */
  private readonly nowDays = uniform(0);
  private readonly bodyLocal = uniform(new THREE.Vector3());
  private readonly bodyRadius = uniform(1);
  private readonly fade = uniform(1);
  /** Periodo de la aparición actual (días; 0 si la órbita no es cerrada). */
  private readonly period = uniform(0);
  private readonly points: ParticleBuffer;
  private readonly days: ParticleBuffer;
  /** Perihelio de la aparición dibujada (día juliano). */
  private tpJd = NaN;
  private qKm = 0;

  constructor(readonly body: CelestialBody, scale: ScaleSystem) {
    const count = COMET_ORBIT_POINTS;
    this.points = vec4Buffer(new Float32Array(count * 4));
    this.days = vec4Buffer(new Float32Array(count * 4));
    this.fill(COMET_ELEMENTS[body.data.comet!]);
    const attr = this.points.toAttribute();
    const local = attr.xyz.mul(scale.distanceNode(body.parent!.data, attr.w));
    this.field = new ParticleField(count, 'additive');
    const material = this.field.material;
    material.sizeAttenuation = false;
    material.positionNode = local;
    material.scaleNode = pixelAngle.mul(1.5);

    // Estela: los puntos por los que pasó hace poco, más brillantes.
    const P = this.period;
    const raw = this.nowDays.sub(this.days.toAttribute().x);
    const age = P.greaterThan(0).select(raw.add(P.mul(1.5)).mod(P.max(1)).sub(P.mul(0.5)), raw);
    const trail = float(1).sub(smoothstep(0, COMET_TRAIL_DAYS, age)).mul(step(0, age)).mul(0.8).add(0.18);
    const near = smoothstep(this.bodyRadius.mul(1.3), this.bodyRadius.mul(3), length(local.sub(this.bodyLocal)));
    const c = new THREE.Color(body.data.color).lerp(new THREE.Color(0xffffff), 0.3);
    const world = modelWorldMatrix.mul(vec4(local, 1)).xyz;
    material.colorNode = vec4(vec3(c.r, c.g, c.b).mul(trail).mul(near).mul(this.fade).mul(orbitLook.brightness).mul(horizonMask(world)).mul(0.42), 1);
    material.opacityNode = softDisc();
  }

  /** Puntos de la órbita de unos elementos (en los buffers ya creados). */
  private fill(el: CometElements): void {
    const count = COMET_ORBIT_POINTS;
    const points = this.points.value.array as Float32Array, days = this.days.value.array as Float32Array;
    const span = anomalyAtDistance(el, COMET_ORBIT_MAX_AU);
    for (let i = 0; i < count; i++) {
      const { position, days: d } = cometOrbitPoint(el, -span + (2 * span * i) / (count - 1));
      const r = length3d(position);
      const dir = eclToScene(position);
      points.set([dir.x / r, dir.y / r, dir.z / r, r], i * 4);
      days[i * 4] = d;
    }
    this.points.value.needsUpdate = true;
    this.days.value.needsUpdate = true;
    this.tpJd = el.tpJd;
    this.qKm = el.q * AU_KM;
    this.period.value = cometPeriodDays(el) ?? 0;
  }

  update(ctx: FrameContext): void {
    const parent = this.body.parent!;
    ctx.origin.place(this.field.object, parent.sceneD);
    const el = cometElementsAt(this.body.data.comet!, ctx.timeMs);
    if (el.tpJd !== this.tpJd) this.fill(el);
    // Días desde el perihelio de la aparición más cercana (los puntos, desde el suyo).
    const P = this.period.value;
    let d = (ctx.timeMs - jdToMs(el.tpJd)) / MS_PER_DAY;
    if (P) d = ((d % P) + P * 1.5) % P - P * 0.5;
    this.nowDays.value = d;
    const b = this.body.sceneD, p = parent.sceneD;
    this.bodyLocal.value.set(b.x - p.x, b.y - p.y, b.z - p.z);
    this.bodyRadius.value = this.body.sceneRadius;
    const orbitPx = projectedRadiusPx(ctx.scale.localDistance(parent.data, this.qKm * 3), this.field.object.position.length());
    this.fade.value = THREE.MathUtils.smoothstep(orbitPx, 25, 70);
    this.field.object.visible = this.fade.value > 0 && this.body.object3d.visible;
  }
}

export class OrbitLines {
  readonly group = new THREE.Group();
  private readonly orbits: (Orbit | CometOrbit)[];
  visible = true;

  constructor(bodies: readonly CelestialBody[], scale: ScaleSystem) {
    this.orbits = bodies
      .filter((b) => b.parent)
      .map((b) => (b.data.comet ? new CometOrbit(b, scale) : new Orbit(b, scale, b.parent!.parent ? 360 : 1500)));
    for (const o of this.orbits) this.group.add(o.field.object);
  }

  update(ctx: FrameContext): void {
    this.group.visible = this.visible;
    if (!this.visible) return;
    for (const o of this.orbits) o.update(ctx);
  }
}
