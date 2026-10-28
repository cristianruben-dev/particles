/**
 * Galaxias que se pueden visitar (§14.4–14.5): la Vía Láctea, el Grupo Local y algunas de
 * las más conocidas de alrededor.
 *
 * Datos comprobados el 28/10/2026 (cada galaxia lleva los suyos en `refs`):
 * - **Posición** (AR/Dec ICRS), **velocidad radial** del Grupo Local (McConnachie 2012) y
 *   **ángulo de posición** del eje mayor (HyperLEDA, Paturel et al. 2003): SIMBAD.
 * - **Distancia, diámetro** (isofota D25 del RC3, de Vaucouleurs et al. 1991, salvo donde se
 *   dice), **tipo de Hubble** y velocidad radial de las demás: NED, a través de las fichas de
 *   Wikipedia, que citan el catálogo o el artículo de cada valor.
 * - **Inclinación**: estudios cinemáticos o del perfil del disco (en `refs`); en las
 *   irregulares sin disco claro, la que da la proporción de ejes de SIMBAD.
 * - **Estrellas**: la estimación divulgativa que citan esas fichas; si no la hay, no se pone.
 *
 * La forma es una plantilla por tipo (`cosmos/galaxyModel.ts`) con la inclinación y el ángulo
 * de posición de cada una. Qué lado del disco está más cerca no se sabe en general: se toma
 * siempre el mismo (el borde "de abajo" del eje menor, `basis`).
 */
import { eclToScene, equatorialToEcliptic, raDecToVector, type Vec3d } from './frames';
import { DEG, LY_KM } from './units';

export type GalaxyId = 'milkyway' | 'm31' | 'm33' | 'lmc' | 'smc' | 'm32' | 'm110' | 'm81' | 'm82' | 'cena' | 'm51' | 'm101' | 'm104' | 'm87';

export type GalaxyShape =
  /** Disco con brazos: número, paso (°), barra (semilongitud en radios), bulbo y polvo (0–1), anillo de polvo y estrellas (radios). */
  | { kind: 'spiral'; arms: number; pitchDeg: number; bar: number; bulge: number; dust: number; young: number; ring?: number }
  /**
   * Esferoide: ejes relativos al mayor (el segundo es el que se ve en el cielo con inclinación
   * 90°: la proporción de ejes de SIMBAD); disco de polvo atravesado (radios) y chorro.
   */
  | { kind: 'elliptical'; axes: [number, number]; dustDisk?: number; jet?: boolean }
  /** Irregular: barra descentrada (radios), grumos de formación de estrellas y viento del centro (M82). */
  | { kind: 'irregular'; bar: number; clumps: number; wind?: boolean }
  /** Bulbo enorme con un anillo de polvo fino (el Sombrero). */
  | { kind: 'lenticular'; bulge: number; dustRing: number };

export interface GalaxyData {
  id: GalaxyId;
  name: string;
  /** Nombre corto para el navegador, si el completo es largo. */
  short?: string;
  /** «Galaxia espiral», «Elíptica gigante»… */
  type: string;
  /** Clasificación de Hubble (de Vaucouleurs). */
  hubble: string;
  group: string;
  /** Satélite de otra galaxia: va en la fila de encima del navegador, como las lunas. */
  parent?: GalaxyId;
  raDeg: number;
  decDeg: number;
  distanceLy: number;
  diameterLy: number;
  /** Inclinación del disco (0° = de cara) y ángulo de posición del eje mayor (desde el norte hacia el este). */
  inclinationDeg: number;
  paDeg: number;
  /** Velocidad radial heliocéntrica (km/s; negativa = se acerca), si hay una medida precisa. */
  radialKmS?: number;
  /** Estrellas, en palabras (estimación habitual), si hay una con fuente. */
  stars?: string;
  /** Luz relativa a la Vía Láctea (≈ masa en estrellas), solo para el brillo del modelo. */
  light: number;
  shape: GalaxyShape;
  /** Color del navegador y del acento de la interfaz. */
  color: number;
  /** Partículas del modelo. */
  particles: number;
  blurb: string;
  /** De dónde sale cada dato que no es de SIMBAD (se enseña en la ficha). */
  refs: string;
}

export const GALAXIES: Record<GalaxyId, GalaxyData> = {
  milkyway: {
    id: 'milkyway', name: 'Vía Láctea', type: 'Galaxia espiral barrada', hubble: 'SB(rs)bc', group: 'Grupo Local',
    raDeg: 266.405, decDeg: -28.936, distanceLy: 26_670, diameterLy: 87_400, inclinationDeg: 90, paDeg: 0,
    stars: '100.000–400.000 millones', light: 1,
    shape: { kind: 'spiral', arms: 4, pitchDeg: 11, bar: 0.3, bulge: 0.15, dust: 0.6, young: 0.4 },
    color: 0xf2e6cf, particles: 0,
    blurb: 'Nuestra galaxia, vista desde fuera como sería según los mapas: cientos de miles de millones de estrellas en un disco con una barra y varios brazos. El Sol está a unos 26.700 años luz del centro, en el brazo de Orión, y da una vuelta en algo más de 200 millones de años.',
    refs: 'Del Sol al centro: 8,18 kpc (GRAVITY 2019). Diámetro D25: Goodwin et al. Estrellas: estimación habitual.',
  },
  m31: {
    id: 'm31', name: 'Andrómeda', type: 'Galaxia espiral', hubble: 'SA(s)b', group: 'Grupo Local',
    raDeg: 10.68471, decDeg: 41.26875, distanceLy: 2.5e6, diameterLy: 152_000, inclinationDeg: 77, paDeg: 35, radialKmS: -300,
    stars: '≈ 1 billón', light: 1.7,
    shape: { kind: 'spiral', arms: 2, pitchDeg: 8, bar: 0.08, bulge: 0.3, dust: 0.8, young: 0.3, ring: 0.45 },
    color: 0xe8dcc6, particles: 260_000,
    blurb: 'La galaxia grande más cercana y la mayor del Grupo Local; desde un cielo oscuro se ve a simple vista, como una mancha alargada en la constelación de Andrómeda. Se acerca a nosotros, pero si chocará con la Vía Láctea sigue en discusión: con datos de Gaia y el Hubble, un estudio de 2025 daba un 50 % en los próximos 10.000 millones de años y otro de 2026, un 90 % (hacia dentro de 6.500 millones).',
    refs: 'Distancia: 765 kpc (NED). Inclinación: 77°. Choque: Sawala et al. 2025; Wu, Zhang et al. 2026.',
  },
  m33: {
    id: 'm33', name: 'Triángulo', type: 'Galaxia espiral', hubble: 'SA(s)cd', group: 'Grupo Local',
    raDeg: 23.46207, decDeg: 30.66018, distanceLy: 2.88e6, diameterLy: 61_100, inclinationDeg: 54, paDeg: 22, radialKmS: -179,
    stars: '30.000–40.000 millones', light: 0.12,
    shape: { kind: 'spiral', arms: 2, pitchDeg: 26, bar: 0, bulge: 0.04, dust: 0.4, young: 0.6 },
    color: 0xbccaff, particles: 90_000,
    blurb: 'La tercera del Grupo Local: una espiral abierta, llena de regiones donde nacen estrellas. Una de ellas, NGC 604, mide casi 1.500 años luz y es de las regiones HII más grandes que se conocen.',
    refs: 'Distancia: 883 kpc (NED). Inclinación: 54° (Heyer et al. 2004; Verley et al. 2009).',
  },
  lmc: {
    id: 'lmc', name: 'Gran Nube de Magallanes', short: 'Gran Nube', type: 'Galaxia enana irregular', hubble: 'SB(s)m', group: 'Satélite de la Vía Láctea', parent: 'milkyway',
    raDeg: 80.89417, decDeg: -69.75611, distanceLy: 163_000, diameterLy: 32_200, inclinationDeg: 35, paDeg: 170, radialKmS: 262,
    stars: '≈ 20.000 millones', light: 0.05,
    shape: { kind: 'irregular', bar: 0.35, clumps: 14 },
    color: 0xc9d6ff, particles: 70_000,
    blurb: 'La mayor de las galaxias satélite de la Vía Láctea, visible a simple vista desde el hemisferio sur. Tiene la Nebulosa de la Tarántula, la región de formación de estrellas más activa del Grupo Local, y en ella estalló en 1987 la supernova SN 1987A, la más cercana de las últimas décadas.',
    refs: 'Distancia: 49,97 kpc (Pietrzyński et al. 2013). Inclinación: ~35° (van der Marel y Cioni 2001; Olsen y Salyk 2002; Nikolaev et al. 2004).',
  },
  smc: {
    id: 'smc', name: 'Pequeña Nube de Magallanes', short: 'Pequeña Nube', type: 'Galaxia enana irregular', hubble: 'SB(s)m pec', group: 'Satélite de la Vía Láctea', parent: 'milkyway',
    raDeg: 13.15833, decDeg: -72.80028, distanceLy: 203_700, diameterLy: 18_900, inclinationDeg: 54, paDeg: 45, radialKmS: 146,
    stars: 'cientos de millones a ~3.000 millones (según la fuente)', light: 0.008,
    shape: { kind: 'irregular', bar: 0.25, clumps: 7 },
    color: 0xd3dbf2, particles: 35_000,
    blurb: 'Compañera de la Gran Nube, unida a ella por un puente de gas donde también nacen estrellas. Detrás de las dos se extiende la Corriente de Magallanes, una cinta de gas de más de 140° en el cielo.',
    refs: 'Distancia: 62,44 kpc (Graczyk et al. 2020). Inclinación: la de la proporción de ejes (no tiene un disco claro). Corriente: Nidever et al. 2010.',
  },
  m32: {
    id: 'm32', name: 'M32', type: 'Galaxia elíptica compacta', hubble: 'cE2', group: 'Satélite de Andrómeda', parent: 'm31',
    raDeg: 10.67427, decDeg: 40.86517, distanceLy: 2.49e6, diameterLy: 8_000, inclinationDeg: 90, paDeg: 160, radialKmS: -199,
    light: 0.015,
    shape: { kind: 'elliptical', axes: [0.81, 0.81] },
    color: 0xffe2b8, particles: 15_000,
    blurb: 'Satélite de Andrómeda y prototipo de las elípticas compactas, muy densa en el centro. Podría ser lo que queda de una galaxia espiral mayor que se fusionó con Andrómeda hace unos 2.000 millones de años.',
    refs: 'Distancia: 763 kpc (Jensen et al. 2003; Karachentsev et al. 2004). Diámetro: estimado (NED). Origen: D’Souza y Bell 2018.',
  },
  m110: {
    id: 'm110', name: 'M110', type: 'Galaxia elíptica enana', hubble: 'E5 pec', group: 'Satélite de Andrómeda', parent: 'm31',
    raDeg: 10.0919, decDeg: 41.68542, distanceLy: 2.69e6, diameterLy: 17_050, inclinationDeg: 90, paDeg: 165, radialKmS: -246,
    light: 0.015,
    shape: { kind: 'elliptical', axes: [0.63, 0.63] },
    color: 0xf2dcc0, particles: 25_000,
    blurb: 'El otro gran satélite de Andrómeda: una elíptica alargada que lleva el «pec» de peculiar por las manchas de polvo y las estrellas jóvenes y azules de su centro, raras en este tipo de galaxias.',
    refs: 'Distancia: 825 kpc (McConnachie et al. 2005). Diámetro: estimado (NED). Polvo y estrellas jóvenes: Ford et al. 1973.',
  },
  m81: {
    id: 'm81', name: 'Galaxia de Bode', short: 'M81', type: 'Galaxia espiral', hubble: 'SA(s)ab', group: 'Grupo de M81',
    raDeg: 148.88822, decDeg: 69.0653, distanceLy: 12.0e6, diameterLy: 96_000, inclinationDeg: 59, paDeg: 157,
    light: 1.1,
    shape: { kind: 'spiral', arms: 2, pitchDeg: 14, bar: 0, bulge: 0.35, dust: 0.6, young: 0.35 },
    color: 0xe6dccb, particles: 140_000,
    blurb: 'M81, una espiral de manual: dos brazos limpios y un bulbo grande. Hace unos 200 a 500 millones de años pasó cerca de M82; las mareas arrancaron hidrógeno de las galaxias del grupo y lo dejaron en filamentos entre ellas.',
    refs: 'Distancia: 3,675 Mpc (NED). Inclinación: 59° (Rots 1975; de Blok et al. 2008). Filamentos: Yun, Ho y Lo 1994. Encuentro: Barker et al. 2008.',
  },
  m82: {
    id: 'm82', name: 'Galaxia del Cigarro', short: 'Cigarro', type: 'Galaxia con brote estelar', hubble: 'I0', group: 'Grupo de M81', parent: 'm81',
    raDeg: 148.96846, decDeg: 69.6797, distanceLy: 11.9e6, diameterLy: 40_800, inclinationDeg: 80, paDeg: 65, radialKmS: 269,
    light: 0.17,
    shape: { kind: 'irregular', bar: 0.6, clumps: 10, wind: true },
    color: 0xffc4a6, particles: 60_000,
    blurb: 'M82, vista casi de canto. En ella nacen estrellas unas diez veces más deprisa que en toda la Vía Láctea, y las supernovas de su centro (una cada diez años) soplan un viento que sale por encima y por debajo del disco.',
    refs: 'Distancia: 3,5–3,8 Mpc (Karachentsev y Kashibadze 2006). Inclinación ~80° y viento: Barker et al. 2008. Ángulo de posición: RC3.',
  },
  cena: {
    id: 'cena', name: 'Centaurus A', type: 'Galaxia elíptica con polvo', hubble: 'S0 pec', group: 'Grupo de Centaurus A',
    raDeg: 201.36507, decDeg: -43.01911, distanceLy: 12e6, diameterLy: 123_100, inclinationDeg: 75, paDeg: 120, radialKmS: 547,
    light: 1.6,
    shape: { kind: 'elliptical', axes: [0.85, 0.8], dustDisk: 0.35, jet: true },
    color: 0xf0d8b4, particles: 120_000,
    blurb: 'La radiogalaxia más cercana: una gran elíptica cruzada por una franja de polvo, que se explica como el resto de una espiral pequeña con la que se fusionó. Sus chorros de radio miden más de un millón de años luz.',
    refs: 'Distancia: 11–13 millones de años luz (3–5 Mpc según el método). Diámetro: estimado (NED). Franja de polvo: ~120°, casi perpendicular al eje mayor (33° en SIMBAD); alabeada, su inclinación es aproximada. Fusión: Baade y Minkowski 1954; Quillen et al. 2006.',
  },
  m51: {
    id: 'm51', name: 'Galaxia del Remolino', short: 'Remolino', type: 'Galaxia espiral', hubble: 'SA(s)bc pec', group: 'Grupo de M51',
    raDeg: 202.46958, decDeg: 47.19526, distanceLy: 23.5e6, diameterLy: 76_900, inclinationDeg: 22, paDeg: 173, radialKmS: 460,
    light: 0.8,
    shape: { kind: 'spiral', arms: 2, pitchDeg: 18, bar: 0, bulge: 0.18, dust: 0.85, young: 0.45 },
    color: 0xc8d2ff, particles: 120_000,
    blurb: 'M51, el primer objeto en el que se vio una forma espiral (Lord Rosse, 1845), mucho antes de saber que eran galaxias. Sus brazos tan marcados se deben a NGC 5195, la pequeña compañera, que atravesó su disco hace unos 500 a 600 millones de años.',
    refs: 'Distancia: 7,22 Mpc (NED). Velocidad: la de su corrimiento al rojo (NED). Inclinación 22° y ángulo de posición 173°: Colombo et al. 2014. Encuentro: Salo y Laurikainen 1999.',
  },
  m101: {
    id: 'm101', name: 'Galaxia del Molinete', short: 'Molinete', type: 'Galaxia espiral', hubble: 'SAB(rs)cd', group: 'Grupo de M101',
    raDeg: 210.80243, decDeg: 54.34875, distanceLy: 21e6, diameterLy: 170_000, inclinationDeg: 18, paDeg: 39, radialKmS: 241,
    stars: '≈ 1 billón', light: 1.2,
    shape: { kind: 'spiral', arms: 4, pitchDeg: 22, bar: 0.04, bulge: 0.07, dust: 0.5, young: 0.6 },
    color: 0xc2d0ff, particles: 160_000,
    blurb: 'M101: casi el doble de ancha que la Vía Láctea y vista de frente, con brazos asimétricos llenos de regiones donde nacen estrellas. En 2011 estalló en ella SN 2011fe, una supernova de tipo Ia que fue la más brillante de ese año.',
    refs: 'Distancia: 6,4 Mpc (Shappee y Stanek 2011). Diámetro: NASA. Inclinación 18° y ángulo de posición 39°: mal determinados (la galaxia está casi de frente).',
  },
  m104: {
    id: 'm104', name: 'Galaxia del Sombrero', short: 'Sombrero', type: 'Galaxia espiral casi lenticular', hubble: 'SA(s)a', group: 'Al sur del cúmulo de Virgo',
    raDeg: 189.99763, decDeg: -11.62305, distanceLy: 31.1e6, diameterLy: 94_900, inclinationDeg: 84, paDeg: 90, radialKmS: 1024,
    light: 1.8,
    shape: { kind: 'lenticular', bulge: 0.6, dustRing: 0.55 },
    color: 0xf2e2c8, particles: 120_000,
    blurb: 'M104, vista casi de canto: un bulbo enorme y brillante cortado por un anillo de polvo oscuro le dan su forma de sombrero. Tiene entre 1.200 y 2.000 cúmulos globulares, muchos más que la Vía Láctea (unos 150).',
    refs: 'Distancia: 9,55 Mpc (McQuinn et al. 2016). Inclinación: 84° (MPIfR, Atlas of Galaxies). Cúmulos globulares: Wakamatsu 1977; Harris et al. 1984; Bridges y Hanes 1992.',
  },
  m87: {
    id: 'm87', name: 'M87', type: 'Galaxia elíptica gigante', hubble: 'E+0-1 pec', group: 'Cúmulo de Virgo',
    raDeg: 187.70593, decDeg: 12.39112, distanceLy: 53.5e6, diameterLy: 132_000, inclinationDeg: 90, paDeg: 288, radialKmS: 1284,
    stars: 'varios billones', light: 8,
    shape: { kind: 'elliptical', axes: [0.91, 0.91], jet: true },
    color: 0xffe2b4, particles: 140_000,
    blurb: 'La galaxia central del cúmulo de Virgo: una bola gigante de varios billones de estrellas, con unos 12.000 a 15.000 cúmulos globulares. Su agujero negro, de 6.500 millones de soles, fue el primero fotografiado (Event Horizon Telescope, 2019); de él sale un chorro de unos 4.900 años luz.',
    refs: 'Distancia: 16,4 Mpc (Bird et al. 2010). Velocidad: Cappellari et al. 2011. Agujero negro: EHT 2019. El modelo pone el eje mayor en la dirección del chorro (~288°, Nalewajko et al. 2020).',
  },
};

/** Orden del navegador: la Vía Láctea y las grandes; los satélites, encima, como las lunas. */
export const GALAXY_IDS = Object.keys(GALAXIES) as GalaxyId[];

/** Centro respecto al Sol (km, ejes de escena). La Vía Láctea: su centro. */
export function galaxyCenterKm(g: GalaxyData): Vec3d {
  const d = sceneDir(g.raDeg, g.decDeg);
  const km = g.distanceLy * LY_KM;
  return { x: d.x * km, y: d.y * km, z: d.z * km };
}

/**
 * Ejes del disco en ejes de escena: `major` (eje mayor), `minor` (el otro eje del disco) y
 * `normal`. El eje mayor va en el cielo con el ángulo de posición (del norte hacia el este);
 * el disco se inclina sobre él la inclinación, con el borde "de abajo" del eje menor más cerca.
 */
export function galaxyBasis(g: GalaxyData): { major: Vec3d; minor: Vec3d; normal: Vec3d } {
  const a = g.raDeg * DEG, d = g.decDeg * DEG;
  const toward = raDecToVector(a, d);
  const north = { x: -Math.sin(d) * Math.cos(a), y: -Math.sin(d) * Math.sin(a), z: Math.cos(d) };
  const east = { x: -Math.sin(a), y: Math.cos(a), z: 0 };
  const pa = g.paDeg * DEG, inc = g.inclinationDeg * DEG;
  const major = comb(north, Math.cos(pa), east, Math.sin(pa));
  const skyMinor = comb(north, -Math.sin(pa), east, Math.cos(pa));
  const minor = comb(skyMinor, Math.cos(inc), toward, Math.sin(inc));
  const normal = cross(major, minor);
  const scene = (v: Vec3d) => eclToScene(equatorialToEcliptic(v));
  return { major: scene(major), minor: scene(minor), normal: scene(normal) };
}

function sceneDir(raDeg: number, decDeg: number): Vec3d {
  return eclToScene(equatorialToEcliptic(raDecToVector(raDeg * DEG, decDeg * DEG)));
}

const comb = (a: Vec3d, ka: number, b: Vec3d, kb: number): Vec3d => ({ x: a.x * ka + b.x * kb, y: a.y * ka + b.y * kb, z: a.z * ka + b.z * kb });
const cross = (a: Vec3d, b: Vec3d): Vec3d => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
