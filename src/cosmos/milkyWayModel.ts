/**
 * Modelo de partículas de la Vía Láctea vista desde fuera. Ver docs/ARQUITECTURA.md §14.4.
 *
 * Nadie la ha fotografiado desde fuera: es un modelo con parámetros publicados. Disco
 * exponencial fino y grueso, bulbo en caja con la barra (~27° de la línea Sol–centro, el
 * extremo cercano hacia l > 0) y cuatro brazos espirales logarítmicos en dos pares
 * simétricos. Paso y radio están ajustados para que, en la dirección del Sol, los brazos
 * crucen donde los sitúan las paralajes de máseres (Reid et al. 2019): Norma 4,0, Escudo
 * 5,4, Sagitario 6,9, Perseo 10,2 y Exterior 12,0 kpc (medidos: 4,4, 5,4, 6,9, 10 y 12,4).
 * Más el brazo de Orión, el del Sol: un tramo corto.
 *
 * Coordenadas del modelo: kpc en ejes galácticos (x hacia el centro desde el Sol, y hacia
 * l = 90°, z al polo norte), con el origen en el centro; el Sol está en (−R0, 0, z0). La
 * galaxia gira en sentido horario vista desde el norte (el Sol va hacia l = 90°): los
 * brazos son de arrastre, se cierran hacia dentro en el sentido del giro. El azimut β se
 * mide desde el Sol en ese sentido: (x, y) = (−R·cos β, R·sin β).
 *
 * Cada partícula elige su componente al azar, así que salen en orden aleatorio y cualquier
 * prefijo es una muestra de la galaxia entera: el LOD dibuja solo las N primeras (§6.3).
 * Se genera en un worker (`galaxy.worker.ts`).
 */
import { galacticToScene } from '../astro/frames';
import { KPC_KM } from '../astro/galaxy';
import { DEG, LY_KM } from '../astro/units';

const LY_PER_KPC = KPC_KM / LY_KM;

export interface GalaxyRequest {
  stars: number;
  dust: number;
  seed: number;
}

/** Por partícula: posición respecto al centro y diámetro (años luz, ejes de escena), y color. */
export interface GalaxyLayer {
  posSize: Float32Array;
  color: Float32Array;
}

export interface GalaxyResult {
  stars: GalaxyLayer;
  dust: GalaxyLayer;
}

interface Arm {
  /** Radio (kpc) en el azimut del Sol (β = 0) de la vuelta principal. */
  r0: number;
  /** Ángulo de paso (°). */
  pitch: number;
  /** Desfase (rad): el gemelo de un par va girado π. */
  phase: number;
  /** Peso en estrellas viejas (densidad del disco) y en gas, polvo y estrellas jóvenes. */
  stars: number;
  gas: number;
  /** Tramo en β (rad), solo para el brazo de Orión; el resto va de `R_IN` a `R_OUT`. */
  range?: [number, number];
}

const ARMS: Arm[] = [
  // Escudo-Centauro (5,4 kpc) y su gemelo, Perseo (10,2 kpc en β = 0): los dos grandes.
  { r0: 5.4, pitch: 11.5, phase: 0, stars: 1, gas: 1 },
  { r0: 5.4, pitch: 11.5, phase: Math.PI, stars: 1, gas: 1 },
  // Sagitario-Carina (6,9) y Norma-Exterior (4,0 y 12,0): menores, sobre todo gas.
  { r0: 6.9, pitch: 10, phase: 0, stars: 0.3, gas: 0.85 },
  { r0: 6.9, pitch: 10, phase: Math.PI, stars: 0.3, gas: 0.75 },
  // Orión: el Sol está en su borde interior (el brazo pasa a 8,5 kpc).
  { r0: 8.5, pitch: 11.4, phase: 0, stars: 0.12, gas: 0.3, range: [-25 * DEG, 40 * DEG] },
];

/** Los brazos nacen en los extremos de la barra y se apagan en el borde del disco (kpc). */
const R_IN = 3.4;
const R_OUT = 15.5;
/** Ángulo de la barra respecto a la línea Sol–centro y semilongitud (kpc). */
const BAR_ANGLE = 27 * DEG;
const BAR_HALF_LENGTH = 4.6;
/** Escala del disco fino y del grueso (kpc). */
const DISK_SCALE = 2.6;
const THICK_SCALE = 2.2;

/** Reparto de las partículas y la luz que aporta cada una (relativa). */
const COMPONENTS = [
  { kind: 'bulge', share: 0.13, light: 0.9 },
  { kind: 'disk', share: 0.33, light: 0.8 },
  { kind: 'thick', share: 0.05, light: 0.3 },
  { kind: 'arm', share: 0.42, light: 1.1 },
  { kind: 'hii', share: 0.06, light: 0.35 },
  { kind: 'halo', share: 0.01, light: 0.2 },
] as const;
type Kind = (typeof COMPONENTS)[number]['kind'];

/** Diámetro de referencia (kpc): una partícula de este tamaño brilla con su luz tal cual. */
const SIZE_REF = 0.25;

/** Generador pseudoaleatorio con semilla (mulberry32): la galaxia sale igual cada vez. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function generateMilkyWay({ stars, dust, seed }: GalaxyRequest): GalaxyResult {
  const rand = rng(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
  const laplace = (h: number) => (rand() < 0.5 ? -1 : 1) * h * -Math.log(1 - rand());
  /** Radio de un disco exponencial (densidad superficial ∝ e^(−R/h)): Gamma(2, h). */
  const diskRadius = (h: number) => -h * Math.log((1 - rand()) * (1 - rand()));
  const between = (a: number, b: number) => a + (b - a) * rand();

  const armTan = ARMS.map((a) => Math.tan(a.pitch * DEG));
  const armWidth = (R: number) => 0.1 + 0.024 * R;
  const armTaper = (R: number) => smoothstep(3.2, 4.8, R) * (1 - smoothstep(12.5, 16, R));

  /** Distancia radial (kpc) de (R, β) a la vuelta más cercana del brazo `i`. */
  function armOffset(i: number, R: number, beta: number): number {
    const a = ARMS[i], t = armTan[i];
    let u = Math.log(R / a.r0) + (beta - a.phase) * t;
    if (a.range) {
      // Un solo tramo: sin otras vueltas y apagado fuera de su rango.
      const b = wrap(beta);
      if (b < a.range[0] - 0.3 || b > a.range[1] + 0.3) return Infinity;
      u = Math.log(R / a.r0) + b * t;
    } else {
      const period = 2 * Math.PI * t;
      u -= Math.round(u / period) * period;
    }
    return R * u;
  }

  /** Cuánto está un punto del disco sobre un brazo (0–1), con el peso en estrellas viejas. */
  function armBoost(R: number, beta: number): number {
    let best = 0;
    const w = armWidth(R);
    for (let i = 0; i < ARMS.length; i++) {
      const d = armOffset(i, R, beta);
      best = Math.max(best, ARMS[i].stars * Math.exp((-d * d) / (2 * w * w)));
    }
    return best * armTaper(R);
  }

  /** Brazo elegido por su peso en gas. */
  const gasTotal = ARMS.reduce((s, a) => s + a.gas, 0);
  function pickArm(): number {
    let r = rand() * gasTotal;
    for (let i = 0; i < ARMS.length; i++) if ((r -= ARMS[i].gas) <= 0) return i;
    return ARMS.length - 1;
  }

  /**
   * Un punto sobre el eje de un brazo, con más densidad dentro (escala de 4,5 kpc). En una
   * espiral logarítmica la longitud de arco va con R: repartir en R reparte a lo largo.
   */
  function armPoint(): { R: number; beta: number; arm: number } {
    for (;;) {
      const i = pickArm(), a = ARMS[i], t = armTan[i];
      let R: number, beta: number;
      if (a.range) {
        beta = between(a.range[0], a.range[1]);
        R = a.r0 * Math.exp(-beta * t);
      } else {
        const span = 1 - Math.exp(-(R_OUT - R_IN) / 4.5);
        R = R_IN - 4.5 * Math.log(1 - rand() * span);
        beta = a.phase - Math.log(R / a.r0) / t;
      }
      // El de Orión se apaga en sus extremos; los demás, dentro de la barra y en el borde.
      const fade = a.range ? smoothstep(a.range[0], a.range[0] + 0.25, beta) * smoothstep(a.range[1], a.range[1] - 0.25, beta) : armTaper(R);
      if (rand() < fade) return { R, beta, arm: i };
    }
  }

  // Asociaciones OB y regiones HII: grumos fijos a lo largo de los brazos.
  const clumps = (n: number, inward: number) =>
    Array.from({ length: n }, () => {
      const p = armPoint();
      const R = p.R + (gauss() * 0.5 - inward) * armWidth(p.R);
      return { R, beta: p.beta + gauss() * 0.01, z: gauss() * 0.04 };
    });
  const obClumps = clumps(2400, 0);
  const hiiClumps = clumps(1400, 0.25);

  const starPos = new Float32Array(stars * 4);
  const starColor = new Float32Array(stars * 4);
  const p = { x: 0, y: 0, z: 0, size: 0, r: 0, g: 0, b: 0 };

  const polar = (R: number, beta: number, z: number) => {
    p.x = -R * Math.cos(beta);
    p.y = R * Math.sin(beta);
    p.z = z;
  };
  const tint = (r: number, g: number, b: number, jitter: number) => {
    const j = 1 + (rand() - 0.5) * jitter;
    p.r = r * j;
    p.g = g * (1 + (rand() - 0.5) * jitter * 0.5);
    p.b = b / j;
  };

  const shareTotal = COMPONENTS.reduce((s, c) => s + c.share, 0);
  function pickKind(): { kind: Kind; light: number } {
    let r = rand() * shareTotal;
    for (const c of COMPONENTS) if ((r -= c.share) <= 0) return c;
    return COMPONENTS[0];
  }

  for (let i = 0; i < stars; i++) {
    const { kind, light } = pickKind();
    switch (kind) {
      case 'bulge': {
        // 70 % bulbo en caja (elipsoide exponencial 1 : 0,45 : 0,38) y 30 % barra larga y fina.
        let u: number, v: number, w: number;
        if (rand() < 0.7) {
          const r = -0.36 * Math.log((1 - rand()) * (1 - rand()) * (1 - rand()));
          const gx = gauss(), gy = gauss(), gz = gauss();
          const n = Math.hypot(gx, gy, gz) || 1;
          u = (r * gx) / n;
          v = (0.45 * r * gy) / n;
          w = (0.38 * r * gz) / n;
          p.size = between(0.08, 0.2);
        } else {
          u = ((rand() + rand() + rand() - 1.5) / 1.5) * BAR_HALF_LENGTH;
          v = gauss() * 0.22;
          w = gauss() * 0.1;
          p.size = between(0.06, 0.16);
        }
        // Eje de la barra: del centro hacia el extremo cercano (β = 27°).
        const c = Math.cos(BAR_ANGLE), s = Math.sin(BAR_ANGLE);
        p.x = -c * u + s * v;
        p.y = s * u + c * v;
        p.z = w;
        tint(1, 0.76, 0.5, 0.25);
        break;
      }
      case 'disk': {
        let R: number, beta: number;
        for (;;) {
          R = diskRadius(DISK_SCALE);
          if (R > 16.5) continue;
          beta = rand() * 2 * Math.PI;
          // Dentro de la barra el disco está vacío; fuera, más denso sobre los brazos.
          const keep = smoothstep(1.5, 4.2, R) * (0.2 + 0.8 * armBoost(R, beta));
          if (rand() < keep) break;
        }
        polar(R, beta, laplace(0.25));
        const outer = smoothstep(4, 14, R);
        tint(1 - 0.12 * outer, 0.9, 0.78 + 0.2 * outer, 0.2);
        p.size = between(0.08, 0.22);
        break;
      }
      case 'thick': {
        let R: number;
        do R = diskRadius(THICK_SCALE); while (R > 14 || rand() > smoothstep(1, 3.5, R));
        polar(R, rand() * 2 * Math.PI, laplace(0.8));
        tint(1, 0.8, 0.6, 0.2);
        p.size = between(0.15, 0.35);
        break;
      }
      case 'arm': {
        // Estrellas jóvenes: la mitad en asociaciones OB, el resto a lo largo del brazo.
        if (rand() < 0.45) {
          const c = obClumps[Math.floor(rand() * obClumps.length)];
          polar(c.R + gauss() * 0.08, c.beta + (gauss() * 0.08) / c.R, c.z + gauss() * 0.04);
        } else {
          const a = armPoint();
          polar(a.R + gauss() * armWidth(a.R), a.beta + gauss() * 0.015, gauss() * 0.07);
        }
        tint(0.62, 0.76, 1, 0.3);
        p.size = between(0.05, 0.16);
        break;
      }
      case 'hii': {
        const c = hiiClumps[Math.floor(rand() * hiiClumps.length)];
        polar(c.R + gauss() * 0.035, c.beta + (gauss() * 0.035) / c.R, c.z + gauss() * 0.02);
        tint(1, 0.38, 0.56, 0.2);
        p.size = between(0.03, 0.07);
        break;
      }
      case 'halo': {
        const r = Math.min(40, -2.5 * Math.log((1 - rand()) * (1 - rand()) * (1 - rand())));
        const gx = gauss(), gy = gauss(), gz = gauss();
        const n = Math.hypot(gx, gy, gz) || 1;
        p.x = (r * gx) / n;
        p.y = (r * gy) / n;
        p.z = (0.8 * r * gz) / n;
        tint(1, 0.8, 0.62, 0.2);
        p.size = between(0.5, 1.2);
        break;
      }
    }
    // Luz repartida por el área: una partícula pequeña brilla más por píxel con la misma luz.
    const k = light / ((p.size / SIZE_REF) * (p.size / SIZE_REF));
    write(starPos, starColor, i, p, k);
  }

  // Polvo: nubes y franjas en el borde interior (cóncavo) de los brazos y una capa fina en el
  // plano. En grumos: una franja continua parece un anillo dibujado.
  const dustClumps = clumps(3000, 0.6);
  const dustPos = new Float32Array(dust * 4);
  const dustColor = new Float32Array(dust * 4);
  for (let i = 0; i < dust; i++) {
    const r = rand();
    if (r < 0.4) {
      const c = dustClumps[Math.floor(rand() * dustClumps.length)];
      const spread = 0.04 + 0.1 * rand();
      polar(c.R + gauss() * spread, c.beta + (gauss() * spread * 1.6) / c.R, gauss() * 0.04);
    } else if (r < 0.65) {
      const a = armPoint();
      const w = armWidth(a.R);
      polar(a.R - 0.6 * w + gauss() * 0.3 * w, a.beta + gauss() * 0.02, gauss() * 0.05);
    } else {
      let R: number, beta: number;
      do {
        R = diskRadius(3);
        beta = rand() * 2 * Math.PI;
      } while (R > 15 || rand() > smoothstep(2, 4.5, R) * (0.3 + 0.7 * armBoost(R, beta)));
      polar(R, beta, laplace(0.06));
    }
    // Absorbe más el azul que el rojo (enrojecimiento).
    p.r = 0.42;
    p.g = 0.55;
    p.b = 0.75;
    p.size = between(0.1, 0.24);
    write(dustPos, dustColor, i, p, 1);
  }

  return { stars: { posSize: starPos, color: starColor }, dust: { posSize: dustPos, color: dustColor } };
}

/** Ángulo en (−π, π]. */
const wrap = (a: number) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));

/** Pasa la partícula de kpc galácticos a años luz en ejes de escena. */
function write(pos: Float32Array, color: Float32Array, i: number, p: { x: number; y: number; z: number; size: number; r: number; g: number; b: number }, k: number): void {
  const s = galacticToScene(p);
  pos[i * 4] = s.x * LY_PER_KPC;
  pos[i * 4 + 1] = s.y * LY_PER_KPC;
  pos[i * 4 + 2] = s.z * LY_PER_KPC;
  pos[i * 4 + 3] = p.size * LY_PER_KPC;
  color[i * 4] = p.r * k;
  color[i * 4 + 1] = p.g * k;
  color[i * 4 + 2] = p.b * k;
}
