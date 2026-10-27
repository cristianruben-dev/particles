/**
 * Horneado de partículas en un Web Worker. Ver docs/ARQUITECTURA.md §6.2.
 *
 * Coloca `count` puntos sobre la esfera unidad y muestrea texturas equirectangulares
 * en cada uno. Todo es estático: el resultado se sube una vez a buffers de GPU.
 */
import type { BakeRequest, BakeResult, BakeTexture } from './bake';
import { fibonacciPoint, jitterOnSphere, stratifiedOrder } from './progressive';

interface Image {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

const imageCache = new Map<string, Promise<Image>>();

/** sRGB (0–255) → lineal (0–1). */
const SRGB_TO_LINEAR = new Float32Array(256).map((_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
});

function loadImage(url: string): Promise<Image> {
  let cached = imageCache.get(url);
  if (!cached) {
    cached = (async () => {
      const blob = await (await fetch(url)).blob();
      // Sin gestión de color: los heightmaps deben llegar con sus valores crudos.
      const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(bitmap, 0, 0);
      const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
      return { width: bitmap.width, height: bitmap.height, data };
    })();
    imageCache.set(url, cached);
  }
  return cached;
}

/** PRNG determinista (mulberry32). */
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

/**
 * Convención de longitud: lon = atan2(−z, x), así el este queda en −z y el giro
 * positivo alrededor de +y (Three.js) es hacia el este. lon 0 en +x.
 */
function directionToUV(x: number, y: number, z: number): [number, number] {
  const lon = Math.atan2(-z, x);
  const lat = Math.asin(Math.max(-1, Math.min(1, y)));
  return [0.5 + lon / (2 * Math.PI), 0.5 - lat / Math.PI];
}

/** Muestreo bilineal (u con wrap, v con clamp). Escribe `channels` valores en `out[offset…]`. */
function sample(img: Image, u: number, v: number, tex: BakeTexture, out: Float32Array, offset: number): void {
  const fx = u * img.width - 0.5;
  const fy = Math.min(Math.max(v * img.height - 0.5, 0), img.height - 1);
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  const xa = ((x0 % img.width) + img.width) % img.width;
  const xb = (xa + 1) % img.width;
  const ya = y0, yb = Math.min(y0 + 1, img.height - 1);
  const ia = (ya * img.width + xa) * 4, ib = (ya * img.width + xb) * 4;
  const ic = (yb * img.width + xa) * 4, id = (yb * img.width + xb) * 4;
  const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;

  for (let c = 0; c < tex.channels; c++) {
    const d = img.data;
    if (tex.srgb) {
      out[offset + c] =
        SRGB_TO_LINEAR[d[ia + c]] * w00 + SRGB_TO_LINEAR[d[ib + c]] * w10 +
        SRGB_TO_LINEAR[d[ic + c]] * w01 + SRGB_TO_LINEAR[d[id + c]] * w11;
    } else {
      out[offset + c] = (d[ia + c] * w00 + d[ib + c] * w10 + d[ic + c] * w01 + d[id + c] * w11) / 255;
    }
  }
}

async function bake(req: BakeRequest): Promise<BakeResult> {
  const { count } = req;
  const random = rng(req.seed);
  const images = new Map<string, Image>();
  await Promise.all(
    Object.entries(req.textures).map(async ([key, tex]) => images.set(key, await loadImage(tex.url))),
  );

  // Dirección xyz + valor aleatorio estable por partícula en w.
  const directions = new Float32Array(count * 4);
  const dist = req.distribution;

  if (dist.kind === 'progressive') {
    // Fibonacci con jitter de ~0,25 separaciones (no se ve regular y no abre huecos)
    // y orden estratificado: cualquier prefijo cubre la esfera (LOD por número de partículas).
    const lattice = new Float32Array(count * 4);
    const jitter = 0.25 * Math.sqrt((4 * Math.PI) / count);
    for (let i = 0; i < count; i++) {
      fibonacciPoint(i, count, lattice, i * 4);
      jitterOnSphere(lattice, i * 4, jitter, random);
    }
    const order = stratifiedOrder(lattice, count, random);
    for (let k = 0; k < count; k++) {
      const i = order[k] * 4;
      directions.set([lattice[i], lattice[i + 1], lattice[i + 2], random()], k * 4);
    }
  } else {
    // Muestreo por rechazo: más partículas donde la textura de densidad es más brillante.
    const img = images.get(dist.texture)!;
    const tmp = new Float32Array(4);
    const densityTex: BakeTexture = { url: '', channels: 1, srgb: false };
    let i = 0;
    for (let attempts = 0; i < count && attempts < count * 200; attempts++) {
      const y = random() * 2 - 1;
      const phi = random() * Math.PI * 2;
      const r = Math.sqrt(1 - y * y);
      const x = Math.cos(phi) * r, z = Math.sin(phi) * r;
      const [u, v] = directionToUV(x, y, z);
      sample(img, u, v, densityTex, tmp, 0);
      const density = tmp[0] < dist.threshold ? 0 : Math.pow(tmp[0], dist.gamma);
      if (random() < density) directions.set([x, y, z, random()], i++ * 4);
    }
    if (i < count) directions.fill(0, i * 4); // partículas sobrantes en el centro con w = 0
    // El muestreo por rechazo ya sale en orden aleatorio: cualquier prefijo es uniforme.
  }

  const samples: Record<string, Float32Array> = {};
  for (const [key, tex] of Object.entries(req.textures)) {
    const img = images.get(key)!;
    const out = new Float32Array(count * tex.channels);
    for (let i = 0; i < count; i++) {
      const [u, v] = directionToUV(directions[i * 4], directions[i * 4 + 1], directions[i * 4 + 2]);
      sample(img, u, v, tex, out, i * tex.channels);
    }
    samples[key] = out;
  }

  return { id: req.id, directions, samples };
}

self.addEventListener('message', async (event: MessageEvent<BakeRequest>) => {
  const result = await bake(event.data);
  self.postMessage(result, {
    transfer: [result.directions.buffer, ...Object.values(result.samples).map((s) => s.buffer)],
  });
});
