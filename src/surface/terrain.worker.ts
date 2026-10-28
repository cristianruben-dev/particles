/**
 * Descarga y decodifica los mapas de la superficie fuera del hilo principal. Ver
 * docs/ARQUITECTURA.md §7.2.
 *
 * Decodificar un JPG de 4k con `getImageData` o pasar un binario de 16 bits a float32 bloqueaba
 * la página 40–80 ms cada vez al enfocar un cuerpo (la Tierra, al arrancar). Aquí se hace todo y
 * los píxeles y alturas vuelven en buffers transferidos, sin copia.
 */

export interface TerrainRequest {
  albedo?: string;
  height?: string;
  heightSize?: { width: number; height: number };
  night?: string;
}

/** Píxeles RGBA sin gestión de color (como el worker de horneado: mismos valores). */
export interface DecodedImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** Alturas normalizadas (0–1) o, en los `.f16z`, sus bits float16 (`half`). */
export interface DecodedHeight {
  width: number;
  height: number;
  data: Float32Array | Uint16Array;
  half: boolean;
}

export type TerrainReply =
  | { ok: true; height: DecodedHeight | null; albedo: DecodedImage | null; night: DecodedImage | null }
  | { ok: false; error: string };

async function decodeImage(url: string): Promise<DecodedImage> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  const bitmap = await createImageBitmap(await response.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  bitmap.close();
  return { width: canvas.width, height: canvas.height, data };
}

async function decodeHeight(url: string, size: TerrainRequest['heightSize']): Promise<DecodedHeight> {
  if (url.endsWith('.f16z')) {
    // Los bits tal cual: la CPU los decodifica con una tabla y la GPU los lee como r16float.
    if (!size) throw new Error(`Falta el tamaño de ${url}`);
    const response = await fetch(url);
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}: ${url}`);
    const buffer = await new Response(response.body.pipeThrough(new DecompressionStream('deflate'))).arrayBuffer();
    const data = new Uint16Array(buffer);
    if (data.length !== size.width * size.height) throw new Error(`Tamaño inesperado: ${url}`);
    return { width: size.width, height: size.height, data, half: true };
  }
  if (url.endsWith('.u16')) {
    if (!size) throw new Error(`Falta el tamaño de ${url}`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
    const raw = new Uint16Array(await response.arrayBuffer());
    if (raw.length !== size.width * size.height) throw new Error(`Tamaño inesperado: ${url}`);
    const data = new Float32Array(raw.length);
    for (let i = 0; i < raw.length; i++) data[i] = raw[i] / 65535;
    return { width: size.width, height: size.height, data, half: false };
  }
  const img = await decodeImage(url);
  const data = new Float32Array(img.width * img.height);
  for (let i = 0; i < data.length; i++) data[i] = img.data[i * 4] / 255;
  return { width: img.width, height: img.height, data, half: false };
}

self.addEventListener('message', async (event: MessageEvent<TerrainRequest>) => {
  const req = event.data;
  try {
    const [height, albedo, night] = await Promise.all([
      req.height ? decodeHeight(req.height, req.heightSize) : null,
      req.albedo ? decodeImage(req.albedo) : null,
      req.night ? decodeImage(req.night) : null,
    ]);
    const reply: TerrainReply = { ok: true, height, albedo, night };
    const transfer = [height, albedo, night].flatMap((d) => (d ? [d.data.buffer as ArrayBuffer] : []));
    self.postMessage(reply, { transfer });
  } catch (error) {
    const reply: TerrainReply = { ok: false, error: String(error) };
    self.postMessage(reply);
  }
});
