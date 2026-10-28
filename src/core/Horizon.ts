/**
 * Horizonte a ras de suelo: fondo con cielo arriba y suelo abajo, y estrellas solo por
 * encima del horizonte. Ver docs/ARQUITECTURA.md §7.4.
 *
 * Entre las partículas del terreno hay aire (es el estilo del proyecto): sin esto, por los
 * huecos se ve el cielo azul (el suelo parece lavado) o las estrellas (en la Luna).
 */
import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { mix, positionWorldDirection, smoothstep, uniform } from 'three/tsl';

export const horizon = {
  /** Vertical del lugar en mundo (del centro del cuerpo a la cámara). */
  up: uniform(new THREE.Vector3(0, 1, 0)),
  /** Coseno del ángulo que baja el horizonte bajo la horizontal (negativo). */
  dip: uniform(-1),
  sky: uniform(new THREE.Vector3()),
  ground: uniform(new THREE.Vector3()),
  /** 0 = espacio (sin horizonte), 1 = a ras de suelo. */
  amount: uniform(0),
};

/** 0 bajo el horizonte, 1 por encima (con un borde suave). */
export const aboveHorizon = (dir: Node<'vec3'>) => {
  const h = dir.dot(horizon.up);
  return smoothstep(horizon.dip.sub(0.01), horizon.dip.add(0.03), h);
};

/** Fondo de la escena: negro en el espacio; cielo y suelo cerca de un cuerpo. */
export function horizonBackground() {
  const dir = positionWorldDirection;
  const color = mix(horizon.ground, horizon.sky, aboveHorizon(dir));
  return color.mul(horizon.amount);
}
