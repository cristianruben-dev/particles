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
}

const tex = (body: string, file: string) => `/textures/${body}/${file}`;

export const ROCKY_PRESETS: Partial<Record<BodyId, RockyPreset>> = {
  mercury: {
    count: 500_000,
    textures: { albedo: tex('mercury', 'albedo_4k.jpg'), height: tex('mercury', 'height_2k.png') },
    tint: 0xd8cfc4,
    heightReference: 0.5,
    reliefScale: 0.025,
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
  },
  moon: {
    count: 400_000,
    textures: { albedo: tex('moon', 'albedo_2k.jpg'), height: tex('moon', 'height_1k.jpg') },
    heightReference: 0.5,
    reliefScale: 0.04,
  },
  mars: {
    count: 800_000,
    textures: { albedo: tex('mars', 'albedo_4k.jpg'), height: tex('mars', 'height_3k.png') },
    gain: 1.3,
    heightReference: 0.28,
    reliefScale: 0.035,
    atmosphere: { count: 60_000, thickness: 0.025, dayColor: 0xf3c9a0, twilightColor: 0x6f9bd8, strength: 0.45 },
  },
  io: {
    count: 300_000,
    textures: { albedo: tex('io', 'albedo_2k.jpg') },
    heightReference: 0,
    reliefScale: 0,
  },
  europa: {
    count: 300_000,
    textures: { albedo: tex('europa', 'albedo_1k.jpg') },
    tint: 0xf0dcc2,
    gain: 0.75,
    heightReference: 0,
    reliefScale: 0,
  },
  ganymede: {
    count: 300_000,
    textures: { albedo: tex('ganymede', 'albedo_2k.jpg') },
    mapLeftLon: 0,
    heightReference: 0,
    reliefScale: 0,
  },
  callisto: {
    count: 300_000,
    textures: { albedo: tex('callisto', 'albedo_2k.jpg') },
    mapLeftLon: 0,
    tint: 0xb39d84,
    heightReference: 0,
    reliefScale: 0,
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
  },
  triton: {
    count: 250_000,
    textures: { albedo: tex('triton', 'albedo_2k.jpg') },
    heightReference: 0,
    reliefScale: 0,
  },
  pluto: {
    count: 300_000,
    textures: { albedo: tex('pluto', 'albedo_2k.jpg') },
    mapLeftLon: 0,
    heightReference: 0,
    reliefScale: 0,
    atmosphere: { count: 30_000, thickness: 0.03, dayColor: 0x7fa6ff, twilightColor: 0x7fa6ff, strength: 0.35 },
  },
  charon: {
    count: 150_000,
    textures: { albedo: tex('charon', 'albedo_2k.jpg') },
    tint: 0xc9b8a8,
    heightReference: 0,
    reliefScale: 0,
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
  /** Velocidad relativa de las bandas (rad/s reales, artística) y nº de chorros por hemisferio. */
  flow: { speed: number; jets: number };
  /** Vórtices: latitud y longitud (grados), radio (radianes) y giro (rad/s, + = antihorario visto desde fuera). */
  vortices: { lat: number; lon: number; radius: number; spin: number }[];
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
    bands: {
      colors: [0x7f8fa6, 0xb8a985, 0xd9c9a0, 0xe6d6ae, 0xd8c08c, 0xeadcb5, 0xe3cf9c, 0xd9c08a, 0xe8d8b0, 0xc9b48a, 0x8a8f9a],
      jitter: 0.05,
      contrast: 0.6,
    },
    noise: { scale: 5, stretch: 9, octaves: 4 },
    flow: { speed: 0.015, jets: 5 },
    vortices: [],
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
    // Gran Mancha Oscura (Voyager 2, 1989): un toque artístico.
    vortices: [{ lat: -22, lon: 60, radius: 0.13, spin: -0.6 }],
    atmosphere: { count: 70_000, thickness: 0.03, dayColor: 0x8fb4ff, twilightColor: 0x3d5aa8, strength: 0.9 },
  },
};
