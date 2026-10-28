/**
 * Pool de chunks: buffers de GPU con hueco para `capacity` chunks de N×N partículas,
 * reservados al activar la superficie y liberados al salir. Ver docs/ARQUITECTURA.md §7.3.
 *
 * Los chunks no crean ni destruyen buffers en caliente: ocupan y sueltan huecos.
 */
import * as THREE from 'three/webgpu';
import { storage } from 'three/tsl';
import { freeStorageBuffers } from '../particles/gpu';
import type { ParticleBuffer } from '../particles/ParticleField';

export class ChunkPool {
  /** Desplazamiento respecto al centro del chunk (xyz, radios) y lo que sube la última octava fina (w). */
  readonly offset: THREE.StorageInstancedBufferAttribute;
  /** Albedo lineal (rgb); agua + 256 × luces nocturnas, 8 bits cada una (w). */
  readonly color: THREE.StorageInstancedBufferAttribute;
  /** Normal del terreno en el espacio del cuerpo, con y sin la última octava (octaédricas: xy y zw). */
  readonly normal: THREE.StorageInstancedBufferAttribute;
  private readonly free: number[] = [];

  constructor(readonly capacity: number, readonly particlesPerChunk: number) {
    const count = capacity * particlesPerChunk;
    this.offset = new THREE.StorageInstancedBufferAttribute(count, 4);
    this.color = new THREE.StorageInstancedBufferAttribute(count, 4);
    this.normal = new THREE.StorageInstancedBufferAttribute(count, 4);
    for (let i = capacity - 1; i >= 0; i--) this.free.push(i);
  }

  get available(): number {
    return this.free.length;
  }

  acquire(): number | null {
    return this.free.pop() ?? null;
  }

  release(slot: number): void {
    this.free.push(slot);
  }

  /** Nodo de escritura (compute) o de solo lectura (vértices) sobre uno de los buffers. */
  node(attribute: THREE.StorageInstancedBufferAttribute, readOnly: boolean): ParticleBuffer {
    const n = storage(attribute, 'vec4', attribute.count);
    return (readOnly ? n.toReadOnly() : n) as ParticleBuffer;
  }

  dispose(renderer: THREE.WebGPURenderer): void {
    freeStorageBuffers(renderer, [this.offset, this.color, this.normal].map((a) => storage(a, 'vec4', a.count) as ParticleBuffer));
  }
}
