/**
 * Fondo de estrellas reales (Yale Bright Star Catalog). Ver docs/ARQUITECTURA.md §8 y docs/ASSETS.md.
 *
 * Las estrellas están "en el infinito": el objeto queda fijo en el origen de la escena,
 * que siempre es la cámara, así que solo les afecta la rotación.
 */
import { float, mix, uniform, vec4 } from 'three/tsl';
import { aboveHorizon, horizon } from '../core/Horizon';
import { eclToScene, equatorialToEcliptic, raDecToVector } from '../astro/frames';
import { pixelAngle, softDisc } from '../particles/nodes';
import { ParticleField, vec4Buffer } from '../particles/ParticleField';

/** Radio de la esfera celeste en escena (dentro del plano lejano). */
const SKY_RADIUS = 1e9;

export const starLook = {
  brightness: uniform(1),
};

/** Índice de color B-V → RGB aproximado (0–1). */
export function bvToRgb(bv: number): [number, number, number] {
  const t = Math.max(-0.4, Math.min(2, bv));
  const r = t < 0.4 ? 0.61 + 0.39 * ((t + 0.4) / 0.8) : 1;
  const g = t < 0.4 ? 0.7 + 0.3 * ((t + 0.4) / 0.8) : 1 - 0.45 * ((t - 0.4) / 1.6);
  const b = t < 0.4 ? 1 : 1 - 0.75 * ((t - 0.4) / 1.6);
  return [r, g, b];
}

export async function createStarfield(url = `${import.meta.env.BASE_URL}data/stars.bin`): Promise<ParticleField> {
  const raw = new Float32Array(await (await fetch(url)).arrayBuffer());
  const count = raw.length / 4;
  const position = new Float32Array(count * 4);
  const color = new Float32Array(count * 4);

  for (let i = 0; i < count; i++) {
    const [ra, dec, vmag, bv] = raw.subarray(i * 4, i * 4 + 4);
    const dir = eclToScene(equatorialToEcliptic(raDecToVector(ra, dec)));
    // Magnitud → tamaño en píxeles y brillo (flujo ∝ 10^(−0,4·m), comprimido).
    const t = Math.min(1, Math.max(0, (6.5 - vmag) / 8));
    const sizePx = 1.6 + 5 * t * t;
    const intensity = Math.min(3.5, Math.max(0.05, 0.3 * Math.pow(10, -0.4 * (vmag - 1.5))));
    const [r, g, b] = bvToRgb(bv);
    position.set([dir.x * SKY_RADIUS, dir.y * SKY_RADIUS, dir.z * SKY_RADIUS, sizePx], i * 4);
    color.set([r * intensity, g * intensity, b * intensity, 0], i * 4);
  }

  const posAttr = vec4Buffer(position).toAttribute();
  const colorAttr = vec4Buffer(color).toAttribute();

  const field = new ParticleField(count, 'additive');
  const material = field.material;
  // Tamaño constante en pantalla: con sizeAttenuation = false la escala se multiplica por la profundidad.
  material.sizeAttenuation = false;
  material.positionNode = posAttr.xyz;
  material.scaleNode = posAttr.w.mul(pixelAngle);
  // A ras de suelo, sin estrellas bajo el horizonte (se verían entre las partículas del terreno).
  const visible = mix(float(1), aboveHorizon(posAttr.xyz.normalize()), horizon.amount.greaterThan(0).select(1, 0));
  material.colorNode = vec4(colorAttr.xyz.mul(starLook.brightness).mul(visible), 1);
  material.opacityNode = softDisc();

  field.object.renderOrder = -1;
  return field;
}
