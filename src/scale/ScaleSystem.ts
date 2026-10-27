/**
 * Conversión única km reales → unidades de escena. Ver docs/ARQUITECTURA.md §4.3.
 * Ningún otro módulo convierte km a unidades de escena por su cuenta.
 *
 * Modelo jerárquico: todo punto (un planeta respecto al Sol, una luna respecto a su
 * planeta, la cámara respecto al cuerpo enfocado) se coloca a una distancia
 * `localDistance(radioDelPadre, d)` de su padre, en la dirección real.
 * Así lunas y cámara usan exactamente la misma función y nunca acaban dentro de un
 * planeta inflado.
 */

export type ScaleModeName = 'compressed' | 'real';

/** Parámetros artísticos de la escala comprimida (ajustables desde el panel de debug). */
export const compressedParams = {
  /** Radio en escena = radiusC · radioKm^radiusPow. */
  radiusC: 2.3,
  radiusPow: 0.45,
  /** Hasta cuántos radios del padre la distancia es lineal (proporciones reales cerca del cuerpo). */
  linearZone: 2,
};

/** 1 unidad de escena = 1.000 km en modo real. */
const KM_PER_UNIT_REAL = 1000;

/**
 * Perfil adimensional: lineal hasta x0 y logarítmico después, con valor y pendiente
 * continuos en x0 (el zoom no da tirones al cruzar).
 */
export function compressProfile(x: number, x0: number): number {
  return x <= x0 ? x : x0 * (1 + Math.log(x / x0));
}

export class ScaleSystem {
  /** 0 = comprimida, 1 = real. Se interpola para animar el cambio. */
  private blend = 0;
  private target = 0;

  get mode(): ScaleModeName {
    return this.target === 0 ? 'compressed' : 'real';
  }

  setMode(mode: ScaleModeName): void {
    this.target = mode === 'real' ? 1 : 0;
  }

  /** Avanza la transición animada (~2 s). */
  update(dtSeconds: number): void {
    const step = dtSeconds / 2;
    this.blend += Math.sign(this.target - this.blend) * Math.min(step, Math.abs(this.target - this.blend));
  }

  /** Radio de un cuerpo (km) → unidades de escena. */
  radius(km: number): number {
    return lerp(this.radiusCompressed(km), km / KM_PER_UNIT_REAL, smooth(this.blend));
  }

  /**
   * Distancia (km) de un punto al centro de su cuerpo padre → unidades de escena.
   * Monótona y continua en `distanceKm`.
   */
  localDistance(parentRadiusKm: number, distanceKm: number): number {
    const x = distanceKm / parentRadiusKm;
    const compressed = this.radiusCompressed(parentRadiusKm) * compressProfile(x, compressedParams.linearZone);
    return lerp(compressed, distanceKm / KM_PER_UNIT_REAL, smooth(this.blend));
  }

  private radiusCompressed(km: number): number {
    return compressedParams.radiusC * Math.pow(km, compressedParams.radiusPow);
  }
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => t * t * (3 - 2 * t);
