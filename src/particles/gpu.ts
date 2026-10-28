/**
 * Liberar memoria de GPU. Ver docs/ARQUITECTURA.md §6.3 (detalle bajo demanda).
 *
 * three r186 no tiene API pública para soltar buffers de almacenamiento:
 * `BufferAttribute.dispose()` solo emite un evento que nadie escucha para ellos.
 * Usamos el registro interno de atributos del renderer, aislado en esta función
 * (si cambia en otra versión de three, solo hay que tocar aquí).
 * Se comprueba con `renderer.info.memory.storageAttributesSize`.
 */
import type * as THREE from 'three/webgpu';
import type { ParticleBuffer } from './ParticleField';

interface AttributeRegistry {
  delete(attribute: unknown): unknown;
}

export function freeStorageBuffers(renderer: THREE.WebGPURenderer, buffers: readonly ParticleBuffer[]): void {
  const registry = (renderer as unknown as { _attributes?: AttributeRegistry })._attributes;
  if (!registry) return;
  for (const b of buffers) registry.delete(b.value);
}
