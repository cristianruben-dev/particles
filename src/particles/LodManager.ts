/**
 * Nivel de detalle por tamaño en pantalla. Ver docs/ARQUITECTURA.md §6.3.
 *
 * Fase 1: LOD continuo por densidad. Cada cuerpo dibuja tantas partículas como hacen
 * falta para que queden a `particleLook.spacingPx` píxeles unas de otras. Sin esto, un
 * cuerpo pequeño en pantalla amontona cientos de miles de sprites en unos pocos píxeles.
 */
import { config } from '../config';
import { pixelAngle } from './nodes';

export enum LodLevel {
  /** Un sprite. */
  Point = 0,
  /** Esfera de baja densidad. */
  Cloud = 1,
  /** Esfera densa con relieve, nubes y atmósfera. */
  Globe = 2,
  /** Globo + chunks de superficie alrededor de la cámara. */
  Surface = 3,
}

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

/** Fracción de las `total` partículas que hace falta dibujar para un radio en pantalla dado. */
export function detailFraction(total: number, radiusPx: number): number {
  // Hemisferio visible (π·r²) con una partícula cada spacingPx²; el total cubre la esfera entera.
  const needed = (2 * Math.PI * radiusPx * radiusPx) / (particleLook.spacingPx * particleLook.spacingPx);
  return Math.min(1, needed / total);
}

export function lodForPixels(px: number, altitudeRatio: number): LodLevel {
  if (px < config.lod.pointMaxPx) return LodLevel.Point;
  if (px < config.lod.cloudMaxPx) return LodLevel.Cloud;
  // altitudeRatio = altitud / radio. Por debajo de ~0,5 radios activamos la superficie.
  return altitudeRatio < 0.5 ? LodLevel.Surface : LodLevel.Globe;
}

// TODO(fase 2): presupuesto global entre cuerpos y transición de "condensación" entre niveles.
