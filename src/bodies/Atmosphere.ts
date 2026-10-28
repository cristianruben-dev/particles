/**
 * Atmósfera: cáscara fina de partículas aditivas. El brillo del limbo sale solo:
 * en el borde la línea de visión atraviesa muchas más partículas. Ver docs/ARQUITECTURA.md §8.
 */
import * as THREE from 'three/webgpu';
import { abs, float, mix, pow, smoothstep, step, uniform, vec3, vec4 } from 'three/tsl';
import { ParticleField } from '../particles/ParticleField';
import { fibonacciPoint } from '../particles/progressive';
import { particleScale, softDisc, viewDirection, worldNormal, type FloatNode, type Vec3Node } from '../particles/nodes';
import type { DetailTier } from './DetailTier';
import type { AtmospherePreset } from './presets';

export const atmosphereLook = {
  /** Brillo base de cada partícula del anillo. */
  haze: uniform(0.012),
  /** Brillo extra en el limbo. */
  limb: uniform(0.09),
};

/** Color sRGB → lineal, como vec3 TSL. */
export function linearColor(hex: number): Vec3Node {
  const c = new THREE.Color(hex);
  return vec3(c.r, c.g, c.b);
}

export class Atmosphere {
  readonly field: ParticleField;

  constructor(
    tier: DetailTier,
    preset: AtmospherePreset,
    count: number,
    sunDirection: Vec3Node,
    objectScale: FloatNode,
    /** Escala vertical (1 − achatamiento) para los gigantes gaseosos. */
    flatten = 1,
  ) {
    this.field = new ParticleField(count, 'additive', 3);
    const dirAttr = tier.buffer(shellPoints(count)).toAttribute();
    const dir = dirAttr.xyz;

    // Densidad que cae con la altura: más partículas abajo.
    const h = dirAttr.w.pow(2);
    const center = dir.mul(float(1).add(h.mul(preset.thickness))).mul(vec3(1, flatten, 1));

    const n = worldNormal(dir);
    const ndl = n.dot(sunDirection);
    const facing = abs(n.dot(viewDirection(center)));

    const material = this.field.material;
    material.positionNode = center;
    // Solo el anillo cercano al limbo: las partículas de cara a la cámara apenas aportan
    // brillo y son la mayor parte del coste de relleno.
    material.scaleNode = particleScale({
      center,
      size: this.field.size,
      minPixels: 1.5,
      objectScale,
    }).mul(step(facing, 0.6));
    const day = smoothstep(-0.3, 0.2, ndl);
    // Color de día; en el terminador, el del crepúsculo.
    const tint = mix(linearColor(preset.twilightColor), linearColor(preset.dayColor), smoothstep(-0.05, 0.35, ndl));
    const intensity = atmosphereLook.haze
      .add(pow(float(1).sub(facing), 3).mul(atmosphereLook.limb))
      .mul(day)
      .mul(float(1).sub(h))
      .mul(preset.strength)
      .mul(tier.appear);

    material.colorNode = vec4(tint.mul(intensity), 1);
    material.opacityNode = softDisc();
  }
}

/** Puntos de Fibonacci con aleatorio en w (sin texturas: no hace falta el worker). */
function shellPoints(count: number): Float32Array {
  const out = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    fibonacciPoint(i, count, out, i * 4);
    out[i * 4 + 3] = Math.random();
  }
  // Orden aleatorio: cualquier prefijo es uniforme (la atmósfera es difusa, no hace falta estratificar).
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    for (let c = 0; c < 4; c++) {
      const t = out[i * 4 + c]; out[i * 4 + c] = out[j * 4 + c]; out[j * 4 + c] = t;
    }
  }
  return out;
}
