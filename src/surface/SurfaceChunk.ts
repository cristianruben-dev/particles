/**
 * Un parche de superficie: N×N partículas en un hueco del pool. Ver docs/ARQUITECTURA.md §7.2.
 *
 * El sprite cuelga del grupo que gira con el cuerpo y se coloca en el centro del chunk
 * (posición calculada en float64): las partículas guardan su desplazamiento respecto a él
 * y conservan la precisión aunque midan centímetros.
 */
import * as THREE from 'three/webgpu';
import type { QuadNode } from './CubeSphereQuadtree';

export class SurfaceChunk {
  readonly object: THREE.Sprite;
  /** 0 → 1 al aparecer; 1 → 0 al retirarse (el padre se funde mientras llegan los hijos). */
  appear = 0;
  retiring = false;

  constructor(
    readonly node: QuadNode,
    readonly slot: number,
    material: THREE.SpriteNodeMaterial,
    private readonly particles: number,
    /** Separación entre partículas con el chunk completo (radios). */
    spacing: number,
  ) {
    this.object = new THREE.Sprite(material);
    this.object.count = particles;
    this.object.frustumCulled = false;
    this.object.userData = { slotBase: slot * particles, spacing, appear: 0 };
  }

  /** Dibuja como mucho una fracción (prefijo) de las partículas; el shader decide cuáles. */
  setDensity(fraction: number): void {
    this.object.count = Math.max(64, Math.ceil(this.particles * fraction));
  }

  setAppear(value: number): void {
    this.appear = value;
    this.object.userData.appear = value;
  }
}
