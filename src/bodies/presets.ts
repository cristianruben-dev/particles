/**
 * Configuración visual de cada cuerpo (texturas, densidad, parámetros artísticos).
 * Los datos físicos están en astro/bodies.ts. Ver docs/ASSETS.md para las texturas.
 */
import type { BodyId } from '../astro/bodies';

export interface RockyPreset {
  count: number;
  textures: {
    albedo: string;
    height: string;
    /** Luces nocturnas (solo Tierra). */
    night?: string;
  };
  /** Altura normalizada (0–1) que corresponde al radio medio. */
  heightReference: number;
  /** Desplazamiento radial por unidad de altura normalizada (relieve exagerado). */
  reliefScale: number;
  /** Altura normalizada por debajo de la cual hay agua (brillo especular). */
  waterBelow?: number;
  clouds?: {
    count: number;
    texture: string;
    /** Altura sobre el radio medio (relativa al radio). */
    altitude: number;
  };
  atmosphere?: {
    count: number;
    /** Grosor relativo al radio. */
    thickness: number;
  };
}

export const ROCKY_PRESETS: Partial<Record<BodyId, RockyPreset>> = {
  earth: {
    count: 1_200_000,
    textures: {
      albedo: '/textures/earth/albedo_4k.jpg',
      height: '/textures/earth/height_4k.png',
      night: '/textures/earth/night_3k.jpg',
    },
    heightReference: 0,
    reliefScale: 0.03,
    waterBelow: 0.5 / 255,
    clouds: { count: 320_000, texture: '/textures/earth/clouds_2k.jpg', altitude: 0.022 },
    atmosphere: { count: 140_000, thickness: 0.04 },
  },
  moon: {
    count: 400_000,
    textures: {
      albedo: '/textures/moon/albedo_2k.jpg',
      height: '/textures/moon/height_1k.jpg',
    },
    heightReference: 0.5,
    reliefScale: 0.04,
  },
};
