/**
 * Presupuestos y flags globales. Ver docs/ARQUITECTURA.md §6.3 y §12.
 */
import type { BodyId } from './astro/bodies';

export const config = {
  /** Cuerpos activos, cada padre antes que sus hijos. */
  bodies: [
    'sun', 'mercury', 'venus', 'earth', 'moon', 'mars',
    'jupiter', 'io', 'europa', 'ganymede', 'callisto',
    'saturn', 'titan', 'uranus', 'neptune', 'triton', 'pluto', 'charon',
  ] as BodyId[],

  /** Partículas máximas en escena con backend WebGPU. */
  particleBudgetWebGPU: 4_000_000,
  /** Con WebGL2 el presupuesto se reduce (sin compute nativo). */
  particleBudgetWebGL: 2_000_000,

  /** Niveles de detalle (§6.3), en píxeles CSS de radio proyectado. */
  lod: {
    /** Por encima se hornea el detalle completo (también al enfocar el cuerpo). */
    fullDetailPx: 160,
    /** Por debajo, y sin foco durante `releaseSeconds`, se libera el detalle completo. */
    releasePx: 60,
    releaseSeconds: 15,
    /** Partículas de la vista previa (tope). Cubre sin huecos hasta ~200 px de radio. */
    previewCount: 40_000,
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
