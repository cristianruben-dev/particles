/**
 * Gigantes gaseosos: bandas por latitud y vórtices. Ver docs/ARQUITECTURA.md §8.
 */
import { BaseBody } from './BaseBody';

export class GasGiant extends BaseBody {
  readonly ready = Promise.resolve();

  // TODO(fase 2): compute que desplaza partículas en longitud con velocidad f(latitud).
  // TODO(fase 2): vórtices con curl noise (Gran Mancha Roja).
  // TODO(fase 3): descenso entre capas de nubes volumétricas.

  dispose(): void {}
}
