/**
 * Post-procesado: bloom (el toque artístico) y efecto warp en los viajes. Ver
 * docs/ARQUITECTURA.md §10.
 *
 * - El umbral del bloom está por encima del albedo iluminado (≤ 1): solo hacen bloom el Sol
 *   (HDR) y las luces de ciudades, no los planetas iluminados.
 * - Warp: estelas radiales hacia los bordes (las estrellas se estiran), aberración cromática
 *   y viñeta, según `warp` (0–1). Va en una rama con un uniform: en reposo cuesta lo mismo
 *   que sin él (dos lecturas por píxel).
 * - Tramado (*dithering*) al final, ya con el tone mapping y en sRGB: el halo del Sol es un
 *   degradado muy suave sobre negro y, en 8 bits, cada nivel salía como un anillo de varios
 *   píxeles. Medio nivel de ruido por píxel los deshace.
 */
import * as THREE from 'three/webgpu';
import {
  Fn,
  If,
  Loop,
  float,
  interleavedGradientNoise,
  length,
  max,
  mix,
  pass,
  renderOutput,
  screenCoordinate,
  smoothstep,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

export interface BloomControls {
  strength: { value: number };
  threshold: { value: number };
  radius: { value: number };
  /** Resolución del bloom respecto a la pantalla (perfil de calidad). */
  setResolutionScale(scale: number): void;
}

/** Intensidad del warp (0–1) y relación de aspecto de la pantalla. */
export const warpLook = {
  amount: uniform(0),
  aspect: uniform(1),
};

/** Muestras de cada estela. */
const STREAK_TAPS = 10;

export function createPipeline(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera) {
  const scenePass = pass(scene, camera);
  const color = scenePass.getTextureNode('output');
  const bloomPass = bloom(color, 0.75, 0.45, 1.05);
  // Los tipos de @types/three la llaman `getTexture`; en three r186 es `getTextureNode`.
  const glow = (bloomPass as unknown as { getTextureNode(): typeof color }).getTextureNode();

  const { amount, aspect } = warpLook;
  const output = Fn(() => {
    const st = uv();
    const out = color.sample(st).add(glow.sample(st)).toVar();
    If(amount.greaterThan(0.001), () => {
      const d = st.sub(0.5);
      // Distancia al centro corregida por el aspecto: las estelas crecen hacia los bordes.
      const r = length(d.mul(vec2(aspect, 1)));
      const reach = amount.mul(0.16).mul(r.add(0.15));
      const streak = vec3(0).toVar();
      Loop(STREAK_TAPS, ({ i }) => {
        const t = float(i).add(0.5).div(STREAK_TAPS);
        const p = d.mul(float(1).sub(reach.mul(t))).add(0.5);
        // Máximo, no media: cada estrella deja una línea nítida que se apaga hacia la cola.
        const weight = float(1).sub(t.mul(0.75));
        streak.assign(max(streak, color.sample(p).rgb.add(glow.sample(p).rgb).mul(weight)));
      });
      // Aberración cromática: rojo un poco hacia fuera, azul hacia dentro.
      const ca = amount.mul(0.006).mul(r.add(0.2));
      const red = color.sample(d.mul(float(1).add(ca)).add(0.5)).r.add(glow.sample(d.mul(float(1).add(ca)).add(0.5)).r);
      const blue = color.sample(d.mul(float(1).sub(ca)).add(0.5)).b.add(glow.sample(d.mul(float(1).sub(ca)).add(0.5)).b);
      const split = vec3(red, out.g, blue);
      const mixed = mix(split, split.max(streak), smoothstep(0.05, 0.6, r).mul(amount));
      // Viñeta fría hacia los bordes.
      const vignette = float(1).sub(smoothstep(0.35, 0.95, r).mul(amount).mul(0.45));
      const tint = mix(vec3(1), vec3(0.85, 0.93, 1.12), amount.mul(smoothstep(0.2, 0.9, r)));
      out.assign(vec4(mixed.mul(vignette).mul(tint), out.a));
    });
    return out;
  })();

  // Tone mapping y espacio de color a mano, para tramar después (con `outputColorTransform` el
  // pipeline los aplicaría al final, ya sin sitio para el ruido).
  const mapped = renderOutput(output);
  const dither = interleavedGradientNoise(screenCoordinate.xy).sub(0.5).div(255);
  const pipeline = new THREE.RenderPipeline(renderer, vec4(mapped.rgb.add(dither), mapped.a));
  pipeline.outputColorTransform = false;
  const controls: BloomControls = {
    strength: bloomPass.strength,
    threshold: bloomPass.threshold,
    radius: bloomPass.radius,
    setResolutionScale: (scale) => bloomPass.setResolutionScale(scale),
  };
  return { pipeline, bloom: controls };
}
