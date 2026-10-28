/**
 * Relevo entre la escena del sistema solar y la capa cósmica. Ver docs/ARQUITECTURA.md §14.4.
 *
 * Todo se decide por la distancia **verdadera** (km) de la cámara al Sol: así vale igual en
 * la escala comprimida y en la real. Por debajo de `HANDOFF_START_KM` solo hay sistema solar;
 * por encima de `HANDOFF_END_KM`, solo cosmos (el Sol queda como una estrella más).
 */
import { uniform } from 'three/tsl';
import { AU_KM, LY_KM } from '../astro/units';

/**
 * Empieza a fundirse el sistema solar. A 1.000 UA, en la escala comprimida, la órbita de
 * Neptuno aún ocupa ~10° de pantalla; a 10.000 UA, ~3°.
 */
export const HANDOFF_START_KM = 1_000 * AU_KM;
/**
 * Ya no se dibuja: la cámara de la escena solar se queda aquí. En la escala real son
 * 1,5·10⁹ unidades, dentro de la cáscara cósmica (5·10⁹) y del plano lejano (10¹⁰).
 */
export const HANDOFF_END_KM = 10_000 * AU_KM;

/**
 * Las estrellas de Yale están en el infinito: lejos del Sol enseñarían las mismas
 * constelaciones. Se apagan entre estas distancias mientras entra el modelo de la galaxia
 * (provisional, hasta tener estrellas con distancia y el panorama).
 */
export const STARS_FADE_START_KM = 0.15 * LY_KM;
export const STARS_FADE_END_KM = 1.5 * LY_KM;

export const handoff = {
  /** 1 = sistema solar entero, 0 = ya no se dibuja (multiplica lo que se ve de lejos). */
  solar: uniform(1),
};

/** 0 por debajo de `a`, 1 por encima de `b`, suave en escala logarítmica. */
export function logStep(km: number, a: number, b: number): number {
  const t = Math.min(1, Math.max(0, Math.log(km / a) / Math.log(b / a)));
  return t * t * (3 - 2 * t);
}

/** Presencia del sistema solar (1 → 0) según la distancia verdadera de la cámara al Sol. */
export const solarPresence = (cameraSunKm: number): number => 1 - logStep(cameraSunKm, HANDOFF_START_KM, HANDOFF_END_KM);
