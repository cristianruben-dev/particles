/**
 * Azar con semilla y curvas para los modelos de galaxias (`milkyWayModel.ts`, `galaxyModel.ts`).
 * Con semilla, cada galaxia sale igual cada vez.
 */

/** Generador pseudoaleatorio con semilla (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Muestreadores sobre un generador. */
export function samplers(rand: () => number) {
  return {
    gauss: () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand()),
    laplace: (h: number) => (rand() < 0.5 ? -1 : 1) * h * -Math.log(1 - rand()),
    /** Radio de un disco exponencial (densidad superficial ∝ e^(−R/h)): Gamma(2, h). */
    diskRadius: (h: number) => -h * Math.log((1 - rand()) * (1 - rand())),
    between: (a: number, b: number) => a + (b - a) * rand(),
  };
}
