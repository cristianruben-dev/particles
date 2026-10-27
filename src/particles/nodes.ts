/**
 * Piezas TSL compartidas por todos los materiales de partículas. Ver docs/ARQUITECTURA.md §6.1.
 */
import type { Camera, Node } from 'three/webgpu';
import {
  Fn,
  cameraFar,
  cameraNear,
  cameraPosition,
  cameraWorldMatrix,
  exp,
  float,
  max,
  modelViewMatrix,
  modelWorldMatrix,
  positionView,
  smoothstep,
  sqrt,
  step,
  transformDirection,
  uniform,
  uv,
  vec2,
  vec3,
  varying,
  vec4,
  viewZToPerspectiveDepth,
  viewZToReversedPerspectiveDepth,
} from 'three/tsl';

export type FloatNode = Node<'float'>;
export type Vec3Node = Node<'vec3'>;

/** Radianes por píxel a profundidad 1 (2·tan(fov/2) / altoEnPíxeles). Lo actualiza el Engine. */
export const pixelAngle = uniform(0.001);

export function updatePixelAngle(camera: Camera & { fov: number }, viewportHeightPx: number): void {
  pixelAngle.value = (2 * Math.tan((camera.fov * Math.PI) / 360)) / viewportHeightPx;
}

/** Distancia al centro del sprite: 0 en el centro, 1 en el borde inscrito. */
const discDistance = () => uv().sub(vec2(0.5)).length().mul(2);

/** Disco duro (para materiales sólidos con alphaTest). */
export const hardDisc = (): FloatNode => float(1).sub(step(1, discDistance()));

/** Caída gaussiana suave (para capas aditivas o translúcidas). */
export const softDisc = (): FloatNode => {
  const d = discDistance();
  return exp(d.mul(d).mul(-4)).mul(float(1).sub(step(1, d)));
};

/** Normal en mundo de una partícula situada en la dirección `dir` (espacio local). */
export const worldNormal = (dir: Vec3Node): Vec3Node => transformDirection(dir, modelWorldMatrix);

/** Posición en mundo del centro de la partícula. */
export const worldPosition = (local: Vec3Node): Vec3Node => modelWorldMatrix.mul(vec4(local, 1)).xyz;

/** Dirección desde la partícula hacia la cámara (mundo). */
export const viewDirection = (local: Vec3Node): Vec3Node => cameraPosition.sub(worldPosition(local)).normalize();

export interface ScaleOptions {
  /** Posición local del centro de la partícula. */
  center: Vec3Node;
  /** Tamaño deseado en unidades locales (1 = radio del cuerpo). */
  size: FloatNode;
  /** Tamaño mínimo en píxeles: evita que desaparezcan al alejarse. */
  minPixels: number;
  /** Escala de mundo del objeto (radio del cuerpo en escena). */
  objectScale: FloatNode;
}

/**
 * Escala del sprite. `SpriteNodeMaterial` la multiplica por la escala del objeto,
 * así que se expresa en unidades locales.
 */
export function particleScale({ center, size, minPixels, objectScale }: ScaleOptions): FloatNode {
  const depth = modelViewMatrix.mul(vec4(center, 1)).z.negate();
  const minSize = pixelAngle.mul(depth).mul(minPixels).div(objectScale);
  return max(size, minSize);
}

/**
 * 0 si la partícula está en la cara oculta (más allá de `margin`), 1 si no.
 * Multiplicado en la escala, el quad colapsa y no se rasteriza: divide el overdraw.
 */
export function frontFacing(dir: Vec3Node, center: Vec3Node, margin: number): FloatNode {
  return step(-margin, worldNormal(dir).dot(viewDirection(center)));
}

/**
 * Micro-esfera: cada sprite se sombrea como una bola, no como un disco plano.
 * La normal sale de la UV del sprite (siempre de cara a la cámara): xy en pantalla,
 * z hacia la cámara. Ver docs/ARQUITECTURA.md §6.1.
 */
export interface Ball {
  /** Normal de la bola en mundo, por píxel. */
  normal: Vec3Node;
  /** Componente hacia la cámara (1 en el centro, 0 en el borde). */
  facing: FloatNode;
  /** Distancia al centro al cuadrado (0 centro, 1 borde). */
  r2: FloatNode;
}

export function ball(): Ball {
  const p = uv().sub(vec2(0.5)).mul(2);
  const r2 = p.dot(p);
  const facing = sqrt(max(float(1).sub(r2), 0));
  return { normal: transformDirection(vec3(p.x, p.y, facing), cameraWorldMatrix), facing, r2 };
}

/**
 * Cuánto se nota la bola (0–1) según el diámetro del sprite en pantalla: con 2–3 px
 * el sombreado por píxel se convierte en moiré, así que se funde hacia la luz plana.
 * `scale` es la escala del sprite (unidades locales), `center` su posición local.
 */
export function ballVisibility(center: Vec3Node, scale: FloatNode, objectScale: FloatNode): FloatNode {
  const depth = modelViewMatrix.mul(vec4(center, 1)).z.negate();
  const sizePx = scale.mul(objectScale).div(depth.mul(pixelAngle));
  return varying(smoothstep(3, 10, sizePx));
}

/** Escala de un sprite-bola y cuánto se nota la bola (sombreado de esfera solo si es grande). */
export function ballSprite(opts: ScaleOptions & { cull?: FloatNode }): { scale: FloatNode; visibility: FloatNode } {
  const scale = varying(opts.cull ? particleScale(opts).mul(opts.cull) : particleScale(opts));
  return { scale, visibility: ballVisibility(opts.center, scale, opts.objectScale) };
}

/** Profundidad del frente de la bola (con o sin depth buffer invertido). */
const viewZToDepth = Fn(([viewZ]: [FloatNode], builder: { renderer: { reversedDepthBuffer: boolean } }) =>
  builder.renderer.reversedDepthBuffer
    ? viewZToReversedPerspectiveDepth(viewZ, cameraNear, cameraFar)
    : viewZToPerspectiveDepth(viewZ, cameraNear, cameraFar),
);

/**
 * Profundidad por píxel de la superficie de la bola: las bolas vecinas se intersecan
 * en vez de apilarse como discos. `worldRadius` = radio del sprite en mundo.
 */
export function ballDepth(b: Ball, worldRadius: FloatNode): FloatNode {
  return viewZToDepth(positionView.z.add(b.facing.mul(worldRadius))) as FloatNode;
}
