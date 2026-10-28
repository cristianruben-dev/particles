/**
 * Nivel de detalle por tamaño en pantalla. Ver docs/ARQUITECTURA.md §6.3.
 *
 * Dos mecanismos que se combinan:
 * - **Niveles** (`bodies/DetailTier.ts`): cada cuerpo tiene una vista previa ligera siempre
 *   en memoria y un nivel completo que se hornea al acercarse y se libera al alejarse.
 * - **Densidad** (aquí): dentro de un nivel se dibujan solo las partículas que hacen falta
 *   para que queden a `particleLook.spacingPx` píxeles unas de otras. Sin esto, un cuerpo
 *   pequeño en pantalla amontona cientos de miles de sprites en unos pocos píxeles.
 * - Por debajo de unos píxeles, el punto lejano de `BaseBody` toma el relevo.
 */
import { pixelAngle } from './nodes';

/**
 * Aspecto de "nube de partículas" (ajustable desde el panel de debug).
 * Los puntos no se tocan: hay aire entre ellos a cualquier distancia.
 */
export const particleLook = {
  /** Separación objetivo entre partículas vecinas, en píxeles CSS. */
  spacingPx: 2.6,
  /** Multiplicador global del tamaño de punto (1 = el `overlap` de cada capa). */
  dotScale: 1,
};

/** Tamaño de partícula (relativo al radio) que cubre la esfera sin huecos con `count` puntos. */
export function coveringSize(count: number, overlap: number): number {
  return Math.sqrt((4 * Math.PI) / count) * overlap;
}

/** Radio proyectado en píxeles de una esfera de radio `radius` a distancia `distance` (escena). */
export function projectedRadiusPx(radius: number, distance: number): number {
  if (distance <= radius) return Infinity;
  return Math.asin(radius / distance) / pixelAngle.value;
}

/**
 * Fracción de las `total` partículas que hace falta dibujar para un radio en pantalla dado.
 * `areaFactor` = área de la capa respecto a la esfera (los anillos cubren más).
 */
export function detailFraction(total: number, radiusPx: number, areaFactor = 1): number {
  // Hemisferio visible (π·r²) con una partícula cada spacingPx²; el total cubre la esfera entera.
  const needed = (2 * Math.PI * radiusPx * radiusPx * areaFactor) / (particleLook.spacingPx * particleLook.spacingPx);
  return Math.min(1, needed / total);
}
