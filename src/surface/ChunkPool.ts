/**
 * Pool de chunks reutilizables y cola de generación. Ver docs/ARQUITECTURA.md §7.3.
 */
import { SurfaceChunk } from './SurfaceChunk';

export class ChunkPool {
  private readonly free: SurfaceChunk[] = [];

  constructor(capacity: number) {
    for (let i = 0; i < capacity; i++) this.free.push(new SurfaceChunk());
  }

  acquire(): SurfaceChunk | null {
    return this.free.pop() ?? null;
  }

  release(chunk: SurfaceChunk): void {
    chunk.release();
    this.free.push(chunk);
  }

  // TODO(fase 3): cola con prioridad por distancia a la cámara y límite de generaciones por frame.
}
