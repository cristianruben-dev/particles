/**
 * Configuración visual de cada cuerpo (texturas, densidad, parámetros artísticos).
 * Los datos físicos están en astro/bodies.ts. Ver docs/ASSETS.md para las texturas.
 */
import type { BodyId } from '../astro/bodies';
import type { BakeNoise } from '../particles/bake';

export interface AtmospherePreset {
  count: number;
  /** Grosor relativo al radio. */
  thickness: number;
  /** Color de día y en el terminador (sRGB). */
  dayColor: number;
  twilightColor: number;
  /** Multiplicador de brillo (1 = Tierra). */
  strength: number;
}

export interface RockyPreset {
  /** Partículas del detalle completo (la vista previa usa `config.lod.previewCount`). */
  count: number;
  textures: {
    albedo?: string;
    height?: string;
    /** Luces nocturnas (solo Tierra). */
    night?: string;
  };
  /** Longitud este del borde izquierdo de los mapas (grados). Por defecto −180. */
  mapLeftLon?: number;
  /** Color (sRGB) que multiplica la textura de albedo, o color base si no hay textura. */
  tint?: number;
  /** Brillo (1 = tal cual). Los cuerpos muy claros lo bajan para no disparar el bloom. */
  gain?: number;
  /** Sin textura: mezcla de dos colores (sRGB) según ruido fractal. */
  noise?: BakeNoise & { colors: [number, number] };
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
  atmosphere?: AtmospherePreset;
  /** Se puede bajar hasta el suelo (§7). */
  surface?: SurfacePreset;
}

export interface SurfacePreset {
  /**
   * Relieve a ras de suelo (radios por unidad de altura normalizada). Menos exagerado que
   * `reliefScale` (pensado para verlo desde la órbita): al bajar, el relieve del globo se
   * modera hasta este valor antes de que aparezcan los chunks.
   */
  relief: number;
  /** Rugosidad del detalle procedural (amplitud / longitud de onda). */
  roughness: number;
  /** Mapa de alturas de más resolución para la superficie (si no, `textures.height`). */
  height?: string;
  heightSize?: { width: number; height: number };
  /** Altura normalizada del radio medio en ese mapa (si no, `heightReference`). */
  reference?: number;
  /** Por debajo, agua en ese mapa (si no, `waterBelow`): con 16 bits la costa se distingue mejor. */
  waterBelow?: number;
}

/** Ruta de una textura de `public/`, con la base del despliegue (en GitHub Pages, una subruta). */
const tex = (body: string, file: string) => `${import.meta.env.BASE_URL}textures/${body}/${file}`;

export const ROCKY_PRESETS: Partial<Record<BodyId, RockyPreset>> = {
  mercury: {
    count: 500_000,
    textures: { albedo: tex('mercury', 'albedo_4k.jpg'), height: tex('mercury', 'height_2k.png') },
    tint: 0xd8cfc4,
    heightReference: 0.5,
    reliefScale: 0.025,
    surface: { relief: 0.008, roughness: 0.04 },
  },
  venus: {
    // Solo se ven las nubes: la superficie (radar de Magellan) no es visible.
    count: 600_000,
    textures: {},
    noise: { scale: 2.2, stretch: 3.5, octaves: 5, colors: [0xf2e2b6, 0xc9a465] },
    gain: 0.6,
    heightReference: 0,
    reliefScale: 0,
    atmosphere: { count: 90_000, thickness: 0.05, dayColor: 0xffe2a8, twilightColor: 0xff9d55, strength: 1.4 },
  },
  earth: {
    count: 1_200_000,
    textures: {
      albedo: tex('earth', 'albedo_4k.jpg'),
      height: tex('earth', 'height_4k.png'),
      night: tex('earth', 'night_3k.jpg'),
    },
    heightReference: 0,
    reliefScale: 0.03,
    waterBelow: 0.5 / 255,
    clouds: { count: 320_000, texture: tex('earth', 'clouds_2k.jpg'), altitude: 0.022 },
    atmosphere: { count: 140_000, thickness: 0.04, dayColor: 0x94c4ff, twilightColor: 0xffad75, strength: 1 },
    // ETOPO 2022 en float16 (8192×4096, 5 km por texel) con la escala del mapa de 8 bits del
    // globo (océano = 0, 1 = 6.396 m, medido con los dos): el suelo no salta en el relevo. Agua: altura ≤ 0.
    surface: {
      relief: 0.0045, roughness: 0.03, waterBelow: 1e-5,
      height: tex('earth', 'height_8k.f16z'), heightSize: { width: 8192, height: 4096 },
    },
  },
  moon: {
    count: 400_000,
    textures: { albedo: tex('moon', 'albedo_2k.jpg'), height: tex('moon', 'height_1k.jpg') },
    heightReference: 0.453,
    reliefScale: 0.04,
    // LOLA de 16 bits (−10 km → 0, +10 km → 1, radio medio en 0,5). El mapa de 8 bits del globo
    // tiene la misma escala con el radio medio en 0,453 (medido): así no salta en el relevo.
    surface: {
      relief: 0.02, roughness: 0.045, reference: 0.5,
      height: tex('moon', 'height_4k.u16'), heightSize: { width: 4096, height: 2048 },
    },
  },
  mars: {
    count: 800_000,
    textures: { albedo: tex('mars', 'albedo_4k.jpg'), height: tex('mars', 'height_3k.png') },
    gain: 1.3,
    heightReference: 0.279,
    reliefScale: 0.035,
    atmosphere: { count: 60_000, thickness: 0.025, dayColor: 0xf3c9a0, twilightColor: 0x6f9bd8, strength: 0.45 },
    // MOLA de 16 bits con la misma escala que el mapa del globo (−8200 m → 0, 21200 m → 1).
    surface: { relief: 0.015, roughness: 0.035, height: tex('mars', 'height_4k.u16'), heightSize: { width: 4096, height: 2048 } },
  },
  io: {
    count: 300_000,
    textures: { albedo: tex('io', 'albedo_2k.jpg') },
    heightReference: 0,
    reliefScale: 0,
    surface: { relief: 0, roughness: 0.03 },
  },
  europa: {
    count: 300_000,
    textures: { albedo: tex('europa', 'albedo_1k.jpg') },
    tint: 0xf0dcc2,
    gain: 0.75,
    heightReference: 0,
    reliefScale: 0,
    surface: { relief: 0, roughness: 0.02 },
  },
  ganymede: {
    count: 300_000,
    textures: { albedo: tex('ganymede', 'albedo_2k.jpg') },
    mapLeftLon: 0,
    heightReference: 0,
    reliefScale: 0,
    surface: { relief: 0, roughness: 0.035 },
  },
  callisto: {
    count: 300_000,
    textures: { albedo: tex('callisto', 'albedo_2k.jpg') },
    mapLeftLon: 0,
    tint: 0xb39d84,
    heightReference: 0,
    reliefScale: 0,
    surface: { relief: 0, roughness: 0.04 },
  },
  titan: {
    // Una bruma naranja espesa tapa la superficie: se intuye debajo.
    count: 250_000,
    textures: { albedo: tex('titan', 'albedo_2k.jpg') },
    mapLeftLon: 0,
    tint: 0xe0973a,
    heightReference: 0,
    reliefScale: 0,
    atmosphere: { count: 120_000, thickness: 0.12, dayColor: 0xffa24a, twilightColor: 0x9a5a22, strength: 2 },
    surface: { relief: 0, roughness: 0.025 },
  },
  triton: {
    count: 250_000,
    textures: { albedo: tex('triton', 'albedo_2k.jpg') },
    heightReference: 0,
    reliefScale: 0,
    surface: { relief: 0, roughness: 0.03 },
  },
  pluto: {
    count: 300_000,
    textures: { albedo: tex('pluto', 'albedo_2k.jpg') },
    mapLeftLon: 0,
    heightReference: 0,
    reliefScale: 0,
    atmosphere: { count: 30_000, thickness: 0.03, dayColor: 0x7fa6ff, twilightColor: 0x7fa6ff, strength: 0.35 },
    surface: { relief: 0, roughness: 0.03 },
  },
  charon: {
    count: 150_000,
    textures: { albedo: tex('charon', 'albedo_2k.jpg') },
    tint: 0xc9b8a8,
    heightReference: 0,
    reliefScale: 0,
    surface: { relief: 0, roughness: 0.035 },
  },
};

/** Gigantes gaseosos: color por textura o por un perfil de bandas en latitud. */
export interface GasPreset {
  count: number;
  /** Mapa cilíndrico real (Júpiter). */
  texture?: string;
  /** Brillo (1 = tal cual): por debajo del umbral del bloom. */
  gain: number;
  /**
   * Bandas procedurales: colores (sRGB) que se reparten de polo a polo, más ruido
   * estirado en longitud para la turbulencia.
   */
  bands?: { colors: number[]; jitter: number; contrast: number };
  noise: BakeNoise;
  /**
   * Velocidad relativa de las bandas (rad/s reales, artística), nº de chorros por hemisferio y
   * latitud (grados) por encima de la que no hay flujo: lo que haya en el polo no se deshace.
   */
  flow: { speed: number; jets: number; calm?: number };
  /** Vórtices: latitud y longitud (grados), radio (radianes) y giro (rad/s, + = antihorario visto desde fuera). */
  vortices: { lat: number; lon: number; radius: number; spin: number }[];
  /** Manchas de color (óvalos): centro y semiejes en longitud y latitud (grados), color (sRGB). */
  spots?: { lat: number; lon: number; width: number; height: number; color: number }[];
  /**
   * Hexágono polar (Saturno): latitud del borde (grados), giro de sus vértices (grados) y colores
   * (sRGB) del interior, del chorro del borde y del vórtice del polo.
   */
  hexagon?: { lat: number; rotation: number; inside: number; jet: number; eye: number };
  atmosphere: AtmospherePreset;
  rings?: RingsPreset;
}

export interface RingsPreset {
  count: number;
  /** Tamaño de partícula respecto a la separación media (menos = anillos más finos y con más aire). */
  overlap: number;
  /** Bordes de cada anillo (km) con su densidad relativa (0–1) y brillo. */
  bands: { inner: number; outer: number; density: number; brightness: number }[];
  color: number;
}

export const GAS_PRESETS: Partial<Record<BodyId, GasPreset>> = {
  jupiter: {
    count: 1_000_000,
    texture: tex('jupiter', 'albedo_4k.jpg'),
    gain: 0.7,
    noise: { scale: 6, stretch: 6, octaves: 4 },
    flow: { speed: 0.02, jets: 6 },
    // Gran Mancha Roja (posición en el mapa de Cassini de dic. 2000).
    vortices: [{ lat: -19.5, lon: -50, radius: 0.12, spin: 0.5 }],
    atmosphere: { count: 120_000, thickness: 0.03, dayColor: 0xffe7c4, twilightColor: 0xd08850, strength: 0.8 },
  },
  saturn: {
    count: 800_000,
    gain: 0.62,
    // No hay un mapa global de Cassini sin anillos: perfil de bandas cada 10° de latitud con los
    // colores de las imágenes de Cassini (2012–2017): zona ecuatorial clara, cinturones
    // ecuatoriales tostados, norte azulado y sur más cálido.
    bands: {
      colors: [
        0x5b6f86, 0x6f8296, 0x9aa08f, 0xb8b08a, 0xcdbf93, 0xd8c79a, 0xd0b885, 0xe2d1a2, 0xd3b67c, 0xeee0b6,
        0xd5b981, 0xe6d6aa, 0xcbb184, 0xd8c79e, 0xc7b48c, 0xbfa985, 0xae9a7c, 0x9a8a74, 0x8e7f6c,
      ],
      jitter: 0.03,
      contrast: 0.5,
    },
    noise: { scale: 5, stretch: 9, octaves: 4 },
    flow: { speed: 0.015, jets: 5, calm: 72 },
    vortices: [],
    // El hexágono del polo norte (chorro a ~78° N, fijo respecto al giro del planeta) con su
    // vórtice en el centro, y algunas tormentas blancas en el «callejón» de los 41° S.
    hexagon: { lat: 77, rotation: 10, inside: 0x4f6b82, jet: 0x9fb2b6, eye: 0x2a3644 },
    spots: [
      { lat: -41, lon: 35, width: 2.4, height: 1.4, color: 0xf2ead4 },
      { lat: -41.5, lon: 160, width: 1.8, height: 1.1, color: 0xefe6cf },
      { lat: -40.5, lon: -95, width: 2.8, height: 1.5, color: 0xf4eedc },
    ],
    atmosphere: { count: 100_000, thickness: 0.03, dayColor: 0xfff0cc, twilightColor: 0xd09a5a, strength: 0.7 },
    rings: {
      count: 700_000,
      overlap: 0.7,
      color: 0xd8c7a3,
      // Perfil radial de Cassini: anillo C, B (el más denso), división de Cassini, A con el hueco de Encke, F.
      bands: [
        { inner: 74_658, outer: 92_000, density: 0.18, brightness: 0.45 },
        { inner: 92_000, outer: 117_580, density: 1, brightness: 1 },
        { inner: 117_580, outer: 122_170, density: 0.08, brightness: 0.5 },
        { inner: 122_170, outer: 133_423, density: 0.6, brightness: 0.85 },
        { inner: 133_745, outer: 136_775, density: 0.55, brightness: 0.8 },
        { inner: 140_080, outer: 140_280, density: 0.4, brightness: 0.9 },
      ],
    },
  },
  uranus: {
    count: 400_000,
    gain: 0.7,
    bands: { colors: [0xb5e3e8, 0xa9dde4, 0x9fd8e0, 0x9fd8e0, 0xa4dbe2, 0xb0e0e6], jitter: 0.02, contrast: 0.3 },
    noise: { scale: 4, stretch: 8, octaves: 3 },
    flow: { speed: 0.01, jets: 2 },
    vortices: [],
    atmosphere: { count: 70_000, thickness: 0.03, dayColor: 0xc8f4ff, twilightColor: 0x6fb6c8, strength: 0.8 },
    rings: {
      count: 40_000,
      overlap: 0.25,
      color: 0x8a8a90,
      // Anillos estrechos y oscuros: 6, 5, 4, α, β, η, γ, δ, ε.
      bands: [
        { inner: 41_837, outer: 41_840, density: 0.3, brightness: 0.4 },
        { inner: 42_234, outer: 42_237, density: 0.3, brightness: 0.4 },
        { inner: 42_571, outer: 42_574, density: 0.3, brightness: 0.4 },
        { inner: 44_718, outer: 44_728, density: 0.5, brightness: 0.45 },
        { inner: 45_661, outer: 45_671, density: 0.5, brightness: 0.45 },
        { inner: 47_176, outer: 47_178, density: 0.3, brightness: 0.4 },
        { inner: 47_627, outer: 47_630, density: 0.4, brightness: 0.45 },
        { inner: 48_300, outer: 48_306, density: 0.4, brightness: 0.45 },
        { inner: 51_140, outer: 51_198, density: 1, brightness: 0.6 },
      ],
    },
  },
  neptune: {
    count: 400_000,
    gain: 0.85,
    bands: { colors: [0x5a7fd6, 0x3f63c9, 0x4b70dd, 0x3a5fd0, 0x4b70dd, 0x6d90e6], jitter: 0.04, contrast: 0.5 },
    noise: { scale: 5, stretch: 7, octaves: 4 },
    flow: { speed: 0.025, jets: 2 },
    // Gran Mancha Oscura (Voyager 2, 1989): un toque artístico, con sus nubes blancas
    // compañeras al sur y el «Scooter».
    vortices: [{ lat: -22, lon: 60, radius: 0.13, spin: -0.6 }],
    spots: [
      { lat: -22, lon: 60, width: 13, height: 6.5, color: 0x1f3170 },
      { lat: -28.5, lon: 63, width: 7, height: 1.2, color: 0xe8f0ff },
      { lat: -42, lon: 15, width: 2.5, height: 1.4, color: 0xf2f6ff },
    ],
    atmosphere: { count: 70_000, thickness: 0.03, dayColor: 0x8fb4ff, twilightColor: 0x3d5aa8, strength: 0.9 },
  },
};
