/**
 * Creación del WebGPURenderer con respaldo a WebGL2. Ver docs/ARQUITECTURA.md §1 y §4.2.
 */
import * as THREE from 'three/webgpu';
import { config } from '../config';

export interface RendererInfo {
  renderer: THREE.WebGPURenderer;
  /** true si el navegador no tiene WebGPU y se usa WebGL2. */
  isWebGLFallback: boolean;
}

export async function createRenderer(canvas: HTMLCanvasElement): Promise<RendererInfo> {
  const renderer = new THREE.WebGPURenderer({
    canvas,
    antialias: true,
    // Mejor precisión de profundidad para escalas astronómicas (§4.2).
    reversedDepthBuffer: true,
    // Tiempos de GPU medibles desde la consola (renderer.resolveTimestampsAsync) con ?debug.
    trackTimestamp: config.debug,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, config.maxPixelRatio));
  renderer.setSize(Math.max(1, window.innerWidth), Math.max(1, window.innerHeight));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  await renderer.init();

  const backend = renderer.backend as { isWebGPUBackend?: boolean };
  return { renderer, isWebGLFallback: !backend.isWebGPUBackend };
}
