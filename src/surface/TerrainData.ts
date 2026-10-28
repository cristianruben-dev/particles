/**
 * Datos de terreno de un cuerpo para la superficie (§7.2): el mapa de alturas en la CPU
 * (colisión) y en la GPU (chunks), y el albedo y las luces como texturas.
 *
 * Se decodifica una sola vez y la misma matriz alimenta a las dos copias del mapa de
 * alturas: si la CPU y la GPU leyeran archivos o decodificaciones distintas, la cámara
 * chocaría con un suelo que no es el que se ve.
 */
import * as THREE from 'three/webgpu';
import type { HeightData } from './terrain';

export interface TerrainSources {
  albedo?: string;
  /** PNG/JPG en gris (8 bits) o binario crudo de 16 bits (`.u16`, little-endian). */
  height?: string;
  /** Tamaño del binario crudo. */
  heightSize?: { width: number; height: number };
  night?: string;
  /** Longitud este del borde izquierdo de los mapas. */
  leftLon?: number;
}

export class TerrainData {
  private constructor(
    /** Longitud este del borde izquierdo de los mapas (grados). */
    readonly leftLon: number,
    readonly height: HeightData | null,
    readonly heightTexture: THREE.DataTexture | null,
    readonly albedo: THREE.DataTexture | null,
    readonly night: THREE.DataTexture | null,
  ) {}

  static async load(src: TerrainSources): Promise<TerrainData> {
    const leftLon = src.leftLon ?? -180;
    const [height, albedo, night] = await Promise.all([
      src.height ? loadHeight(src.height, src.heightSize, leftLon) : null,
      src.albedo ? loadColor(src.albedo) : null,
      src.night ? loadColor(src.night) : null,
    ]);
    let heightTexture: THREE.DataTexture | null = null;
    if (height) {
      // r32float sin filtrar: el filtrado bilineal lo hace el shader (`sampleHeightGpu`).
      heightTexture = new THREE.DataTexture(height.data, height.width, height.height, THREE.RedFormat, THREE.FloatType);
      heightTexture.minFilter = heightTexture.magFilter = THREE.NearestFilter;
      heightTexture.needsUpdate = true;
    }
    return new TerrainData(leftLon, height, heightTexture, albedo, night);
  }

  dispose(): void {
    this.heightTexture?.dispose();
    this.albedo?.dispose();
    this.night?.dispose();
  }
}

/** Píxeles RGBA sin gestión de color (como el worker de horneado: mismos valores). */
async function decode(url: string): Promise<{ width: number; height: number; data: Uint8ClampedArray }> {
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

async function loadHeight(url: string, size: TerrainSources['heightSize'], leftLon: number): Promise<HeightData> {
  if (url.endsWith('.u16')) {
    if (!size) throw new Error(`Falta el tamaño de ${url}`);
    const buffer = await (await fetch(url)).arrayBuffer();
    const raw = new Uint16Array(buffer);
    const data = new Float32Array(raw.length);
    for (let i = 0; i < raw.length; i++) data[i] = raw[i] / 65535;
    return { width: size.width, height: size.height, data, leftLon };
  }
  const img = await decode(url);
  const data = new Float32Array(img.width * img.height);
  for (let i = 0; i < data.length; i++) data[i] = img.data[i * 4] / 255;
  return { width: img.width, height: img.height, data, leftLon };
}

/** Textura de color (sRGB) filtrada por hardware: en el color no importa la precisión fina. */
async function loadColor(url: string): Promise<THREE.DataTexture> {
  const img = await decode(url);
  const tex = new THREE.DataTexture(new Uint8Array(img.data.buffer), img.width, img.height, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}
