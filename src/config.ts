/**
 * Presupuestos y flags globales. Ver docs/ARQUITECTURA.md §6.3 y §12.
 */
import type { BodyId } from './astro/bodies';

export const config = {
  /** Cuerpos activos, cada padre antes que sus hijos. Fase 1: Sol, Tierra y Luna. */
  bodies: ['sun', 'earth', 'moon'] as BodyId[],

  /** Partículas máximas en escena con backend WebGPU. */
  particleBudgetWebGPU: 4_000_000,
  /** Con WebGL2 el presupuesto se reduce (sin compute nativo). */
  particleBudgetWebGL: 2_000_000,

  /** Umbrales de LOD en píxeles de radio proyectado. */
  lod: {
    pointMaxPx: 4,
    cloudMaxPx: 150,
  },

  /** Partículas por lado de un chunk de superficie (N×N). */
  surfaceChunkResolution: 128,
  /** Profundidad máxima del quadtree de superficie. */
  surfaceMaxDepth: 15,

  /** Límite de densidad de píxeles. Por debajo de la nativa la imagen se reescala y se ve borrosa. */
  maxPixelRatio: 2,

  /** Panel de debug activado con ?debug en la URL. */
  debug: new URLSearchParams(location.search).has('debug'),
} as const;
