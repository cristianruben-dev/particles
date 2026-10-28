/**
 * Panel de debug (solo con ?debug). Ver docs/ARQUITECTURA.md §11.
 */
import GUI from 'lil-gui';
import type * as THREE from 'three/webgpu';
import { beltLook } from '../bodies/AsteroidBelt';
import { atmosphereLook } from '../bodies/Atmosphere';
import { cloudLook } from '../bodies/CloudLayer';
import { gasLook } from '../bodies/GasGiant';
import { orbitLook } from '../bodies/OrbitLines';
import { ringLook } from '../bodies/Rings';
import type { CelestialBody } from '../bodies/CelestialBody';
import { RockyPlanet, rockyLook } from '../bodies/RockyPlanet';
import { starLook } from '../bodies/Starfield';
import { sunLook } from '../bodies/Sun';
import { disturbanceLook } from '../particles/Disturbance';
import { particleLook } from '../particles/LodManager';
import type { BloomControls } from '../postfx/Pipeline';
import { compressedParams } from '../scale/ScaleSystem';

export interface DebugTargets {
  renderer: THREE.WebGPURenderer;
  bloom: BloomControls;
  bodies: readonly CelestialBody[];
}

export function createDebugGui({ renderer, bloom, bodies }: DebugTargets): GUI {
  const gui = new GUI({ title: 'Debug' });

  const look = gui.addFolder('Aspecto');
  look.add(renderer, 'toneMappingExposure', 0.2, 3, 0.01).name('exposición');
  look.add(bloom.strength, 'value', 0, 3, 0.01).name('bloom fuerza');
  look.add(bloom.threshold, 'value', 0, 4, 0.01).name('bloom umbral');
  look.add(bloom.radius, 'value', 0, 1, 0.01).name('bloom radio');
  look.add(sunLook.brightness, 'value', 0.5, 12, 0.1).name('sol brillo');
  look.add(sunLook.corona, 'value', 0, 0.3, 0.005).name('corona');
  look.add(sunLook.prominences, 'value', 0, 5, 0.05).name('protuberancias');
  look.add(rockyLook.nightLights, 'value', 0, 8, 0.1).name('luces nocturnas');
  look.add(rockyLook.specular, 'value', 0, 4, 0.05).name('reflejo agua');
  look.add(rockyLook.ambient, 'value', 0, 0.1, 0.001).name('ambiente');
  look.add(cloudLook.opacity, 'value', 0, 1, 0.01).name('nubes opacidad');
  look.add(atmosphereLook.haze, 'value', 0, 0.1, 0.001).name('atmósfera neblina');
  look.add(atmosphereLook.limb, 'value', 0, 0.5, 0.005).name('atmósfera limbo');
  look.add(starLook.brightness, 'value', 0, 4, 0.05).name('estrellas');

  const dots = gui.addFolder('Partículas');
  dots.add(particleLook, 'spacingPx', 1, 8, 0.1).name('separación (px)');
  dots.add(particleLook, 'dotScale', 0.3, 2, 0.01).name('tamaño de punto');
  dots.add(rockyLook.ballShading, 'value', 0, 1, 0.01).name('sombreado de bola');
  dots.add(rockyLook.dotGain, 'value', 0.5, 4, 0.01).name('brillo de punto');
  dots.add(disturbanceLook, 'radiusPx', 10, 250, 1).name('ratón · radio (px)');
  dots.add(disturbanceLook.strength, 'value', 0, 2, 0.01).name('ratón · fuerza');
  dots.add(disturbanceLook.stiffness, 'value', 2, 100, 0.5).name('ratón · rigidez');
  dots.add(disturbanceLook.damping, 'value', 0.5, 20, 0.1).name('ratón · amortiguación');
  dots.add(disturbanceLook.disorder, 'value', 0, 2, 0.01).name('ratón · desorden');

  const system = gui.addFolder('Sistema');
  system.add(gasLook.flow, 'value', 0, 5, 0.05).name('gigantes · flujo');
  system.add(gasLook.ballShading, 'value', 0, 1, 0.01).name('gigantes · bola');
  system.add(gasLook.haze, 'value', 0, 1.5, 0.01).name('gigantes · bruma');
  system.add(ringLook.brightness, 'value', 0, 3, 0.01).name('anillos brillo');
  system.add(beltLook.brightness, 'value', 0, 2, 0.01).name('asteroides brillo');
  system.add(orbitLook.brightness, 'value', 0, 3, 0.01).name('órbitas brillo');

  const relief = gui.addFolder('Relieve');
  for (const body of bodies) {
    if (body instanceof RockyPlanet) relief.add(body.reliefScale, 'value', 0, 0.15, 0.001).name(body.data.name);
  }

  const scale = gui.addFolder('Escala comprimida');
  scale.add(compressedParams, 'radiusC', 0.5, 6, 0.01).name('radio · c');
  scale.add(compressedParams, 'radiusPow', 0.3, 0.7, 0.005).name('radio · potencia');
  scale.add(compressedParams, 'linearZone', 1, 6, 0.1).name('zona lineal (radios)');
  scale.add(compressedParams, 'power', 0.3, 0.8, 0.01).name('potencia entre sistemas');

  return gui;
}
