/**
 * Tabla de datos de los cuerpos celestes. Ver docs/ARQUITECTURA.md §5 y §8.
 *
 * - Órbitas planetarias: JPL "Keplerian Elements for Approximate Positions of the
 *   Major Planets" (Tabla 1, 1800–2050), valor en J2000 + tasa por siglo.
 * - Polos y meridiano: IAU WGCCRE 2015 (Archinal et al. 2018), vía el kernel `pck00011.tpc` de NAIF.
 * - Lunas: JPL "Planetary Satellite Mean Elements" (época 2000-01-01.5 TDB).
 */

import type { CometId } from './comets';

export type BodyId =
  | 'sun'
  | 'mercury'
  | 'venus'
  | 'earth'
  | 'moon'
  | 'mars'
  | 'jupiter'
  | 'io'
  | 'europa'
  | 'ganymede'
  | 'callisto'
  | 'saturn'
  | 'titan'
  | 'uranus'
  | 'neptune'
  | 'triton'
  | 'pluto'
  | 'charon'
  | 'iss'
  | CometId;

/** Qué clase de `bodies/` renderiza el cuerpo. */
export type BodyKind = 'star' | 'rocky' | 'gas' | 'moon' | 'station' | 'comet';

/** Elemento orbital: valor en J2000 y tasa de cambio por siglo juliano. */
export interface OrbitalElement {
  value: number;
  ratePerCentury: number;
}

export interface OrbitalElements {
  /** Semieje mayor (UA). */
  a: OrbitalElement;
  /** Excentricidad. */
  e: OrbitalElement;
  /** Inclinación (grados). */
  i: OrbitalElement;
  /** Longitud media (grados). */
  L: OrbitalElement;
  /** Longitud del perihelio (grados). */
  longPeri: OrbitalElement;
  /** Longitud del nodo ascendente (grados). */
  longNode: OrbitalElement;
}

/**
 * Orientación IAU: polo norte (ascensión recta y declinación en el ICRF, grados, con
 * tasa por siglo) y meridiano principal W = w0 + wRate · días desde J2000 (grados).
 */
export interface PoleData {
  ra: number;
  raRate: number;
  dec: number;
  decRate: number;
  w0: number;
  wRate: number;
}

/**
 * Elementos medios de un satélite respecto a su plano de Laplace (o al ecuador del
 * planeta). Los ángulos se miden desde el nodo de ese plano sobre el ecuador ICRF.
 */
export interface SatelliteElements {
  /** Semieje mayor (km). */
  a: number;
  e: number;
  /** Inclinación respecto al plano de referencia (grados). */
  i: number;
  /** Longitud del nodo ascendente (grados). */
  node: number;
  /** Argumento del periapsis (grados). */
  peri: number;
  /** Anomalía media en J2000 (grados). */
  M: number;
  /** Movimiento medio en longitud (grados/día). */
  meanMotion: number;
  /** Periodo anomalístico (días): con el movimiento medio da el giro de los ápsides. */
  anomalisticDays: number;
  /** Periodo de precesión del nodo (años); 0 = sin precesión. */
  nodeYears: number;
  /** Polo del plano de Laplace (RA/Dec ICRF, grados); null = ecuador del planeta. */
  laplacePole: { ra: number; dec: number } | null;
}

export interface BodyData {
  id: BodyId;
  name: string;
  kind: BodyKind;
  parent: BodyId | null;
  /** Radio medio (km). */
  radiusKm: number;
  /** Achatamiento (1 − radio polar / ecuatorial). */
  flattening?: number;
  /** Inclinación del eje respecto a la órbita (grados). Informativo: la orientación sale de `pole`. */
  axialTiltDeg: number;
  /** Periodo de rotación sidéreo (horas). Negativo = retrógrado. Informativo. */
  rotationPeriodH: number;
  /** Color medio: punto lejano y etiquetas. */
  color: number;
  /** Rotación síncrona: siempre muestra la misma cara (lon 0°) a su padre. */
  tidallyLocked?: boolean;
  pole: PoleData;
  /** Órbita heliocéntrica (planetas). */
  orbit?: OrbitalElements;
  /** Órbita alrededor del planeta (lunas, salvo la Luna, que tiene modelo propio). */
  satellite?: SatelliteElements;
  /**
   * Tamaño de su sistema de lunas y anillos, en radios propios: hasta ahí la escala
   * comprimida es logarítmica alrededor del cuerpo (§4.3). Por defecto 20.
   */
  systemRadii?: number;
  /** Cometas: sus elementos en `astro/comets.ts`. */
  comet?: CometId;
  /** Distancia al enfocarlo (radios desde el centro); por defecto 3,2. */
  viewRadii?: number;
}

const el = (value: number, ratePerCentury: number): OrbitalElement => ({ value, ratePerCentury });

/**
 * Radio de referencia de la coma de los cometas (km): fija su escala (§4.3). Con 6.000 km la
 * coma queda del tamaño de la Tierra en la escala comprimida y una cola de 0,3 UA mide un
 * tercio de la órbita de la Tierra: se ve desde el sistema entero.
 */
const COMA_REFERENCE_KM = 6_000;
const comet = (id: CometId, name: string): BodyData => ({
  id, name, kind: 'comet', parent: 'sun', comet: id,
  radiusKm: COMA_REFERENCE_KM, axialTiltDeg: 0, rotationPeriodH: 0, color: 0xc4f1ff,
  // Sin orientación propia (bodies/Comet.ts): las colas van en ejes de la escena.
  pole: pole(0, 0, 90, 0, 0, 0),
  viewRadii: 300,
});
const pole = (ra: number, raRate: number, dec: number, decRate: number, w0: number, wRate: number): PoleData =>
  ({ ra, raRate, dec, decRate, w0, wRate });

/** Margen sobre la luna o anillo más lejano para el tope del sistema. */
const SYSTEM_MARGIN = 1.3;

export const BODIES: Record<BodyId, BodyData> = {
  sun: {
    id: 'sun', name: 'Sol', kind: 'star', parent: null,
    radiusKm: 695_700, axialTiltDeg: 7.25, rotationPeriodH: 609.12, color: 0xffd27a,
    pole: pole(286.13, 0, 63.87, 0, 84.176, 14.1844),
    // Zona logarítmica corta: más allá, los planetas se reparten con una potencia (§4.3).
    systemRadii: 4,
  },
  mercury: {
    id: 'mercury', name: 'Mercurio', kind: 'rocky', parent: 'sun',
    radiusKm: 2_439.7, axialTiltDeg: 0.03, rotationPeriodH: 1_407.6, color: 0x9c958f,
    pole: pole(281.0103, -0.0328, 61.4155, -0.0049, 329.5988, 6.1385108),
    orbit: {
      a: el(0.38709927, 0.00000037), e: el(0.20563593, 0.00001906), i: el(7.00497902, -0.00594749),
      L: el(252.2503235, 149472.67411175), longPeri: el(77.45779628, 0.16047689), longNode: el(48.33076593, -0.12534081),
    },
  },
  venus: {
    id: 'venus', name: 'Venus', kind: 'rocky', parent: 'sun',
    radiusKm: 6_051.8, axialTiltDeg: 177.36, rotationPeriodH: -5_832.5, color: 0xe8cda2,
    pole: pole(272.76, 0, 67.16, 0, 160.2, -1.4813688),
    orbit: {
      a: el(0.72333566, 0.0000039), e: el(0.00677672, -0.00004107), i: el(3.39467605, -0.0007889),
      L: el(181.9790995, 58517.81538729), longPeri: el(131.60246718, 0.00268329), longNode: el(76.67984255, -0.27769418),
    },
  },
  earth: {
    id: 'earth', name: 'Tierra', kind: 'rocky', parent: 'sun',
    radiusKm: 6_371.0, axialTiltDeg: 23.44, rotationPeriodH: 23.9345, color: 0x3a6fd8,
    // El giro real sale del tiempo sidéreo (ephemeris.ts). Polo de la IAU con la precesión
    // (−ζ y 90° − θ de la IAU 1976): en 2026 se ha movido 0,15° y el nodo 0,17°.
    pole: pole(0, -0.641, 90, -0.557, 190.147, 360.9856235),
    orbit: {
      a: el(1.00000261, 0.00000562), e: el(0.01671123, -0.00004392), i: el(-0.00001531, -0.01294668),
      L: el(100.46457166, 35999.37244981), longPeri: el(102.93768193, 0.32327364), longNode: el(0, 0),
    },
    systemRadii: (384_400 / 6_371) * SYSTEM_MARGIN,
  },
  moon: {
    // Órbita relativa a la Tierra: se resuelve en astro/moon.ts.
    id: 'moon', name: 'Luna', kind: 'moon', parent: 'earth',
    radiusKm: 1_737.4, axialTiltDeg: 1.54, rotationPeriodH: 655.72, color: 0xbdbab5,
    tidallyLocked: true,
    pole: pole(269.9949, 0.0031, 66.5392, 0.013, 38.3213, 13.17635815),
  },
  mars: {
    id: 'mars', name: 'Marte', kind: 'rocky', parent: 'sun',
    radiusKm: 3_389.5, flattening: 0.00589, axialTiltDeg: 25.19, rotationPeriodH: 24.6229, color: 0xc1440e,
    pole: pole(317.269202, -0.10927547, 54.432516, -0.05827105, 176.049863, 350.891982443297),
    orbit: {
      a: el(1.52371034, 0.00001847), e: el(0.0933941, 0.00007882), i: el(1.84969142, -0.00813131),
      L: el(-4.55343205, 19140.30268499), longPeri: el(-23.94362959, 0.44441088), longNode: el(49.55953891, -0.29257343),
    },
  },
  jupiter: {
    id: 'jupiter', name: 'Júpiter', kind: 'gas', parent: 'sun',
    radiusKm: 69_911, flattening: 0.06487, axialTiltDeg: 3.13, rotationPeriodH: 9.925, color: 0xc9a27e,
    pole: pole(268.056595, -0.006499, 64.495303, 0.002413, 284.95, 870.536),
    orbit: {
      a: el(5.202887, -0.00011607), e: el(0.04838624, -0.00013253), i: el(1.30439695, -0.00183714),
      L: el(34.39644051, 3034.74612775), longPeri: el(14.72847983, 0.21252668), longNode: el(100.47390909, 0.20469106),
    },
    systemRadii: (1_882_700 / 69_911) * SYSTEM_MARGIN,
  },
  io: {
    id: 'io', name: 'Ío', kind: 'moon', parent: 'jupiter',
    radiusKm: 1_821.6, axialTiltDeg: 0, rotationPeriodH: 42.459, color: 0xd9c45a, tidallyLocked: true,
    pole: pole(268.05, -0.009, 64.5, 0.003, 200.39, 203.4889538),
    satellite: {
      a: 421_800, e: 0.004, i: 0, node: 0, peri: 49.1, M: 330.9,
      meanMotion: 203.4889538, anomalisticDays: 1.762732, nodeYears: 0, laplacePole: { ra: 268.1, dec: 64.5 },
    },
  },
  europa: {
    id: 'europa', name: 'Europa', kind: 'moon', parent: 'jupiter',
    radiusKm: 1_560.8, axialTiltDeg: 0.1, rotationPeriodH: 85.228, color: 0xc9b79c, tidallyLocked: true,
    pole: pole(268.08, -0.009, 64.51, 0.003, 36.022, 101.3747235),
    satellite: {
      a: 671_100, e: 0.009, i: 0.5, node: 184.0, peri: 45.0, M: 345.4,
      meanMotion: 101.3747235, anomalisticDays: 3.525463, nodeYears: 30.202, laplacePole: { ra: 268.1, dec: 64.5 },
    },
  },
  ganymede: {
    id: 'ganymede', name: 'Ganímedes', kind: 'moon', parent: 'jupiter',
    radiusKm: 2_634.1, axialTiltDeg: 0.33, rotationPeriodH: 171.709, color: 0x8f8578, tidallyLocked: true,
    pole: pole(268.2, -0.009, 64.57, 0.003, 44.064, 50.3176081),
    satellite: {
      a: 1_070_400, e: 0.001, i: 0.2, node: 58.5, peri: 198.3, M: 324.8,
      meanMotion: 50.3176081, anomalisticDays: 7.155588, nodeYears: 137.812, laplacePole: { ra: 268.2, dec: 64.6 },
    },
  },
  callisto: {
    id: 'callisto', name: 'Calisto', kind: 'moon', parent: 'jupiter',
    radiusKm: 2_410.3, axialTiltDeg: 0, rotationPeriodH: 400.536, color: 0x5f574d, tidallyLocked: true,
    pole: pole(268.72, -0.009, 64.83, 0.003, 259.51, 21.5710715),
    satellite: {
      a: 1_882_700, e: 0.007, i: 0.3, node: 309.1, peri: 43.8, M: 87.4,
      meanMotion: 21.5710715, anomalisticDays: 16.69044, nodeYears: 577.264, laplacePole: { ra: 268.7, dec: 64.8 },
    },
  },
  saturn: {
    id: 'saturn', name: 'Saturno', kind: 'gas', parent: 'sun',
    radiusKm: 58_232, flattening: 0.09796, axialTiltDeg: 26.73, rotationPeriodH: 10.656, color: 0xe3cf9c,
    pole: pole(40.589, -0.036, 83.537, -0.004, 38.9, 810.7939024),
    orbit: {
      a: el(9.53667594, -0.0012506), e: el(0.05386179, -0.00050991), i: el(2.48599187, 0.00193609),
      L: el(49.95424423, 1222.49362201), longPeri: el(92.59887831, -0.41897216), longNode: el(113.66242448, -0.28867794),
    },
    systemRadii: (1_221_900 / 58_232) * SYSTEM_MARGIN,
  },
  titan: {
    id: 'titan', name: 'Titán', kind: 'moon', parent: 'saturn',
    radiusKm: 2_574.7, axialTiltDeg: 0.3, rotationPeriodH: 382.69, color: 0xd99a3c, tidallyLocked: true,
    pole: pole(39.4827, 0, 83.4279, 0, 186.5855, 22.5769768),
    // ω y M ajustados a JPL Horizons (2000, 2013 y 2026, error < 0,4°): con los de la
    // tabla de elementos medios Titán salía 157° desplazado en su órbita.
    satellite: {
      a: 1_221_900, e: 0.029, i: 0.3, node: 78.6, peri: 138.3, M: 154.7,
      meanMotion: 22.5769768, anomalisticDays: 15.945448, nodeYears: 687.37, laplacePole: { ra: 36.4, dec: 84.0 },
    },
  },
  uranus: {
    id: 'uranus', name: 'Urano', kind: 'gas', parent: 'sun',
    radiusKm: 25_362, flattening: 0.0229, axialTiltDeg: 97.77, rotationPeriodH: -17.24, color: 0x9fd8e0,
    pole: pole(257.311, 0, -15.175, 0, 203.81, -501.1600928),
    orbit: {
      a: el(19.18916464, -0.00196176), e: el(0.04725744, -0.00004397), i: el(0.77263783, -0.00242939),
      L: el(313.23810451, 428.48202785), longPeri: el(170.9542763, 0.40805281), longNode: el(74.01692503, 0.04240589),
    },
  },
  neptune: {
    id: 'neptune', name: 'Neptuno', kind: 'gas', parent: 'sun',
    radiusKm: 24_622, flattening: 0.0171, axialTiltDeg: 28.32, rotationPeriodH: 16.11, color: 0x4b70dd,
    pole: pole(299.36, 0, 43.46, 0, 249.978, 541.1397757),
    orbit: {
      a: el(30.06992276, 0.00026291), e: el(0.00859048, 0.00005105), i: el(1.77004347, 0.00035372),
      L: el(-55.12002969, 218.45945325), longPeri: el(44.96476227, -0.32241464), longNode: el(131.78422574, -0.00508664),
    },
    systemRadii: (354_800 / 24_622) * SYSTEM_MARGIN,
  },
  triton: {
    id: 'triton', name: 'Tritón', kind: 'moon', parent: 'neptune',
    radiusKm: 1_353.4, axialTiltDeg: 0, rotationPeriodH: -141.04, color: 0xc3b9b0, tidallyLocked: true,
    pole: pole(299.36, 0, 41.17, 0, 296.53, -61.2572637),
    // Órbita retrógrada (i > 90°) respecto al ecuador de Neptuno. Sin precesión del nodo:
    // con ella (299 años) el error frente a JPL Horizons crecía a 59° en 2026; sin ella, < 7°.
    satellite: {
      a: 354_800, e: 0, i: 157.3, node: 177.7, peri: 0, M: 63.0,
      meanMotion: 61.2572637, anomalisticDays: 5.8792, nodeYears: 0, laplacePole: null,
    },
  },
  pluto: {
    id: 'pluto', name: 'Plutón', kind: 'rocky', parent: 'sun',
    radiusKm: 1_188.3, axialTiltDeg: 122.53, rotationPeriodH: -153.29, color: 0xc9a27c,
    pole: pole(132.993, 0, -6.163, 0, 302.695, 56.3625225),
    orbit: {
      a: el(39.48211675, -0.00031596), e: el(0.2488273, 0.0000517), i: el(17.14001206, 0.00004818),
      L: el(238.92903833, 145.20780515), longPeri: el(224.06891629, -0.04062942), longNode: el(110.30393684, -0.01183482),
    },
    systemRadii: (19_600 / 1_188.3) * SYSTEM_MARGIN,
  },
  charon: {
    id: 'charon', name: 'Caronte', kind: 'moon', parent: 'pluto',
    radiusKm: 606, axialTiltDeg: 0, rotationPeriodH: 153.29, color: 0x8a8580, tidallyLocked: true,
    pole: pole(132.993, 0, -6.163, 0, 122.695, 56.3625225),
    satellite: {
      a: 19_600, e: 0, i: 0, node: 0, peri: 0, M: 304.1,
      meanMotion: 56.3625225, anomalisticDays: 6.387222, nodeYears: 0, laplacePole: null,
    },
  },
  iss: {
    // Radio: media armadura (109 m). Órbita con SGP4 (astro/iss.ts) y actitud de vuelo propia
    // (bodies/Station.ts): el polo no se usa.
    id: 'iss', name: 'ISS', kind: 'station', parent: 'earth',
    radiusKm: 0.0545, axialTiltDeg: 0, rotationPeriodH: 92.9 / 60, color: 0xe4e9f2,
    pole: pole(0, 0, 90, 0, 0, 0),
  },
  halley: comet('halley', 'Halley'),
  encke: comet('encke', 'Encke'),
  churyumov: comet('churyumov', '67P'),
  halebopp: comet('halebopp', 'Hale-Bopp'),
  neowise: comet('neowise', 'NEOWISE'),
  tsuchinshan: comet('tsuchinshan', 'Tsuchinshan-ATLAS'),
  atlas3i: comet('atlas3i', '3I/ATLAS'),
  bok: comet('bok', 'Bok'),
};

/** Los cometas, en el orden del navegador. */
export const COMET_IDS: CometId[] = ['halley', 'encke', 'churyumov', 'halebopp', 'neowise', 'tsuchinshan', 'atlas3i', 'bok'];
