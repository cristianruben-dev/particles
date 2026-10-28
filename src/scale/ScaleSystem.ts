/**
 * Conversión única km reales → unidades de escena. Ver docs/ARQUITECTURA.md §4.3.
 * Ningún otro módulo convierte km a unidades de escena por su cuenta (los shaders
 * usan `distanceNode`, la misma función en TSL).
 *
 * Modelo jerárquico: todo punto (un planeta respecto al Sol, una luna respecto a su
 * planeta, la cámara respecto al cuerpo enfocado) se coloca a una distancia
 * `localDistance(padre, d)` de su padre, en la dirección real.
 * Así lunas y cámara usan exactamente la misma función y nunca acaban dentro de un
 * planeta inflado.
 */
import type { Node } from 'three/webgpu';
import { float, log, max, mix, pow, select, uniform } from 'three/tsl';

export type ScaleModeName = 'compressed' | 'real';

/** Lo que la escala necesita saber del cuerpo padre. */
export interface ScaleParent {
  radiusKm: number;
  /** Tamaño de su sistema de lunas en radios propios (fin de la zona logarítmica). */
  systemRadii?: number;
}

/** Parámetros artísticos de la escala comprimida (ajustables desde el panel de debug). */
export const compressedParams = {
  /** Radio en escena = radiusC · radioKm^radiusPow. */
  radiusC: 2.3,
  radiusPow: 0.45,
  /** Hasta cuántos radios del padre la distancia es lineal (proporciones reales cerca del cuerpo). */
  linearZone: 2,
  /** Exponente más allá del sistema de lunas: reparte los planetas sin amontonarlos. */
  power: 0.5,
};

/** Tope del sistema para cuerpos sin `systemRadii`. */
const DEFAULT_SYSTEM_RADII = 20;

/** 1 unidad de escena = 1.000 km en modo real. */
const KM_PER_UNIT_REAL = 1000;

/**
 * Perfil adimensional h(x), con x = distancia / radio del padre. Tres tramos con valor y
 * pendiente continuos (el zoom no da tirones al cruzarlos):
 * - lineal hasta x0 (alrededor del cuerpo, proporciones reales),
 * - logarítmico hasta xc (el sistema de lunas, comprimido),
 * - potencia x^q más allá (el espacio entre sistemas: planetas separados y encuadrables).
 */
export function compressProfile(x: number, x0: number, xc: number, q: number): number {
  if (x <= x0) return x;
  const c = Math.max(xc, x0);
  if (x <= c) return x0 * (1 + Math.log(x / x0));
  const hc = x0 * (1 + Math.log(c / x0));
  return hc + (x0 / q) * (Math.pow(x / c, q) - 1);
}

type FloatNode = Node<'float'>;

export class ScaleSystem {
  /** 0 = comprimida, 1 = real. Se interpola para animar el cambio. */
  private blend = 0;
  private target = 0;

  /** Mezcla suavizada para los shaders (0 = comprimida, 1 = real). */
  readonly blendNode = uniform(0);
  private readonly x0Node = uniform(compressedParams.linearZone);
  private readonly powerNode = uniform(compressedParams.power);
  /** Uniforms por padre de `distanceNode`, refrescados en `update`. */
  private readonly parentNodes: { parent: ScaleParent; radiusC: { value: number }; cap: { value: number } }[] = [];

  get mode(): ScaleModeName {
    return this.target === 0 ? 'compressed' : 'real';
  }

  /** true mientras dura la transición animada entre escalas. */
  get transitioning(): boolean {
    return this.blend !== this.target;
  }

  setMode(mode: ScaleModeName): void {
    this.target = mode === 'real' ? 1 : 0;
  }

  /** Avanza la transición animada (~2,5 s). */
  update(dtSeconds: number): void {
    const step = dtSeconds / 2.5;
    this.blend += Math.sign(this.target - this.blend) * Math.min(step, Math.abs(this.target - this.blend));
    this.blendNode.value = smooth(this.blend);
    this.x0Node.value = compressedParams.linearZone;
    this.powerNode.value = compressedParams.power;
    for (const n of this.parentNodes) {
      n.radiusC.value = this.radiusCompressed(n.parent.radiusKm);
      n.cap.value = n.parent.systemRadii ?? DEFAULT_SYSTEM_RADII;
    }
  }

  /** Radio de un cuerpo (km) → unidades de escena. */
  radius(km: number): number {
    return lerp(this.radiusCompressed(km), km / KM_PER_UNIT_REAL, smooth(this.blend));
  }

  /**
   * Distancia (km) de un punto al centro de su cuerpo padre → unidades de escena.
   * Monótona y continua en `distanceKm`.
   */
  localDistance(parent: ScaleParent, distanceKm: number): number {
    const x = distanceKm / parent.radiusKm;
    const h = compressProfile(x, compressedParams.linearZone, parent.systemRadii ?? DEFAULT_SYSTEM_RADII, compressedParams.power);
    return lerp(this.radiusCompressed(parent.radiusKm) * h, distanceKm / KM_PER_UNIT_REAL, smooth(this.blend));
  }

  /**
   * Inversa de `localDistance`: unidades de escena → km desde el centro del padre (vuelo
   * libre y adopción de la cámara). Bisección en log-distancia: la función es monótona
   * también durante la transición entre escalas.
   */
  inverseLocalDistance(parent: ScaleParent, sceneDistance: number): number {
    if (sceneDistance <= 0) return 0;
    let lo = Math.log(parent.radiusKm * 1e-12), hi = Math.log(1e13);
    for (let i = 0; i < 64; i++) {
      const mid = (lo + hi) / 2;
      if (this.localDistance(parent, Math.exp(mid)) < sceneDistance) lo = mid;
      else hi = mid;
    }
    return Math.exp((lo + hi) / 2);
  }

  /**
   * `localDistance` en TSL, para partículas que se colocan en la GPU (anillos, asteroides,
   * órbitas). `distanceKm` en km; devuelve unidades de escena.
   */
  distanceNode(parent: ScaleParent, distanceKm: FloatNode): FloatNode {
    const radiusC = uniform(this.radiusCompressed(parent.radiusKm));
    const cap = uniform(parent.systemRadii ?? DEFAULT_SYSTEM_RADII);
    this.parentNodes.push({ parent, radiusC, cap });

    const x0 = this.x0Node, q = this.powerNode;
    const x = max(distanceKm.div(parent.radiusKm), 1e-6);
    const c = max(cap, x0);
    const logZone = x0.mul(log(x.div(x0)).add(1));
    const hc = x0.mul(log(c.div(x0)).add(1));
    const powZone = hc.add(x0.div(q).mul(pow(x.div(c), q).sub(1)));
    const h = select(x.lessThanEqual(x0), x, select(x.lessThanEqual(c), logZone, powZone));
    return mix(radiusC.mul(h), distanceKm.div(float(KM_PER_UNIT_REAL)), this.blendNode) as FloatNode;
  }

  private radiusCompressed(km: number): number {
    return compressedParams.radiusC * Math.pow(km, compressedParams.radiusPow);
  }
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => t * t * (3 - 2 * t);
