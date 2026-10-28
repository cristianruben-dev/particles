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
import type { DecodedImage, TerrainReply, TerrainRequest } from './terrain.worker';

export interface TerrainSources {
  albedo?: string;
  /**
   * PNG/JPG en gris (8 bits), binario crudo de 16 bits (`.u16`, little-endian) o float16
   * comprimido con zlib (`.f16z`, little-endian).
   */
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
    // Descarga y decodificación en un worker: en el hilo principal bloqueaban 40–80 ms cada una.
    const decoded = await decodeInWorker({ albedo: src.albedo, height: src.height, heightSize: src.heightSize, night: src.night });
    let height: HeightData | null = null;
    if (decoded.height) {
      const { width, height: rows, data, half } = decoded.height;
      // Con los bits float16, la CPU guarda los mismos que sube a la GPU y los decodifica con una
      // tabla: la colisión lee exactamente el suelo que se dibuja, con la mitad de memoria.
      height = half ? { width, height: rows, data, decode: halfDecodeTable(), leftLon } : { width, height: rows, data, leftLon };
    }
    const albedo = decoded.albedo ? colorTexture(decoded.albedo) : null;
    const night = decoded.night ? colorTexture(decoded.night) : null;
    let heightTexture: THREE.DataTexture | null = null;
    if (height) {
      // r32float (o r16float con los bits del `.f16z`, la mitad de memoria) sin filtrar: la
      // B-spline la hace el shader (`sampleTexelsGpu`).
      const type = height.decode ? THREE.HalfFloatType : THREE.FloatType;
      heightTexture = new THREE.DataTexture(height.data, height.width, height.height, THREE.RedFormat, type);
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

/** Un worker por carga (son pocas: al enfocar un cuerpo con superficie); se cierra al acabar. */
function decodeInWorker(request: TerrainRequest): Promise<Extract<TerrainReply, { ok: true }>> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./terrain.worker.ts', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (e: MessageEvent<TerrainReply>) => {
      worker.terminate();
      if (e.data.ok) resolve(e.data);
      else reject(new Error(e.data.error));
    });
    worker.addEventListener('error', (e) => {
      worker.terminate();
      reject(new Error(e.message));
    });
    worker.postMessage(request);
  });
}

/** Bits float16 → valor (los 65.536). */
let halfTable: Float32Array | null = null;
function halfDecodeTable(): Float32Array {
  if (!halfTable) {
    halfTable = new Float32Array(65536);
    for (let i = 0; i < 65536; i++) halfTable[i] = THREE.DataUtils.fromHalfFloat(i);
  }
  return halfTable;
}

/** Textura de color (sRGB) filtrada por hardware: en el color no importa la precisión fina. */
function colorTexture(img: DecodedImage): THREE.DataTexture {
  const tex = new THREE.DataTexture(new Uint8Array(img.data.buffer), img.width, img.height, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}
