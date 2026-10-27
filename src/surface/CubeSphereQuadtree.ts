/**
 * Quadtree de superficie sobre las 6 caras del cubo. Ver docs/ARQUITECTURA.md §7.
 */
import { config } from '../config';
import type { CubeFace } from './cubeSphere';

export interface QuadNode {
  face: CubeFace;
  depth: number;
  /** Centro del nodo en la cara, en [−1, 1]². */
  u: number;
  v: number;
  /** Medio lado del nodo en coordenadas de cara. */
  halfSize: number;
  children: QuadNode[] | null;
}

export class CubeSphereQuadtree {
  readonly roots: QuadNode[];

  /** Subdividir si tamañoChunk / distancia > splitThreshold. */
  splitThreshold = 1.0;
  /** Histéresis para fusionar: evita parpadeo en el límite. */
  mergeHysteresis = 0.7;

  constructor(readonly radiusKm: number) {
    this.roots = ([0, 1, 2, 3, 4, 5] as CubeFace[]).map((face) => ({
      face, depth: 0, u: 0, v: 0, halfSize: 1, children: null,
    }));
  }

  /** Divide un nodo en 4 hijos. */
  split(node: QuadNode): void {
    if (node.children || node.depth >= config.surfaceMaxDepth) return;
    const h = node.halfSize / 2;
    node.children = [
      [-1, -1], [1, -1], [-1, 1], [1, 1],
    ].map(([su, sv]) => ({
      face: node.face, depth: node.depth + 1,
      u: node.u + su * h, v: node.v + sv * h, halfSize: h, children: null,
    }));
  }

  // TODO(fase 3): update(cameraLocalKm) → recorrer, dividir y fusionar según splitThreshold/mergeHysteresis.
  // TODO(fase 3): emitir altas/bajas de hojas hacia ChunkPool.
}
