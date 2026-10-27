/**
 * Un parche de superficie con N×N partículas generadas en GPU. Ver docs/ARQUITECTURA.md §7.2.
 */
import type { QuadNode } from './CubeSphereQuadtree';

export class SurfaceChunk {
  node: QuadNode | null = null;

  // TODO(fase 3): compute que, para el nodo asignado:
  //   1. genera rejilla N×N con jitter en la cara y proyecta con cubeToSphere
  //   2. altura = heightmap real + fBm procedural escalado al tamaño del chunk
  //   3. color = albedo + variación por pendiente/altura
  //   4. guarda posiciones relativas al centro del chunk (precisión, §4.2)

  assign(node: QuadNode): void {
    this.node = node;
  }

  release(): void {
    this.node = null;
  }
}
