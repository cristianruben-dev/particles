/**
 * Perturbación con el ratón: cada partícula cuelga de un muelle sobre su posición de
 * reposo. El cursor empuja las cercanas (cada una en una dirección algo distinta, para
 * que se "desordenen") y luego vuelven con un pequeño rebote. Ver docs/ARQUITECTURA.md §6.4.
 *
 * Es la primera simulación con estado: desplazamiento y velocidad viven en buffers de GPU
 * y una pasada compute los integra cada frame, solo mientras hay algo que mover.
 */
import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { Fn, hash, instanceIndex, instancedArray, max, smoothstep, uniform, vec3, vec4 } from 'three/tsl';
import type { FloatNode, Vec3Node } from './nodes';
import type { ParticleBuffer } from './ParticleField';

/** Parámetros de la interacción (ajustables desde el panel de debug). */
export const disturbanceLook = {
  /** Radio de influencia del cursor, en píxeles CSS. */
  radiusPx: 90,
  /** Desplazamiento máximo, como fracción del radio de influencia. */
  strength: uniform(0.5),
  /** Rigidez del muelle (1/s²): cuánto tiran de vuelta a su sitio. */
  stiffness: uniform(28),
  /** Amortiguación (1/s): menos = más rebote. */
  damping: uniform(5.5),
  /** Cuánto se desordena cada partícula respecto al empuje común (0–1). */
  disorder: uniform(1.6),
};

/** Segundos que se sigue simulando tras perder el cursor (hasta que todo se asienta). */
const SETTLE_SECONDS = 4;

/** Rayo del cursor en el espacio local de una capa de partículas. */
export interface LocalRay {
  origin: THREE.Vector3;
  direction: THREE.Vector3;
  /** Radio de influencia en unidades locales. */
  radius: number;
  /** Intensidad del empuje (0–1): se apaga en los cuerpos pequeños en pantalla. */
  gain: number;
}

/** Para capas que no son una esfera centrada (los chunks de la superficie). */
export interface DisturbanceOptions {
  /** Origen del rayo para la partícula `i` (si no, el de `update`). */
  origin?: (index: typeof instanceIndex) => Vec3Node;
  /** Hacia fuera de la superficie en la partícula `i` (si no, la dirección de su reposo). */
  outward?: (index: typeof instanceIndex) => Vec3Node;
}

export class Disturbance {
  private readonly offset: ParticleBuffer;
  private readonly velocity: ParticleBuffer;
  private readonly rayOrigin = uniform(new THREE.Vector3());
  private readonly rayDirection = uniform(new THREE.Vector3(0, 0, -1));
  private readonly radius = uniform(0.1);
  /** Intensidad mientras el cursor está encima (`LocalRay.gain`); 0 deja que todo vuelva a su sitio. */
  private readonly push = uniform(0);
  private readonly dt = uniform(1 / 60);
  private readonly step: THREE.ComputeNode;
  private activeUntil = 0;
  /** Partículas que se simulan: el mayor prefijo dibujado desde que llegó el cursor. */
  private extent = 0;

  /**
   * @param rest posición de reposo (espacio local) de la partícula `i`, leída de sus buffers.
   */
  constructor(private readonly count: number, rest: (index: typeof instanceIndex) => Vec3Node, options: DisturbanceOptions = {}) {
    this.offset = instancedArray(count, 'vec4');
    this.velocity = instancedArray(count, 'vec4');

    this.step = Fn(() => {
      const off = this.offset.element(instanceIndex);
      const vel = this.velocity.element(instanceIndex);
      const base = rest(instanceIndex);
      const p = base.add(off.xyz);

      // Distancia de la partícula al rayo del cursor.
      const rel = p.sub(options.origin ? options.origin(instanceIndex) : this.rayOrigin);
      const along = max(rel.dot(this.rayDirection), 0);
      const away = rel.sub(this.rayDirection.mul(along));
      const dist = away.length();
      const falloff = smoothstep(1, 0, dist.div(this.radius)).mul(this.push) as FloatNode;

      // Dirección: fuera del rayo, algo hacia fuera de la superficie y un desorden propio.
      const seed = instanceIndex.toFloat();
      const jitter = vec3(hash(seed), hash(seed.add(7.1)), hash(seed.add(13.7))).sub(0.5).mul(2);
      const direction = away
        .div(max(dist, 1e-6))
        .add((options.outward ? options.outward(instanceIndex) : base.normalize()).mul(0.8))
        .add(jitter.mul(disturbanceLook.disorder))
        .normalize();

      // Muelle amortiguado (Euler semi-implícito). En equilibrio, el empuje desplaza
      // strength · radio · falloff.
      const force = direction.mul(falloff).mul(disturbanceLook.strength).mul(this.radius).mul(disturbanceLook.stiffness);
      const accel = force.sub(off.xyz.mul(disturbanceLook.stiffness)).sub(vel.xyz.mul(disturbanceLook.damping));
      const v = vel.xyz.add(accel.mul(this.dt));
      vel.assign(vec4(v, 0));
      off.assign(vec4(off.xyz.add(v.mul(this.dt)), 0));
    })().compute(count);
  }

  /** Buffers y pasada compute, para liberarlos con el nivel de detalle. */
  get resources(): { buffers: ParticleBuffer[]; computes: THREE.ComputeNode[] } {
    return { buffers: [this.offset, this.velocity], computes: [this.step] };
  }

  /** Desplazamiento actual, para sumarlo a la posición de reposo en el material. */
  offsetNode(): Vec3Node {
    return this.offset.toAttribute().xyz;
  }

  /** Desplazamiento de la partícula `index` (cuando el material no la recorre en orden). */
  offsetAt(index: Node<'uint'>): Vec3Node {
    return this.offset.element(index).xyz;
  }

  /**
   * @param ray rayo del cursor en el espacio local de la capa, o null si no está encima.
   * @param drawn partículas que dibuja la capa (prefijo, §6.3).
   */
  update(renderer: THREE.WebGPURenderer, ray: LocalRay | null, dt: number, nowSeconds: number, drawn = this.count): void {
    if (ray) {
      this.activeUntil = nowSeconds + SETTLE_SECONDS;
      this.rayOrigin.value.copy(ray.origin);
      this.rayDirection.value.copy(ray.direction);
      this.radius.value = ray.radius;
    }
    this.push.value = ray ? ray.gain : 0;
    if (nowSeconds > this.activeUntil) {
      // Ya asentadas (en 4 s el muelle se queda en 10⁻⁵ del empuje): se empieza de cero.
      this.extent = 0;
      return;
    }
    // Solo el prefijo dibujado (con la Tierra a 300 px, 82.000 de 1,2 millones). Las de fuera
    // nunca se empujan, y las que salen del prefijo a mitad siguen dentro hasta asentarse.
    this.extent = Math.min(this.count, Math.max(this.extent, drawn));
    this.dt.value = Math.min(dt, 1 / 30);
    renderer.compute(this.step, this.extent);
  }
}
