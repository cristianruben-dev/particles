/**
 * Quadtree de superficie sobre las 6 caras del cubo. Ver docs/ARQUITECTURA.md §7.1.
 *
 * Solo guarda la estructura y la geometría de cada nodo (en float64). Qué nodos se
 * dividen, cuáles tienen chunk y cuándo se generan lo decide `Surface`.
 */
import { cubeToSphere, faceOfDirection, nodeCenter, type CubeFace } from './cubeSphere';
import type { SurfaceChunk } from './SurfaceChunk';

export interface QuadNode {
  face: CubeFace;
  depth: number;
  /** Índice del nodo en su cara a esta profundidad (0 … 2^depth − 1). */
  iu: number;
  iv: number;
  /** Dirección del centro (unitaria, float64). */
  center: [number, number, number];
  /** Medio ángulo que abarca (rad), con margen para las esquinas. */
  halfAngle: number;
  parent: QuadNode | null;
  children: QuadNode[] | null;
  chunk: SurfaceChunk | null;
  /** Altura del terreno en el centro y máxima (centro y esquinas), en radios; se calculan una vez. */
  height?: number;
  maxHeight?: number;
}

/** Direcciones de las 4 esquinas de un nodo (para estimar su altura máxima). */
export function nodeCorners(n: QuadNode): [number, number, number][] {
  const size = 2 / 2 ** n.depth;
  const u0 = -1 + n.iu * size, v0 = -1 + n.iv * size;
  return [[0, 0], [1, 0], [0, 1], [1, 1]].map(([a, b]) => cubeToSphere(n.face, u0 + a * size, v0 + b * size));
}

export function createNode(face: CubeFace, depth: number, iu: number, iv: number, parent: QuadNode | null): QuadNode {
  const c = nodeCenter(depth, iu, iv);
  return {
    face, depth, iu, iv,
    center: cubeToSphere(face, c.u, c.v),
    // La cara abarca π/2: medio lado π/4 · 2^−d, por √2 en la diagonal y algo de distorsión.
    halfAngle: ((Math.PI / 4) * 2 ** -depth) * 1.45,
    parent,
    children: null,
    chunk: null,
  };
}

export class CubeSphereQuadtree {
  readonly roots: QuadNode[] = ([0, 1, 2, 3, 4, 5] as CubeFace[]).map((f) => createNode(f, 0, 0, 0, null));

  /** Crea los 4 hijos de un nodo (sin chunks). */
  split(node: QuadNode): QuadNode[] {
    const d = node.depth + 1;
    node.children = [
      [0, 0], [1, 0], [0, 1], [1, 1],
    ].map(([du, dv]) => createNode(node.face, d, node.iu * 2 + du, node.iv * 2 + dv, node));
    return node.children;
  }

  /** Hoja que contiene una dirección (la del suelo bajo la cámara). */
  leafAt(x: number, y: number, z: number): QuadNode {
    const { face, u, v } = faceOfDirection(x, y, z);
    let node = this.roots[face];
    while (node.children) {
      const d = node.depth + 1, cells = 2 ** d;
      const iu = Math.min(cells - 1, Math.floor(((u + 1) / 2) * cells));
      const iv = Math.min(cells - 1, Math.floor(((v + 1) / 2) * cells));
      node = node.children[(iv - node.iv * 2) * 2 + (iu - node.iu * 2)];
    }
    return node;
  }

  /** Recorre todos los nodos (primero en profundidad). */
  *nodes(): Generator<QuadNode> {
    const stack = [...this.roots];
    while (stack.length) {
      const n = stack.pop()!;
      yield n;
      if (n.children) stack.push(...n.children);
    }
  }
}
