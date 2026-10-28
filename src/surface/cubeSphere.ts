/**
 * Cubo → esfera con caras "equiangulares": la coordenada de cara u ∈ [−1, 1] es el ángulo
 * (en unidades de π/4) y el punto del cubo es N + tan(u·π/4)·A + tan(v·π/4)·B. Distorsión
 * de área menor de 1,5× (la proyección gnómica pura llega a 5×). Ver docs/ARQUITECTURA.md §7.1.
 *
 * Precisión (§7.2): a profundidad 22 un chunk mide unos metros y u no cabe en float32.
 * Los chunks se describen por su centro (en float64 en la CPU) y cada partícula por su
 * desplazamiento respecto a él, calculado sin restar vectores casi iguales.
 */

/** Las 6 caras del cubo: +X, −X, +Y, −Y, +Z, −Z. */
export type CubeFace = 0 | 1 | 2 | 3 | 4 | 5;

type V3 = readonly [number, number, number];

/** Normal N y ejes A (u) y B (v) de cada cara. */
export const CUBE_FACES: readonly { n: V3; a: V3; b: V3 }[] = [
  { n: [1, 0, 0], a: [0, 0, -1], b: [0, 1, 0] },
  { n: [-1, 0, 0], a: [0, 0, 1], b: [0, 1, 0] },
  { n: [0, 1, 0], a: [1, 0, 0], b: [0, 0, -1] },
  { n: [0, -1, 0], a: [1, 0, 0], b: [0, 0, 1] },
  { n: [0, 0, 1], a: [1, 0, 0], b: [0, 1, 0] },
  { n: [0, 0, -1], a: [-1, 0, 0], b: [0, 1, 0] },
];

const QUARTER = Math.PI / 4;

/** Punto (u, v) ∈ [−1, 1]² de una cara → dirección unitaria. */
export function cubeToSphere(face: CubeFace, u: number, v: number): [number, number, number] {
  const { n, a, b } = CUBE_FACES[face];
  const tu = Math.tan(u * QUARTER), tv = Math.tan(v * QUARTER);
  const x = n[0] + tu * a[0] + tv * b[0];
  const y = n[1] + tu * a[1] + tv * b[1];
  const z = n[2] + tu * a[2] + tv * b[2];
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
}

/** Dirección → cara y coordenadas equiangulares (u, v). */
export function faceOfDirection(x: number, y: number, z: number): { face: CubeFace; u: number; v: number } {
  const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
  const face: CubeFace = ax >= ay && ax >= az ? (x > 0 ? 0 : 1) : ay >= az ? (y > 0 ? 2 : 3) : z > 0 ? 4 : 5;
  const { n, a, b } = CUBE_FACES[face];
  const dn = x * n[0] + y * n[1] + z * n[2];
  const qu = (x * a[0] + y * a[1] + z * a[2]) / dn;
  const qv = (x * b[0] + y * b[1] + z * b[2]) / dn;
  return { face, u: Math.atan(qu) / QUARTER, v: Math.atan(qv) / QUARTER };
}

/** Centro y tamaño (en unidades de cara) del nodo (iu, iv) de profundidad `depth`. */
export function nodeCenter(depth: number, iu: number, iv: number): { u: number; v: number; size: number } {
  const size = 2 / 2 ** depth;
  return { u: -1 + (iu + 0.5) * size, v: -1 + (iv + 0.5) * size, size };
}
