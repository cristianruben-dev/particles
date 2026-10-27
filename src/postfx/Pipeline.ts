/**
 * Post-procesado: bloom (el toque artístico). Ver docs/ARQUITECTURA.md §10.
 *
 * El umbral está por encima del albedo iluminado (≤ 1): solo hacen bloom el Sol (HDR)
 * y las luces de ciudades, no los planetas iluminados.
 */
import * as THREE from 'three/webgpu';
import { pass } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

export interface BloomControls {
  strength: { value: number };
  threshold: { value: number };
  radius: { value: number };
}

export function createPipeline(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera) {
  const scenePass = pass(scene, camera);
  const color = scenePass.getTextureNode('output');
  const bloomPass = bloom(color, 0.75, 0.45, 1.05);

  const pipeline = new THREE.RenderPipeline(renderer, color.add(bloomPass));
  const controls: BloomControls = {
    strength: bloomPass.strength,
    threshold: bloomPass.threshold,
    radius: bloomPass.radius,
  };

  // TODO(fase 4): efecto warp (estiramiento radial + aberración cromática) según la velocidad de la cámara.
  return { pipeline, bloom: controls };
}
