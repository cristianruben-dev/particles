/**
 * Un nivel de detalle de un cuerpo: sus capas de partículas y los recursos de GPU que
 * ocupan. Ver docs/ARQUITECTURA.md §6.3.
 *
 * Cada cuerpo tiene un nivel ligero (vista previa, siempre en memoria) y uno completo que
 * se hornea al acercarse o enfocarlo y se libera al alejarse. Así la memoria y el tiempo
 * de carga dependen de lo que se visita, no del número de cuerpos.
 */
import type * as THREE from 'three/webgpu';
import { instancedArray, uniform } from 'three/tsl';
import { freeStorageBuffers } from '../particles/gpu';
import type { ParticleBuffer, ParticleField } from '../particles/ParticleField';
import type { FrameContext } from './CelestialBody';

export type TierKind = 'preview' | 'full';

export class DetailTier {
  /** 0 → 1 mientras las partículas se condensan. */
  readonly appear = uniform(0);
  /**
   * Capas que se aligeran con la distancia: fracción del nivel × `scale` (1 en las capas
   * esféricas; los anillos, con otra área y otro total, llevan la suya).
   */
  readonly fields: { field: ParticleField; scale: number }[] = [];
  /** Partículas de la capa principal: referencia de la fracción de detalle. */
  total = 1;
  /** Objetos que cuelgan del grupo que gira con el cuerpo o del cuerpo (sin giro). */
  readonly roots: { object: THREE.Object3D; spin: boolean }[] = [];
  /** Trabajo por frame del nivel (perturbación, deriva de nubes, flujos…). */
  readonly updates: ((ctx: FrameContext) => void)[] = [];

  private readonly buffers: ParticleBuffer[] = [];
  private readonly computes: THREE.ComputeNode[] = [];

  constructor(readonly kind: TierKind) {}

  /** Buffer vec4 por partícula, registrado para liberarlo con el nivel. */
  buffer(data: Float32Array | number): ParticleBuffer {
    const b = instancedArray(data, 'vec4');
    this.buffers.push(b);
    return b;
  }

  /** Registra buffers creados fuera (p. ej. por `Disturbance`). */
  track(buffers: readonly ParticleBuffer[], computes: readonly THREE.ComputeNode[] = []): void {
    this.buffers.push(...buffers);
    this.computes.push(...computes);
  }

  /** `lodScale` = 0: la capa no se aligera. */
  addField(field: ParticleField, spin: boolean, lodScale = 1): void {
    this.roots.push({ object: field.object, spin });
    if (lodScale > 0) this.fields.push({ field, scale: lodScale });
  }

  /** Visible el nivel entero (una capa puede ocultarse aparte, como el globo bajo la superficie). */
  visible = true;

  setVisible(visible: boolean): void {
    this.visible = visible;
    for (const r of this.roots) r.object.visible = visible;
  }

  dispose(renderer: THREE.WebGPURenderer): void {
    for (const r of this.roots) {
      r.object.removeFromParent();
      const material = (r.object as THREE.Mesh).material as THREE.Material | undefined;
      material?.dispose();
    }
    for (const c of this.computes) c.dispose();
    freeStorageBuffers(renderer, this.buffers);
  }
}
