/**
 * Datos físicos y descripción de cada cuerpo para la ficha de la UI. Ver docs/ARQUITECTURA.md §11.
 *
 * - Planetas, Luna y Plutón: NASA NSSDCA «Planetary Fact Sheet — Metric»
 *   (nssdc.gsfc.nasa.gov/planetary/factsheet, consultada el 27/10/2026): masa, temperatura
 *   media, presión en superficie y número de lunas conocidas.
 * - Lunas: JPL SSD «Planetary Satellite Physical Parameters» (ssd.jpl.nasa.gov/sats/phys_par):
 *   GM → masa con G = 6,6743·10⁻¹¹.
 * - Sol: NASA «Sun Fact Sheet» (masa) y temperatura efectiva nominal de la IAU (2015).
 * - Titán: temperatura y presión medidas por la Huygens (2005); Tritón: Voyager 2 (1989).
 * Radio, inclinación del eje y rotación salen de `bodies.ts`; la gravedad y la velocidad de
 * escape se calculan con la masa y ese radio, y el periodo orbital con los elementos orbitales.
 */
import type { BodyId } from './bodies';

export const G = 6.6743e-11;

export interface LandingSite {
  /** Como se lee tras «en»: «el Himalaya», «Valles Marineris». */
  name: string;
  /** Latitud y longitud planetocéntricas (grados, este positivo). */
  lat: number;
  lon: number;
}

export interface BodyFacts {
  /** «Planeta rocoso», «Gigante de hielo»… (las lunas: «Luna de …», lo compone la UI). */
  type: string;
  massKg: number;
  meanTempC?: number;
  /** Presión en superficie (bar); null si no tiene superficie sólida. */
  pressureBar?: number | null;
  moons?: number;
  /** Periodo orbital alrededor de su padre (días), si no sale de los elementos orbitales. */
  orbitDays?: number;
  blurb: string;
  /** Un lugar reconocible donde aterrizar (los cuerpos con superficie). */
  site?: LandingSite;
}

const fromGM = (gm: number) => (gm * 1e9) / G;

export const FACTS: Record<BodyId, BodyFacts> = {
  sun: {
    type: 'Estrella', massKg: 1.9885e30, meanTempC: 5772 - 273.15,
    blurb: 'Una enana amarilla que reúne el 99,8 % de la masa del sistema. Su luz tarda poco más de 8 minutos en llegar a la Tierra.',
  },
  mercury: {
    type: 'Planeta rocoso', massKg: 0.330e24, meanTempC: 167, pressureBar: 0, moons: 0,
    blurb: 'El planeta más pequeño y el más cercano al Sol. Casi sin atmósfera, pasa de más de 400 °C de día a −180 °C de noche.',
    site: { name: 'la cuenca Caloris', lat: 31.5, lon: 162.7 },
  },
  venus: {
    type: 'Planeta rocoso', massKg: 4.87e24, meanTempC: 464, pressureBar: 92, moons: 0,
    blurb: 'Su atmósfera de CO₂, 92 veces más densa que la nuestra, lo convierte en el planeta más caliente. Gira al revés y muy despacio.',
  },
  earth: {
    type: 'Planeta rocoso', massKg: 5.97e24, meanTempC: 15, pressureBar: 1, moons: 1,
    blurb: 'El único mundo conocido con océanos de agua líquida en la superficie, y con vida.',
    site: { name: 'el Himalaya', lat: 27.99, lon: 86.93 },
  },
  moon: {
    type: 'Luna', massKg: fromGM(4902.8), meanTempC: -20, pressureBar: 0, orbitDays: 27.3217,
    blurb: 'Siempre muestra la misma cara a la Tierra. Sus mares oscuros son lava solidificada hace más de 3.000 millones de años.',
    site: { name: 'el cráter Tycho', lat: -43.31, lon: -11.36 },
  },
  mars: {
    type: 'Planeta rocoso', massKg: 0.642e24, meanTempC: -65, pressureBar: 0.01, moons: 2,
    blurb: 'Un desierto helado de óxido de hierro con el volcán más alto y el cañón más grande del sistema solar.',
    site: { name: 'Valles Marineris', lat: -10.5, lon: -72 },
  },
  jupiter: {
    type: 'Gigante gaseoso', massKg: 1898e24, meanTempC: -110, pressureBar: null, moons: 95,
    blurb: 'Tiene más del doble de masa que todos los demás planetas juntos. La Gran Mancha Roja es una tormenta más grande que la Tierra.',
  },
  io: {
    type: 'Luna', massKg: fromGM(5959.91547),
    blurb: 'El mundo con más volcanes activos que se conoce: las mareas de Júpiter lo calientan por dentro.',
    site: { name: 'Loki Patera', lat: 13, lon: 51.2 },
  },
  europa: {
    type: 'Luna', massKg: fromGM(3202.7121),
    blurb: 'Bajo su corteza de hielo hay un océano global de agua salada: uno de los mejores sitios para buscar vida.',
    site: { name: 'Conamara Chaos', lat: 9.7, lon: 86.3 },
  },
  ganymede: {
    type: 'Luna', massKg: fromGM(9887.83275),
    blurb: 'La luna más grande del sistema solar, mayor que Mercurio, y la única con campo magnético propio.',
    site: { name: 'Galileo Regio', lat: 47.5, lon: -145.7 },
  },
  callisto: {
    type: 'Luna', massKg: fromGM(7179.2834),
    blurb: 'Una de las superficies más antiguas del sistema solar, saturada de cráteres.',
    site: { name: 'Valhalla', lat: 14.7, lon: -56 },
  },
  saturn: {
    type: 'Gigante gaseoso', massKg: 568e24, meanTempC: -140, pressureBar: null, moons: 274,
    blurb: 'Sus anillos de hielo y roca miden unos 270.000 km de lado a lado, pero en su mayor parte no llegan al kilómetro de grosor.',
  },
  titan: {
    type: 'Luna', massKg: fromGM(8978.1371), meanTempC: 93.7 - 273.15, pressureBar: 1.47,
    blurb: 'La única luna con una atmósfera densa y con lagos en la superficie, de metano y etano líquidos.',
    site: { name: 'el lugar de descenso de la Huygens', lat: -10.25, lon: 167.68 },
  },
  uranus: {
    type: 'Gigante de hielo', massKg: 86.8e24, meanTempC: -195, pressureBar: null, moons: 28,
    blurb: 'Gira tumbado, con el eje inclinado 98°: cada polo pasa 42 años seguidos de día y otros 42 de noche.',
  },
  neptune: {
    type: 'Gigante de hielo', massKg: 102e24, meanTempC: -200, pressureBar: null, moons: 16,
    blurb: 'El planeta más lejano, con los vientos más rápidos medidos en el sistema solar: más de 2.000 km/h.',
  },
  triton: {
    type: 'Luna', massKg: fromGM(1428.49546), meanTempC: 38 - 273.15,
    blurb: 'Da vueltas a Neptuno al revés de como gira el planeta: seguramente es un objeto del cinturón de Kuiper capturado. Tiene géiseres de nitrógeno.',
  },
  pluto: {
    type: 'Planeta enano', massKg: 0.013e24, meanTempC: -225, pressureBar: 0.00001, moons: 5,
    blurb: 'Un mundo helado del cinturón de Kuiper. Su llanura de hielo de nitrógeno, Sputnik Planitia, forma medio corazón.',
    site: { name: 'Sputnik Planitia', lat: 20, lon: 180 },
  },
  charon: {
    type: 'Luna', massKg: fromGM(106.1),
    blurb: 'Tan grande respecto a Plutón que los dos giran alrededor de un punto que queda fuera de Plutón.',
  },
};
