#!/usr/bin/env node
/**
 * Constelaciones de la IAU → public/data/constellations.json. Ver docs/ARQUITECTURA.md §15.
 *
 * Uso: node scripts/build-constellations.mjs <d3-celestial/data> <constellation_data_roman87.dat>
 *
 * - Figuras y nombres: d3-celestial (Olaf Frohn, BSD-3), `constellations.lines.json` y
 *   `constellations.json`. Cada vértice se ajusta a la estrella de Yale más cercana.
 * - Límites: Delporte (1930) en J2000 (CDS VI/49), `constellations.borders.json` y
 *   `constellations.bounds.json` de d3-celestial, densificados en B1875.
 * - ¿En qué constelación cae una dirección?: Roman (1987, CDS VI/42), copiada de astropy (BSD-3).
 * - Estrellas con nombre: `starnames.json` y `stars.6.json` de d3-celestial, cruzadas con Yale.
 *
 * Necesita public/data/stars.bin (scripts/build-stars.mjs). Ángulos de salida en grados, J2000.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [d3Dir, romanFile] = process.argv.slice(2);
if (!d3Dir || !romanFile) {
  console.error('Uso: node scripts/build-constellations.mjs <d3-celestial/data> <constellation_data_roman87.dat>');
  process.exit(1);
}
const readJson = (name) => JSON.parse(readFileSync(join(d3Dir, name), 'utf8'));
const DEG = Math.PI / 180;
const round = (x, d = 4) => Math.round(x * 10 ** d) / 10 ** d;

// ---------------------------------------------------------------- vectores y precesión

const vec = (raDeg, decDeg) => {
  const cd = Math.cos(decDeg * DEG);
  return [cd * Math.cos(raDeg * DEG), cd * Math.sin(raDeg * DEG), Math.sin(decDeg * DEG)];
};
const toRaDec = (v) => {
  const ra = Math.atan2(v[1], v[0]) / DEG;
  return [ra < 0 ? ra + 360 : ra, Math.asin(Math.max(-1, Math.min(1, v[2]))) / DEG];
};
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const angle = (a, b) => {
  // atan2 de |a × b| y a · b: con acos no hay precisión en ángulos pequeños.
  const c = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  return Math.atan2(Math.hypot(...c), dot(a, b)) / DEG;
};
const slerp = (a, b, t) => {
  const w = angle(a, b) * DEG;
  if (w < 1e-9) return a;
  const s = Math.sin(w), ka = Math.sin((1 - t) * w) / s, kb = Math.sin(t * w) / s;
  return [a[0] * ka + b[0] * kb, a[1] * ka + b[1] * kb, a[2] * ka + b[2] * kb];
};

/**
 * Precesión IAU 1976 (Lieske 1977) desde J2000 hasta `t` siglos julianos: r(t) = P · r(J2000).
 * La misma fórmula que `precessionMatrix` en src/astro/frames.ts.
 */
function precessionMatrix(t) {
  const as = DEG / 3600;
  const zeta = (2306.2181 * t + 0.30188 * t * t + 0.017998 * t ** 3) * as;
  const z = (2306.2181 * t + 1.09468 * t * t + 0.018203 * t ** 3) * as;
  const theta = (2004.3109 * t - 0.42665 * t * t - 0.041833 * t ** 3) * as;
  const cz = Math.cos(zeta), sz = Math.sin(zeta), cZ = Math.cos(z), sZ = Math.sin(z), ct = Math.cos(theta), st = Math.sin(theta);
  return [
    [cz * ct * cZ - sz * sZ, -sz * ct * cZ - cz * sZ, -st * cZ],
    [cz * ct * sZ + sz * cZ, -sz * ct * sZ + cz * cZ, -st * sZ],
    [cz * st, -sz * st, ct],
  ];
}
/** B1875.0 = JD 2405889,258550475, en siglos julianos desde J2000. */
const P1875 = precessionMatrix((2405889.258550475 - 2451545) / 36525);
const toB1875 = (v) => P1875.map((row) => dot(row, v));
const fromB1875 = (v) => [0, 1, 2].map((i) => P1875[0][i] * v[0] + P1875[1][i] * v[1] + P1875[2][i] * v[2]);

// ---------------------------------------------------------------- tabla de Roman

const roman = readFileSync(romanFile, 'utf8')
  .split('\n')
  .filter((l) => l.trim() && !l.startsWith('#'))
  .map((l) => {
    const [raLo, raHi, decLo, id] = l.trim().split(/\s+/);
    return [+raLo, +raHi, +decLo, id];
  });

/** Constelación (abreviatura) de una dirección J2000. */
function constellationAt(v) {
  const [ra, dec] = toRaDec(toB1875(v));
  const h = ra / 15;
  for (const [lo, hi, dlo, id] of roman) if (dec >= dlo && h >= lo && h < hi) return id;
  return null;
}

// ---------------------------------------------------------------- estrellas de Yale

const starsBin = readFileSync(fileURLToPath(new URL('../public/data/stars.bin', import.meta.url)));
const raw = new Float32Array(starsBin.buffer, starsBin.byteOffset, starsBin.byteLength / 4);
const stars = [];
for (let i = 0; i < raw.length; i += 4) {
  const ra = raw[i] / DEG, dec = raw[i + 1] / DEG;
  stars.push({ ra, dec, mag: raw[i + 2], v: vec(ra, dec) });
}
function nearestStar(v) {
  let best = -2, index = -1;
  for (let i = 0; i < stars.length; i++) {
    const d = dot(stars[i].v, v);
    if (d > best) {
      best = d;
      index = i;
    }
  }
  return { index, distance: angle(stars[index].v, v) };
}
for (const s of stars) s.con = constellationAt(s.v);

// ---------------------------------------------------------------- constelaciones

const names = readJson('constellations.json').features;
const ids = [...new Set(names.map((f) => f.id))].sort();
if (ids.length !== 88) throw new Error(`Se esperaban 88 constelaciones y hay ${ids.length}`);
const index = new Map(ids.map((id, i) => [id, i]));
const lon = (x) => (x < 0 ? x + 360 : x);

// Figuras: cada vértice, a la estrella de Yale más cercana.
let maxSnap = 0, worstSnap = '';
const lines = [];
for (const f of readJson('constellations.lines.json').features) {
  for (const poly of f.geometry.coordinates) {
    const out = [index.get(f.id)];
    for (const [x, dec] of poly) {
      const { index: s, distance } = nearestStar(vec(lon(x), dec));
      if (distance > maxSnap) {
        maxSnap = distance;
        worstSnap = `${f.id} (${lon(x).toFixed(2)}, ${dec.toFixed(2)})`;
      }
      out.push(s);
    }
    lines.push(out);
  }
}

/**
 * Densifica un borde: los límites son paralelos y meridianos de B1875 (curvos en J2000).
 * Entre dos vértices con la misma Dec (o AR) de B1875 se interpola en B1875 y se vuelve.
 */
let curvedEdges = 0, otherEdges = 0;
function densify(points, stepDeg = 1) {
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const span = angle(a, b);
    const n = Math.ceil(span / stepDeg);
    if (n > 1) {
      const [ra0, dec0] = toRaDec(toB1875(a)), [ra1, dec1] = toRaDec(toB1875(b));
      const dRa = ((ra1 - ra0 + 540) % 360) - 180;
      const parallel = Math.abs(dec1 - dec0) < 0.01, meridian = Math.abs(dRa) < 0.01;
      if (parallel) curvedEdges++;
      else if (!meridian) otherEdges++;
      for (let k = 1; k < n; k++) {
        const t = k / n;
        out.push(parallel || meridian ? fromB1875(vec(ra0 + dRa * t, dec0 + (dec1 - dec0) * t)) : slerp(a, b, t));
      }
    }
    out.push(b);
  }
  return out;
}
/**
 * El casquete de la Osa Menor es el paralelo de +88° de B1875 entero, pero los puntos
 * intermedios de VI/49 están interpolados en J2000 y caen hasta 0,45° por debajo: se
 * devuelven al paralelo (no hay ningún otro límite por encima de +87,4°).
 */
const capFix = (v) => {
  const [ra, dec] = toRaDec(toB1875(v));
  return dec > 87.4 ? fromB1875(vec(ra, 88)) : v;
};
const toVecs = (poly) => poly.map(([x, dec]) => capFix(vec(lon(x), dec)));
const packDeg = (v) => toRaDec(v).map((x) => round(x));

// Bordes compartidos (cada uno una vez) con las dos constelaciones que separan.
const borders = [];
for (const f of readJson('constellations.borders.json').features) {
  const [a, b] = f.ids.split(',').map((id) => index.get(id));
  const polys = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const poly of polys) borders.push([a, b, ...densify(toVecs(poly)).flatMap(packDeg)]);
}

// Extensión en declinación de cada una (límite densificado): desde qué latitudes se ve entera.
const decRange = ids.map(() => [90, -90]);
for (const f of readJson('constellations.bounds.json').features) {
  const r = decRange[index.get(f.id)];
  for (const v of densify(toVecs(f.geometry.coordinates[0]), 0.5)) {
    const dec = toRaDec(v)[1];
    r[0] = Math.min(r[0], dec);
    r[1] = Math.max(r[1], dec);
  }
}
// Los casquetes polares contienen el polo, que no es un vértice.
decRange[index.get(constellationAt([0, 0, 1]))][1] = 90;
decRange[index.get(constellationAt([0, 0, -1]))][0] = -90;

/**
 * Áreas exactas con la tabla de Roman: en B1875 los límites son paralelos y meridianos, así
 * que entre dos declinaciones de la tabla cada intervalo de AR es de una sola constelación.
 */
const area = ids.map(() => 0);
{
  const decs = [...new Set([...roman.map((r) => r[2]), 90])].sort((x, y) => x - y);
  for (let k = 0; k < decs.length - 1; k++) {
    const d0 = decs[k], d1 = decs[k + 1], mid = (d0 + d1) / 2;
    const cuts = [...new Set([0, 24, ...roman.filter((r) => r[2] <= mid).flatMap((r) => [r[0], r[1]])])].sort((x, y) => x - y);
    const band = Math.sin(d1 * DEG) - Math.sin(d0 * DEG);
    for (let i = 0; i < cuts.length - 1; i++) {
      const h = (cuts[i] + cuts[i + 1]) / 2;
      const row = roman.find(([lo, hi, dlo]) => mid >= dlo && h >= lo && h < hi);
      area[index.get(row[3])] += (cuts[i + 1] - cuts[i]) * 15 * DEG * band / (DEG * DEG);
    }
  }
}
const byArea = [...ids.keys()].sort((a, b) => area[b] - area[a]);

// ---------------------------------------------------------------- estrellas con nombre

// Nombres en español que d3-celestial no trae (o trae en otra forma).
const SPANISH = {
  Arcturus: 'Arturo', Spica: 'Espiga', Regulus: 'Régulo', Aldebaran: 'Aldebarán', Castor: 'Cástor',
  Pollux: 'Pólux', Procyon: 'Proción', Canopus: 'Canopo', Acrux: 'Ácrux', Mirzam: 'Mirzam',
};
// Nombres de d3-celestial que no son de la IAU (o repiten el de otra estrella).
const SKIP = new Set(['Men', 'Mula', 'Saik', 'Navi']);
const hip6 = new Map(readJson('stars.6.json').features.map((f) => [f.id, f]));
const named = [];
const nameOf = new Map();
/** Letra de Bayer (α, β…) de cada estrella de Yale que la tiene: para las figuras. */
const letterOf = new Map();
for (const [hip, s] of Object.entries(readJson('starnames.json'))) {
  const h = hip6.get(+hip);
  const proper = s.name && !SKIP.has(s.name);
  if (!h || (!proper && !s.bayer)) continue;
  // Entre las de Yale a menos de 0,05°, la de magnitud más parecida (α¹ y α² Cen están a 10″).
  const v = vec(lon(h.geometry.coordinates[0]), h.geometry.coordinates[1]);
  let i = -1;
  for (let k = 0; k < stars.length; k++) {
    if (angle(stars[k].v, v) > 0.05) continue;
    if (i < 0 || Math.abs(stars[k].mag - h.properties.mag) < Math.abs(stars[i].mag - h.properties.mag)) i = k;
  }
  if (i < 0) continue;
  if (s.bayer && !letterOf.has(i)) letterOf.set(i, s.bayer);
  if (!proper || nameOf.has(i)) continue;
  const name = SPANISH[s.name] ?? s.es ?? s.name;
  nameOf.set(i, { name, desig: s.desig && s.c ? `${s.desig} ${s.c}` : '' });
  named.push({ i, name, mag: stars[i].mag });
}
named.sort((a, b) => a.mag - b.mag);
// Un nombre repetido (Markeb, Alnair) se queda en la más brillante.
for (let k = named.length - 1; k >= 0; k--) if (named.findIndex((n) => n.name === named[k].name) < k) named.splice(k, 1);
const starNames = named.slice(0, 100).map(({ i, name }) => [name, round(stars[i].ra), round(stars[i].dec), round(stars[i].mag, 2)]);

// ---------------------------------------------------------------- eclíptica

/** Tramos de la eclíptica J2000 por constelación: [constelación, λ inicial, λ final] (grados). */
const ecliptic = [];
{
  const eps = 23.4392911 * DEG;
  let current = null;
  for (let l = 0; l < 360; l += 0.01) {
    const x = Math.cos(l * DEG), y = Math.sin(l * DEG);
    const id = constellationAt([x, y * Math.cos(eps), y * Math.sin(eps)]);
    if (id !== current?.[0]) {
      if (current) current[2] = round(l, 2);
      current = [id, round(l, 2), 360];
      ecliptic.push(current);
    }
  }
  // El tramo de Piscis que empieza antes de λ = 0 y el que acaba en 360 son el mismo.
  const first = ecliptic[0], last = ecliptic[ecliptic.length - 1];
  if (first[0] === last[0] && ecliptic.length > 1) {
    first[1] = round(last[1] - 360, 2);
    ecliptic.pop();
  }
}

// ---------------------------------------------------------------- figuras para el menú y el encuadre

/**
 * Por constelación: sus estrellas (únicas) y tramos, el centro y el radio de la figura (para
 * encuadrarla) y el dibujo en proyección gnomónica (los tramos, círculos máximos, salen rectos)
 * con el norte arriba y el este a la izquierda, como se ve en el cielo, en [−1, 1].
 */
const figures = ids.map(() => ({ stars: [], segments: [] }));
for (const [c, ...list] of lines) {
  const f = figures[c];
  const local = (s) => {
    let k = f.stars.indexOf(s);
    if (k < 0) k = f.stars.push(s) - 1;
    return k;
  };
  for (let k = 1; k < list.length; k++) {
    const a = local(list[k - 1]), b = local(list[k]);
    if (!f.segments.some(([x, y]) => (x === a && y === b) || (x === b && y === a))) f.segments.push([a, b]);
  }
}
const figureOut = figures.map((f) => {
  const sum = f.stars.reduce((acc, s) => [acc[0] + stars[s].v[0], acc[1] + stars[s].v[1], acc[2] + stars[s].v[2]], [0, 0, 0]);
  const n = Math.hypot(...sum);
  const c = sum.map((x) => x / n);
  const radius = Math.max(...f.stars.map((s) => angle(stars[s].v, c)));
  // Este = polo × centro; norte = centro × este.
  let e = [-c[1], c[0], 0];
  const el = Math.hypot(...e);
  e = el < 1e-6 ? [0, 1, 0] : e.map((x) => x / el);
  const north = [c[1] * e[2] - c[2] * e[1], c[2] * e[0] - c[0] * e[2], c[0] * e[1] - c[1] * e[0]];
  const xy = f.stars.map((s) => {
    const v = stars[s].v, d = dot(v, c);
    return [-dot(v, e) / d, dot(v, north) / d];
  });
  const scale = Math.max(...xy.flat().map(Math.abs)) || 1;
  const [ra, dec] = toRaDec(c);
  return {
    center: [round(ra, 3), round(dec, 3)],
    radius: round(radius, 2),
    /** [x, y, magnitud, nombre propio, letra de Bayer, AR, Dec]. */
    stars: f.stars.map((s, k) => [round(xy[k][0] / scale, 3), round(xy[k][1] / scale, 3), round(stars[s].mag, 2), nameOf.get(s)?.name ?? '', letterOf.get(s) ?? '', round(stars[s].ra), round(stars[s].dec)]),
    segments: f.segments,
  };
});

// ---------------------------------------------------------------- salida

const constellations = ids.map((id, i) => {
  const parts = names.filter((f) => f.id === id);
  const p = parts[0].properties;
  const mine = stars.map((s, k) => ({ s, k })).filter(({ s }) => s.con === id);
  const brightest = mine.reduce((a, b) => (b.s.mag < a.s.mag ? b : a));
  const star = nameOf.get(brightest.k);
  return {
    id,
    latin: p.name,
    genitive: p.gen,
    rank: +p.rank,
    labels: parts.map((f) => [round(lon(f.geometry.coordinates[0]), 2), round(f.geometry.coordinates[1], 2)]),
    view: [round(lon(p.display[0]), 2), round(p.display[1], 2), p.display[2]],
    area: round(area[i], 2),
    areaRank: byArea.indexOf(i) + 1,
    dec: decRange[i].map((x) => round(x, 2)),
    brightest: { name: star?.name ?? '', desig: star?.desig ?? '', mag: round(brightest.s.mag, 2), star: brightest.k },
    nakedEye: mine.filter(({ s }) => s.mag <= 6).length,
    figure: figureOut[i],
  };
});

const out = {
  source: 'Figuras y nombres: d3-celestial (BSD-3, © Olaf Frohn). Límites: Delporte 1930 (CDS VI/49). Tabla: Roman 1987 (CDS VI/42).',
  constellations,
  /** [constelación, estrella de Yale, estrella, …]: índices en stars.bin. */
  lines,
  /** [constelación a un lado, al otro, AR, Dec, AR, Dec, …]. */
  borders,
  /** [AR mínima (h), AR máxima (h), Dec mínima (°), constelación], B1875. */
  roman: roman.map(([lo, hi, d, id]) => [lo, hi, d, index.get(id)]),
  /** [nombre, AR, Dec, magnitud]: las 100 más brillantes con nombre propio. */
  stars: starNames,
  ecliptic: ecliptic.map(([id, a, b]) => [index.get(id), a, b]),
};
const target = fileURLToPath(new URL('../public/data/constellations.json', import.meta.url));
writeFileSync(target, JSON.stringify(out));

// ---------------------------------------------------------------- comprobaciones

const total = area.reduce((a, b) => a + b, 0);
const check = (label, raDeg, decDeg, expected) => {
  const got = constellationAt(vec(raDeg, decDeg));
  console.log(`${got === expected ? 'ok ' : 'MAL'} ${label}: ${got} (esperado ${expected})`);
};
console.log(`${ids.length} constelaciones, ${lines.length} trazos, ${borders.length} bordes, ${starNames.length} estrellas con nombre → ${target}`);
console.log(`Vértice más lejos de su estrella de Yale: ${maxSnap.toFixed(4)}° en ${worstSnap}`);
console.log(`Bordes densificados por paralelos de B1875: ${curvedEdges}; ni paralelo ni meridiano: ${otherEdges}`);
console.log(`Áreas: Hidra ${area[index.get('Hya')].toFixed(2)} (IAU 1302,84), Cruz ${area[index.get('Cru')].toFixed(2)} (68,45), Osa Mayor ${area[index.get('UMa')].toFixed(2)} (1279,66), total ${total.toFixed(2)} (41252,96)`);
check('Betelgeuse', 88.7929, 7.4071, 'Ori');
check('Polar', 37.9546, 89.2641, 'UMi');
check('Sirio', 101.2872, -16.7161, 'CMa');
check('Antares', 247.3519, -26.432, 'Sco');
check('Centro galáctico', 266.405, -28.936, 'Sgr');
check('Gran Nube de Magallanes', 80.894, -69.756, 'Dor');
const outside = constellations.flatMap((c) => c.labels.filter(([ra, dec]) => constellationAt(vec(ra, dec)) !== c.id).map(() => c.id));
console.log(`Nombres fuera de su límite: ${outside.length ? outside.join(', ') : 'ninguno'}`);
console.log('Eclíptica:', ecliptic.map(([id, a, b]) => `${id} ${a}–${b}`).join(', '));
console.log('Estrellas:', starNames.map(([name, , , mag]) => `${name} ${mag}`).join(', '));
