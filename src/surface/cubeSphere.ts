/**
 * Mapeo cubo → esfera que conserva el área. Ver docs/ARQUITECTURA.md §7.1.
 */

/** Las 6 caras del cubo: +X, −X, +Y, −Y, +Z, −Z. */
export type CubeFace = 0 | 1 | 2 | 3 | 4 | 5;

/**
 * Punto (u, v) ∈ [−1, 1]² de una cara → punto de la esfera unidad.
 * Fórmula de Nowell (cube-to-sphere con distribución casi uniforme).
 */
export function cubeToSphere(face: CubeFace, u: number, v: number): [number, number, number] {
  let x: number, y: number, z: number;
  switch (face) {
    case 0: [x, y, z] = [1, v, -u]; break;
    case 1: [x, y, z] = [-1, v, u]; break;
    case 2: [x, y, z] = [u, 1, -v]; break;
    case 3: [x, y, z] = [u, -1, v]; break;
    case 4: [x, y, z] = [u, v, 1]; break;
    case 5: [x, y, z] = [-u, v, -1]; break;
  }
  const x2 = x * x, y2 = y * y, z2 = z * z;
  return [
    x * Math.sqrt(1 - y2 / 2 - z2 / 2 + (y2 * z2) / 3),
    y * Math.sqrt(1 - z2 / 2 - x2 / 2 + (z2 * x2) / 3),
    z * Math.sqrt(1 - x2 / 2 - y2 / 2 + (x2 * y2) / 3),
  ];
}
