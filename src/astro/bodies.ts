/**
 * Tabla de datos de los cuerpos celestes. Ver docs/ARQUITECTURA.md §5 y §8.
 *
 * Elementos orbitales: JPL "Keplerian Elements for Approximate Positions of the
 * Major Planets" (Tabla 1, 1800–2050), valor en J2000 + tasa por siglo.
 */

export type BodyId =
  | 'sun'
  | 'mercury'
  | 'venus'
  | 'earth'
  | 'moon'
  | 'mars'
  | 'jupiter'
  | 'saturn'
  | 'uranus'
  | 'neptune';

/** Qué clase de `bodies/` renderiza el cuerpo. */
export type BodyKind = 'star' | 'rocky' | 'gas' | 'moon';

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

export interface BodyData {
  id: BodyId;
  name: string;
  kind: BodyKind;
  parent: BodyId | null;
  /** Radio medio (km). */
  radiusKm: number;
  /** Inclinación del eje respecto a la eclíptica (grados). */
  axialTiltDeg: number;
  /** Periodo de rotación sidéreo (horas). Negativo = retrógrado. */
  rotationPeriodH: number;
  /** Color medio, usado en LOD L0/L1 antes de cargar texturas. */
  color: number;
  /** Rotación síncrona: siempre muestra la misma cara (lon 0°) a su padre. */
  tidallyLocked?: boolean;
  orbit: OrbitalElements | null;
}

const el = (value: number, ratePerCentury: number): OrbitalElement => ({ value, ratePerCentury });

export const BODIES: Record<BodyId, BodyData> = {
  sun: {
    id: 'sun', name: 'Sol', kind: 'star', parent: null,
    radiusKm: 695_700, axialTiltDeg: 7.25, rotationPeriodH: 609.12, color: 0xffd27a,
    orbit: null,
  },
  mercury: {
    id: 'mercury', name: 'Mercurio', kind: 'rocky', parent: 'sun',
    radiusKm: 2_439.7, axialTiltDeg: 0.03, rotationPeriodH: 1_407.6, color: 0x9c958f,
    orbit: {
      a: el(0.38709927, 0.00000037), e: el(0.20563593, 0.00001906), i: el(7.00497902, -0.00594749),
      L: el(252.2503235, 149472.67411175), longPeri: el(77.45779628, 0.16047689), longNode: el(48.33076593, -0.12534081),
    },
  },
  venus: {
    id: 'venus', name: 'Venus', kind: 'rocky', parent: 'sun',
    radiusKm: 6_051.8, axialTiltDeg: 177.36, rotationPeriodH: -5_832.5, color: 0xe8cda2,
    orbit: {
      a: el(0.72333566, 0.0000039), e: el(0.00677672, -0.00004107), i: el(3.39467605, -0.0007889),
      L: el(181.9790995, 58517.81538729), longPeri: el(131.60246718, 0.00268329), longNode: el(76.67984255, -0.27769418),
    },
  },
  earth: {
    id: 'earth', name: 'Tierra', kind: 'rocky', parent: 'sun',
    radiusKm: 6_371.0, axialTiltDeg: 23.44, rotationPeriodH: 23.9345, color: 0x3a6fd8,
    orbit: {
      a: el(1.00000261, 0.00000562), e: el(0.01671123, -0.00004392), i: el(-0.00001531, -0.01294668),
      L: el(100.46457166, 35999.37244981), longPeri: el(102.93768193, 0.32327364), longNode: el(0, 0),
    },
  },
  moon: {
    // Órbita relativa a la Tierra: se resuelve en astro/moon.ts.
    id: 'moon', name: 'Luna', kind: 'moon', parent: 'earth',
    radiusKm: 1_737.4, axialTiltDeg: 1.54, rotationPeriodH: 655.72, color: 0xbdbab5,
    tidallyLocked: true, orbit: null,
  },
  mars: {
    id: 'mars', name: 'Marte', kind: 'rocky', parent: 'sun',
    radiusKm: 3_389.5, axialTiltDeg: 25.19, rotationPeriodH: 24.6229, color: 0xc1440e,
    orbit: {
      a: el(1.52371034, 0.00001847), e: el(0.0933941, 0.00007882), i: el(1.84969142, -0.00813131),
      L: el(-4.55343205, 19140.30268499), longPeri: el(-23.94362959, 0.44441088), longNode: el(49.55953891, -0.29257343),
    },
  },
  jupiter: {
    id: 'jupiter', name: 'Júpiter', kind: 'gas', parent: 'sun',
    radiusKm: 69_911, axialTiltDeg: 3.13, rotationPeriodH: 9.925, color: 0xc9a27e,
    orbit: {
      a: el(5.202887, -0.00011607), e: el(0.04838624, -0.00013253), i: el(1.30439695, -0.00183714),
      L: el(34.39644051, 3034.74612775), longPeri: el(14.72847983, 0.21252668), longNode: el(100.47390909, 0.20469106),
    },
  },
  saturn: {
    id: 'saturn', name: 'Saturno', kind: 'gas', parent: 'sun',
    radiusKm: 58_232, axialTiltDeg: 26.73, rotationPeriodH: 10.656, color: 0xe3cf9c,
    orbit: {
      a: el(9.53667594, -0.0012506), e: el(0.05386179, -0.00050991), i: el(2.48599187, 0.00193609),
      L: el(49.95424423, 1222.49362201), longPeri: el(92.59887831, -0.41897216), longNode: el(113.66242448, -0.28867794),
    },
  },
  uranus: {
    id: 'uranus', name: 'Urano', kind: 'gas', parent: 'sun',
    radiusKm: 25_362, axialTiltDeg: 97.77, rotationPeriodH: -17.24, color: 0x9fd8e0,
    orbit: {
      a: el(19.18916464, -0.00196176), e: el(0.04725744, -0.00004397), i: el(0.77263783, -0.00242939),
      L: el(313.23810451, 428.48202785), longPeri: el(170.9542763, 0.40805281), longNode: el(74.01692503, 0.04240589),
    },
  },
  neptune: {
    id: 'neptune', name: 'Neptuno', kind: 'gas', parent: 'sun',
    radiusKm: 24_622, axialTiltDeg: 28.32, rotationPeriodH: 16.11, color: 0x4b70dd,
    orbit: {
      a: el(30.06992276, 0.00026291), e: el(0.00859048, 0.00005105), i: el(1.77004347, 0.00035372),
      L: el(-55.12002969, 218.45945325), longPeri: el(44.96476227, -0.32241464), longNode: el(131.78422574, -0.00508664),
    },
  },
};
