#!/usr/bin/env node
/**
 * Convierte el Yale Bright Star Catalog (CDS V/50, `catalog` descomprimido) a public/data/stars.bin.
 *
 * Uso: node scripts/build-stars.mjs <ruta/al/catalog>
 *
 * Formato de salida: Float32Array little-endian, 4 floats por estrella:
 *   [RA (rad, J2000), Dec (rad, J2000), Vmag, B-V]
 * Ver docs/ASSETS.md.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const input = process.argv[2];
if (!input) {
  console.error('Uso: node scripts/build-stars.mjs <ruta/al/catalog>');
  process.exit(1);
}

// Columnas (1-based, inclusivas) según el ReadMe de V/50.
const col = (line, from, to) => line.slice(from - 1, to).trim();

const out = [];
for (const line of readFileSync(input, 'latin1').split('\n')) {
  const raH = col(line, 76, 77);
  const vmag = col(line, 103, 107);
  if (!raH || !vmag) continue; // entradas sin posición (novas, objetos retirados)

  const ra = ((+raH + +col(line, 78, 79) / 60 + +col(line, 80, 83) / 3600) / 24) * 2 * Math.PI;
  const decSign = col(line, 84, 84) === '-' ? -1 : 1;
  const dec = decSign * (+col(line, 85, 86) + +col(line, 87, 88) / 60 + +col(line, 89, 90) / 3600) * (Math.PI / 180);
  const bvRaw = col(line, 110, 114);
  const bv = bvRaw ? +bvRaw : 0.6; // sin color medido: amarillento neutro

  out.push(ra, dec, +vmag, bv);
}

const target = fileURLToPath(new URL('../public/data/stars.bin', import.meta.url));
writeFileSync(target, Buffer.from(new Float32Array(out).buffer));
console.log(`${out.length / 4} estrellas → ${target}`);
