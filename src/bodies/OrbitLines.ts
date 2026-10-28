/**
 * Órbitas hechas de partículas: puntos a lo largo de la trayectoria real de cada cuerpo,
 * más brillantes justo detrás de él, como una estela. Ver docs/ARQUITECTURA.md §8.
 *
 * Los puntos se muestrean en el tiempo (una vuelta hacia atrás) con las mismas
 * efemérides que mueven el cuerpo, en km relativos al padre, y pasan a escena en el
 * shader con `ScaleSystem.distanceNode`: siguen la transición entre escalas sin recalcular.
 */
import * as THREE from 'three/webgpu';
import { float, fract, instanceIndex, length, smoothstep, uniform, vec3, vec4 } from 'three/tsl';
import { positionRelativeToParent } from '../astro/ephemeris';
import { eclToScene, length3d } from '../astro/frames';
import { projectedRadiusPx } from '../particles/LodManager';
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
  return 384_400; // la Luna
}

/** Periodo aproximado (días) para muestrear una vuelta. */
function periodDays(body: CelestialBody): number {
  const d = body.data;
  if (d.orbit) return 365.25 * Math.pow(d.orbit.a.value, 1.5);
  if (d.satellite) return 360 / d.satellite.meanMotion;
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
    material.colorNode = vec4(vec3(c.r, c.g, c.b).mul(trail).mul(near).mul(this.fade).mul(orbitLook.brightness).mul(0.5), 1);
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
    this.field.object.visible = this.fade.value > 0;
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

export class OrbitLines {
  readonly group = new THREE.Group();
  private readonly orbits: Orbit[];
  visible = true;

  constructor(bodies: readonly CelestialBody[], scale: ScaleSystem) {
    this.orbits = bodies
      .filter((b) => b.parent)
      .map((b) => new Orbit(b, scale, b.parent!.parent ? 360 : 1500));
    for (const o of this.orbits) this.group.add(o.field.object);
  }

  update(ctx: FrameContext): void {
    this.group.visible = this.visible;
    if (!this.visible) return;
    for (const o of this.orbits) o.update(ctx);
  }
}
