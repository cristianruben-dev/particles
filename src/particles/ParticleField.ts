/**
 * Un conjunto de partículas dibujado como sprites instanciados. Ver docs/ARQUITECTURA.md §6.1.
 *
 * Los datos por partícula viven en buffers de almacenamiento (`instancedArray`), que
 * pueden rellenarse desde la CPU (fase 1, horneado en worker) o desde compute shaders
 * (fase 3, chunks de superficie). El material lo construye cada cuerpo con TSL.
 *
 * Las partículas vienen en orden progresivo (cualquier prefijo es uniforme), así que el
 * nivel de detalle consiste en dibujar solo las N primeras y agrandar cada una (§6.3).
 */
import * as THREE from 'three/webgpu';
import { instancedArray, uniform } from 'three/tsl';
import { coveringSize, particleLook } from './LodManager';

export type ParticleBuffer = THREE.StorageBufferNode<'vec4'>;

/** Crea un buffer vec4 por partícula a partir de datos ya empaquetados (count × 4). */
export const vec4Buffer = (data: Float32Array): ParticleBuffer => instancedArray(data, 'vec4');

export type MaterialStyle = 'solid' | 'additive' | 'translucent';

export function createParticleMaterial(style: MaterialStyle): THREE.SpriteNodeMaterial {
  switch (style) {
    // Recorte por alphaTest con profundidad: sin ordenar, la cara oculta no se transparenta.
    case 'solid':
      return new THREE.SpriteNodeMaterial({ transparent: false, alphaTest: 0.5 });
    // Emisivo: se acumula la luz, no escribe profundidad.
    case 'additive':
      return new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    // Nubes y velos: mezcla normal sin escribir profundidad.
    case 'translucent':
      return new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false });
  }
}

export class ParticleField {
  readonly object: THREE.Sprite;
  /**
   * Tamaño de sprite (relativo al radio) que cubre la esfera con las partículas
   * visibles. Usarlo en `scaleNode`; se actualiza con `setVisibleFraction`.
   */
  readonly size = uniform(1);

  /**
   * @param count partículas totales.
   * @param overlap tamaño del sprite respecto a la separación media (< 1 deja aire entre
   *   puntos; 0 = tamaño fijo).
   */
  constructor(
    readonly count: number,
    style: MaterialStyle,
    private readonly overlap = 0,
  ) {
    this.object = new THREE.Sprite(createParticleMaterial(style));
    this.object.count = count;
    // El tamaño real lo decide el shader: el culling por esfera del sprite no aplica.
    this.object.frustumCulled = false;
    if (overlap) this.size.value = coveringSize(count, overlap) * particleLook.dotScale;
  }

  get material(): THREE.SpriteNodeMaterial {
    return this.object.material as THREE.SpriteNodeMaterial;
  }

  /** Dibuja solo una fracción (prefijo) de las partículas. */
  setVisibleFraction(fraction: number, minCount = 2000): void {
    const n = Math.min(this.count, Math.max(minCount, Math.ceil(this.count * fraction)));
    this.object.count = n;
    if (this.overlap) this.size.value = coveringSize(n, this.overlap) * particleLook.dotScale;
  }

  dispose(): void {
    this.object.material.dispose();
  }
}
