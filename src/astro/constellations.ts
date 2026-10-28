/**
 * Las 88 constelaciones de la IAU. Ver docs/ARQUITECTURA.md §15.
 *
 * Los datos (figuras, límites, áreas, la tabla de Roman y las estrellas con nombre) salen de
 * `scripts/build-constellations.mjs` → `public/data/constellations.json`. Aquí va lo escrito a
 * mano: el nombre en español, qué representa y de dónde viene cada una.
 */
import { B1875_CENTURIES, applyMatrix, precessionMatrix, vectorToRaDec, type Vec3d } from './frames';
import { DEG } from './units';

/** Una constelación tal como sale del script. Ángulos en grados, J2000. */
interface ConstellationRecord {
  /** Abreviatura de la IAU (Ori, UMa…). */
  id: string;
  latin: string;
  genitive: string;
  /** 1–3: 1 = las grandes o brillantes (sus nombres se ponen antes). */
  rank: number;
  /** Dónde va el nombre: uno por constelación, dos en la Serpiente (cabeza y cola). */
  labels: [number, number][];
  /** Centro para mirarla [AR, Dec] y tamaño aproximado. */
  view: [number, number, number];
  /** Grados cuadrados, del límite oficial. */
  area: number;
  /** Puesto por área (1 = Hidra, 88 = Cruz del Sur). */
  areaRank: number;
  /** Declinación mínima y máxima del límite. */
  dec: [number, number];
  brightest: { name: string; desig: string; mag: number; star: number };
  /** Estrellas de Yale con V ≤ 6 dentro del límite. */
  nakedEye: number;
  /** La figura: centro y radio (para encuadrarla) y su dibujo (§15.3). */
  figure: {
    center: [number, number];
    radius: number;
    /** [x, y (−1…1, norte arriba y este a la izquierda), magnitud, nombre propio, letra de Bayer, AR, Dec]. */
    stars: [number, number, number, string, string, number, number][];
    /** Pares de estrellas (índices en `stars`). */
    segments: [number, number][];
  };
}

export interface Constellation extends ConstellationRecord {
  index: number;
  /** Nombre en español. */
  name: string;
  /** Qué representa. */
  meaning: string;
  /** Quién la definió. */
  origin: string;
  zodiac: boolean;
  /** Tramo de la eclíptica J2000 que la cruza [λ inicial, λ final] (grados), o null. */
  ecliptic: [number, number] | null;
}

export interface SkyData {
  constellations: Constellation[];
  /** [constelación, estrella, estrella, …]: índices en `stars.bin`. */
  lines: number[][];
  /** [constelación a un lado, al otro, AR, Dec, AR, Dec, …]. */
  borders: number[][];
  /** [AR mínima (h), AR máxima (h), Dec mínima (°), constelación], B1875 (Roman 1987). */
  roman: [number, number, number, number][];
  /** [nombre, AR, Dec, magnitud]: las 100 estrellas más brillantes con nombre propio. */
  stars: [string, number, number, number][];
}

const PTOLEMY = 'Una de las 48 de Ptolomeo (siglo II)';
const ARGO = 'Parte del Argo de Ptolomeo, dividido por Lacaille en 1756';
const DUTCH = 'Keyser y De Houtman, navegantes holandeses (1597)';
const HEVELIUS = 'Hevelius (1687)';
const LACAILLE = 'Lacaille (1756), desde el cabo de Buena Esperanza';

/** [nombre, qué representa, origen] por abreviatura. */
const META: Record<string, [string, string, string]> = {
  And: ['Andrómeda', 'La princesa encadenada a una roca como ofrenda a un monstruo marino, hija de Cefeo y Casiopea.', PTOLEMY],
  Ant: ['Máquina Neumática', 'La bomba de vacío de los experimentos de Boyle y Papin.', LACAILLE],
  Aps: ['Ave del Paraíso', 'El ave del paraíso de Nueva Guinea.', DUTCH],
  Aqr: ['Acuario', 'El aguador que vierte agua de un cántaro.', PTOLEMY],
  Aql: ['Águila', 'El águila de Zeus, la que llevaba sus rayos.', PTOLEMY],
  Ara: ['Altar', 'El altar donde los dioses juraron alianza antes de luchar contra los titanes.', PTOLEMY],
  Ari: ['Aries', 'El carnero del vellocino de oro.', PTOLEMY],
  Aur: ['Auriga', 'El cochero, con una cabra y sus cabritos en brazos.', PTOLEMY],
  Boo: ['Boyero', 'El pastor de bueyes que persigue a la Osa Mayor alrededor del polo.', PTOLEMY],
  Cae: ['Cincel', 'El cincel del grabador.', LACAILLE],
  Cam: ['Jirafa', 'La jirafa.', 'Plancius (1613)'],
  Cnc: ['Cáncer', 'El cangrejo que Hera envió contra Hércules.', PTOLEMY],
  CVn: ['Perros de Caza', 'Los dos lebreles del Boyero.', HEVELIUS],
  CMa: ['Can Mayor', 'El perro grande de Orión, con Sirio, la estrella más brillante del cielo.', PTOLEMY],
  CMi: ['Can Menor', 'El perro pequeño de Orión.', PTOLEMY],
  Cap: ['Capricornio', 'La cabra con cola de pez.', PTOLEMY],
  Car: ['Quilla', 'La quilla del Argo, el barco de Jasón.', ARGO],
  Cas: ['Casiopea', 'La reina vanidosa, madre de Andrómeda, en su trono.', PTOLEMY],
  Cen: ['Centauro', 'Un centauro, mitad hombre y mitad caballo; para muchos, el sabio Quirón. Alfa Centauri, el sistema estelar más cercano, está en su pata.', PTOLEMY],
  Cep: ['Cefeo', 'El rey de Etiopía, padre de Andrómeda.', PTOLEMY],
  Cet: ['Ballena', 'El monstruo marino que iba a devorar a Andrómeda.', PTOLEMY],
  Cha: ['Camaleón', 'El camaleón.', DUTCH],
  Cir: ['Compás', 'El compás de dibujo.', LACAILLE],
  Col: ['Paloma', 'La paloma que Noé soltó desde el arca.', 'Plancius (1592)'],
  Com: ['Cabellera de Berenice', 'La melena que la reina Berenice ofreció a los dioses por la vuelta de su esposo.', 'Tycho Brahe (1602), aunque ya se conocía en la Antigüedad'],
  CrA: ['Corona Austral', 'Una corona de laurel.', PTOLEMY],
  CrB: ['Corona Boreal', 'La corona de Ariadna.', PTOLEMY],
  Crv: ['Cuervo', 'El cuervo de Apolo, castigado junto a la Copa.', PTOLEMY],
  Crt: ['Copa', 'La copa de Apolo.', PTOLEMY],
  Cru: ['Cruz del Sur', 'La cruz: la más pequeña de las 88 y la guía hacia el polo sur celeste.', 'Plancius (1598), separada del Centauro'],
  Cyg: ['Cisne', 'El cisne en que se convirtió Zeus; sus estrellas forman la Cruz del Norte.', PTOLEMY],
  Del: ['Delfín', 'El delfín que convenció a Anfítrite para casarse con Poseidón.', PTOLEMY],
  Dor: ['Dorado', 'El pez dorado; en ella está casi toda la Gran Nube de Magallanes.', DUTCH],
  Dra: ['Dragón', 'Ladón, el dragón que guardaba las manzanas de oro de las Hespérides.', PTOLEMY],
  Equ: ['Caballito', 'Un potro: la cabeza de un caballo junto a Pegaso.', PTOLEMY],
  Eri: ['Erídano', 'El río Erídano, en el que cayó Faetón.', PTOLEMY],
  For: ['Horno', 'El horno químico.', LACAILLE],
  Gem: ['Géminis', 'Los gemelos Cástor y Pólux.', PTOLEMY],
  Gru: ['Grulla', 'La grulla.', DUTCH],
  Her: ['Hércules', 'El héroe Heracles, arrodillado.', PTOLEMY],
  Hor: ['Reloj', 'El reloj de péndulo.', LACAILLE],
  Hya: ['Hidra', 'La serpiente de agua de muchas cabezas que mató Hércules: la mayor de las 88.', PTOLEMY],
  Hyi: ['Hidra Macho', 'La serpiente de agua menor.', DUTCH],
  Ind: ['Indio', 'Un indígena americano con sus lanzas.', DUTCH],
  Lac: ['Lagarto', 'El lagarto.', HEVELIUS],
  Leo: ['Leo', 'El león de Nemea, al que mató Hércules.', PTOLEMY],
  LMi: ['León Menor', 'El león pequeño.', HEVELIUS],
  Lep: ['Liebre', 'La liebre que caza Orión.', PTOLEMY],
  Lib: ['Libra', 'La balanza; antes eran las pinzas del Escorpión.', PTOLEMY],
  Lup: ['Lobo', 'Un lobo, la presa que lleva el Centauro.', PTOLEMY],
  Lyn: ['Lince', 'El lince: hace falta vista de lince para verla.', HEVELIUS],
  Lyr: ['Lira', 'La lira de Orfeo.', PTOLEMY],
  Men: ['Mesa', 'La Montaña de la Mesa, sobre Ciudad del Cabo, donde observaba Lacaille.', LACAILLE],
  Mic: ['Microscopio', 'El microscopio.', LACAILLE],
  Mon: ['Unicornio', 'El unicornio.', 'Plancius (1613)'],
  Mus: ['Mosca', 'La mosca.', DUTCH],
  Nor: ['Escuadra', 'La escuadra del delineante.', LACAILLE],
  Oct: ['Octante', 'El octante de los navegantes; en ella está el polo sur celeste.', LACAILLE],
  Oph: ['Ofiuco', 'El serpentario: Asclepio, el dios de la medicina, sujetando la Serpiente. La eclíptica la cruza, aunque no es del zodiaco.', PTOLEMY],
  Ori: ['Orión', 'El cazador gigante, con su cinturón de tres estrellas.', PTOLEMY],
  Pav: ['Pavo', 'El pavo real.', DUTCH],
  Peg: ['Pegaso', 'El caballo alado nacido de la sangre de Medusa.', PTOLEMY],
  Per: ['Perseo', 'El héroe que mató a Medusa y salvó a Andrómeda.', PTOLEMY],
  Phe: ['Fénix', 'El ave que renace de sus cenizas.', DUTCH],
  Pic: ['Pintor', 'El caballete del pintor.', LACAILLE],
  Psc: ['Piscis', 'Dos peces atados por la cola: Afrodita y Eros huyendo de Tifón.', PTOLEMY],
  PsA: ['Pez Austral', 'El pez que bebe el agua que vierte Acuario.', PTOLEMY],
  Pup: ['Popa', 'La popa del Argo.', ARGO],
  Pyx: ['Brújula', 'La brújula de los marinos.', LACAILLE],
  Ret: ['Retículo', 'La retícula del ocular de un telescopio.', 'Lacaille (1756), a partir del Rombo de Habrecht'],
  Sge: ['Flecha', 'La flecha; en algunos mitos, la de Hércules o la de Apolo.', PTOLEMY],
  Sgr: ['Sagitario', 'El arquero centauro; hacia él está el centro de la Vía Láctea.', PTOLEMY],
  Sco: ['Escorpio', 'El escorpión que mató a Orión: por eso nunca están juntos en el cielo.', PTOLEMY],
  Scl: ['Escultor', 'El taller del escultor.', LACAILLE],
  Sct: ['Escudo', 'El escudo de Juan III Sobieski, rey de Polonia.', HEVELIUS],
  Ser: ['Serpiente', 'La serpiente que sujeta Ofiuco: la única constelación partida en dos, cabeza y cola.', PTOLEMY],
  Sex: ['Sextante', 'El sextante con el que Hevelius medía las estrellas.', HEVELIUS],
  Tau: ['Tauro', 'El toro en que se transformó Zeus para raptar a Europa; en él están las Pléyades y las Híades.', PTOLEMY],
  Tel: ['Telescopio', 'El telescopio.', LACAILLE],
  Tri: ['Triángulo', 'El triángulo, como la letra delta o el delta del Nilo.', PTOLEMY],
  TrA: ['Triángulo Austral', 'El triángulo del sur.', DUTCH],
  Tuc: ['Tucán', 'El tucán; en ella está la Pequeña Nube de Magallanes.', DUTCH],
  UMa: ['Osa Mayor', 'La ninfa Calisto convertida en osa; sus siete estrellas más brillantes forman el Carro.', PTOLEMY],
  UMi: ['Osa Menor', 'Arcas, el hijo de Calisto; en la punta de su cola está la Estrella Polar.', PTOLEMY],
  Vel: ['Vela', 'Las velas del Argo.', ARGO],
  Vir: ['Virgo', 'La doncella con la espiga: Astrea, la diosa de la justicia, o Deméter.', PTOLEMY],
  Vol: ['Pez Volador', 'El pez volador.', DUTCH],
  Vul: ['Zorrita', 'Una zorra pequeña con un ganso en la boca.', HEVELIUS],
};

const ZODIAC = new Set(['Ari', 'Tau', 'Gem', 'Cnc', 'Leo', 'Vir', 'Lib', 'Sco', 'Sgr', 'Cap', 'Aqr', 'Psc']);

let loading: Promise<SkyData> | null = null;

/** Carga los datos una vez (se comparte la promesa). */
export function loadConstellations(url = `${import.meta.env.BASE_URL}data/constellations.json`): Promise<SkyData> {
  loading ??= fetch(url)
    .then((r) => {
      if (!r.ok) throw new Error(`constellations.json: ${r.status}`);
      return r.json();
    })
    .then((raw: { constellations: ConstellationRecord[]; ecliptic: [number, number, number][] } & Omit<SkyData, 'constellations'>) => ({
      constellations: raw.constellations.map((c, index) => {
        const [name, meaning, origin] = META[c.id];
        const stretch = raw.ecliptic.find(([i]) => i === index);
        return { ...c, index, name, meaning, origin, zodiac: ZODIAC.has(c.id), ecliptic: stretch ? [stretch[1], stretch[2]] : null };
      }),
      lines: raw.lines,
      borders: raw.borders,
      roman: raw.roman,
      stars: raw.stars,
    }));
  return loading;
}

/** J2000 → B1875, la época en la que se trazaron los límites (Delporte 1930). */
const TO_B1875 = precessionMatrix(B1875_CENTURIES);

/**
 * Índice de la constelación que hay en una dirección ecuatorial J2000 (unitaria). Tabla de
 * Roman (1987): la primera fila con Dec ≥ Dec mínima y AR mínima ≤ AR < AR máxima, en B1875.
 */
export function constellationAt(sky: SkyData, equatorial: Vec3d): number {
  const [ra, dec] = vectorToRaDec(applyMatrix(TO_B1875, equatorial));
  const h = ra / DEG / 15, d = dec / DEG;
  for (const [lo, hi, dlo, index] of sky.roman) if (d >= dlo && h >= lo && h < hi) return index;
  return -1;
}

const SUPERSCRIPT: Record<string, string> = { '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };

/**
 * Nombre de una estrella de la figura: el propio si es brillante (o no tiene letra), si no la
 * letra de Bayer (χ¹ en vez de χ1). Vacío si no tiene ninguno.
 */
export function figureStarLabel([, , mag, name, letter]: Constellation['figure']['stars'][number]): string {
  if (name && (mag < 2.6 || !letter)) return name;
  return letter.replace(/[1-9]/g, (d) => SUPERSCRIPT[d]);
}

const MS_PER_DAY = 86_400_000;
const J2000_MS = Date.UTC(2000, 0, 1, 12);

/**
 * Longitud eclíptica del Sol (grados, J2000) vista desde la Tierra: Meeus, cap. 25 (precisión
 * baja, ~0,01°) menos la precesión desde J2000. Basta para las fechas de la ficha.
 */
export function sunLongitudeJ2000(ms: number): number {
  const t = (ms - J2000_MS) / MS_PER_DAY / 36525;
  const m = (357.52911 + 35999.05029 * t) * DEG;
  const c = (1.914602 - 0.004817 * t) * Math.sin(m) + 0.019993 * Math.sin(2 * m) + 0.000289 * Math.sin(3 * m);
  const l = 280.46646 + 36000.76983 * t + c - 1.3969713 * t;
  return ((l % 360) + 360) % 360;
}

/**
 * El paso del Sol por un tramo [a, b] de la eclíptica (λ en grados) que empieza en el año
 * `year`: del primer día dentro al último (puede acabar el año siguiente).
 */
export function sunPassage(year: number, [a, b]: [number, number]): { from: Date; to: Date } {
  const inside = (day: number) => {
    const l = sunLongitudeJ2000(Date.UTC(year, 0, 1) + day * MS_PER_DAY);
    // El tramo de Piscis empieza en λ < 0.
    return (l >= a && l < b) || (l - 360 >= a && l - 360 < b);
  };
  // El Sol entra una vez al año en cada constelación de la eclíptica.
  let from = 0;
  while (from < 366 && !(inside(from) && !inside(from - 1))) from++;
  let to = from;
  while (to < from + 60 && inside(to + 1)) to++;
  const date = (day: number) => new Date(Date.UTC(year, 0, 1) + day * MS_PER_DAY);
  return { from: date(from), to: date(to) };
}

/**
 * Mes en que la constelación culmina a medianoche: cuando el Sol está justo enfrente
 * (su ascensión recta, a 12 h de la de la constelación). Devuelve el mes (0–11).
 */
export function bestMonth(c: Constellation): number {
  const target = (c.view[0] + 180) % 360;
  const eps = 23.4392911 * DEG;
  let best = 0, bestDiff = Infinity;
  // Cualquier año sirve: el Sol pasa por el mismo sitio en las mismas fechas.
  for (let d = 0; d < 365; d += 2) {
    const l = (sunLongitudeJ2000(Date.UTC(2026, 0, 1) + d * MS_PER_DAY) * DEG);
    const ra = (Math.atan2(Math.cos(eps) * Math.sin(l), Math.cos(l)) / DEG + 360) % 360;
    const diff = Math.abs(((ra - target + 540) % 360) - 180);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = d;
    }
  }
  return new Date(Date.UTC(2026, 0, 1) + best * MS_PER_DAY).getUTCMonth();
}
