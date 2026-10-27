/**
 * Puntos sobre la esfera con orden progresivo. Ver docs/ARQUITECTURA.md §6.2 y §6.3.
 *
 * 1. Retícula de Fibonacci (la distribución más isótropa: sin filas ni columnas de cerca)
 *    con un poco de jitter para que no se vea regular.
 * 2. Orden estratificado por niveles: primero un punto por celda de una rejilla gruesa
 *    (cubo proyectado), luego uno por celda de la siguiente, el doble de fina… Cualquier
 *    prefijo cubre toda la esfera, así que el LOD consiste en dibujar las N primeras.
 */

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** Punto i-ésimo de una esfera de Fibonacci de `count` puntos (xyz en `out[offset…]`). */
export function fibonacciPoint(i: number, count: number, out: Float32Array, offset: number): void {
  const y = 1 - (2 * (i + 0.5)) / count;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = GOLDEN_ANGLE * i;
  out[offset] = Math.cos(theta) * r;
  out[offset + 1] = y;
  out[offset + 2] = Math.sin(theta) * r;
}

/**
 * Desplaza el punto `out[offset…]` (unitario) en el plano tangente, una distancia
 * aleatoria de hasta `amount` (radianes), y lo devuelve a la esfera.
 */
export function jitterOnSphere(out: Float32Array, offset: number, amount: number, random: () => number): void {
  const x = out[offset], y = out[offset + 1], z = out[offset + 2];
  // Base tangente: un eje cualquiera no paralelo al punto.
  const ax = Math.abs(y) < 0.9 ? 0 : 1, ay = Math.abs(y) < 0.9 ? 1 : 0;
  let tx = ay * z, ty = -ax * z, tz = ax * y - ay * x; // a × p
  const tl = Math.hypot(tx, ty, tz);
  tx /= tl; ty /= tl; tz /= tl;
  const bx = y * tz - z * ty, by = z * tx - x * tz, bz = x * ty - y * tx; // p × t
  const r = amount * Math.sqrt(random());
  const phi = random() * 2 * Math.PI;
  const c = Math.cos(phi) * r, s = Math.sin(phi) * r;
  const nx = x + tx * c + bx * s, ny = y + ty * c + by * s, nz = z + tz * c + bz * s;
  const l = Math.hypot(nx, ny, nz);
  out[offset] = nx / l;
  out[offset + 1] = ny / l;
  out[offset + 2] = nz / l;
}

/** Celda de un cubo proyectado de `res`×`res` por cara que contiene la dirección xyz. */
function cubeCell(x: number, y: number, z: number, res: number): number {
  const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
  let face: number, u: number, v: number;
  if (ax >= ay && ax >= az) { face = x > 0 ? 0 : 1; u = y / ax; v = z / ax; }
  else if (ay >= az) { face = y > 0 ? 2 : 3; u = x / ay; v = z / ay; }
  else { face = z > 0 ? 4 : 5; u = x / az; v = y / az; }
  const iu = Math.min(res - 1, Math.floor(((u + 1) / 2) * res));
  const iv = Math.min(res - 1, Math.floor(((v + 1) / 2) * res));
  return (face * res + iv) * res + iu;
}

/**
 * Orden estratificado de `count` puntos (vec4 en `points`): devuelve la permutación.
 * Nivel a nivel, de la rejilla más gruesa a la más fina, se elige al azar un punto
 * libre por celda vacía; lo que sobra va al final en orden aleatorio.
 */
export function stratifiedOrder(points: Float32Array, count: number, random: () => number): Uint32Array {
  const shuffled = new Uint32Array(count);
  for (let i = 0; i < count; i++) shuffled[i] = i;
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const t = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = t;
  }

  const order = new Uint32Array(count);
  const taken = new Uint8Array(count);
  let n = 0;
  for (let res = 2; 6 * res * res < count / 2; res *= 2) {
    const occupied = new Uint8Array(6 * res * res);
    // Las celdas que ya tienen un punto de niveles anteriores cuentan como ocupadas.
    for (let k = 0; k < n; k++) {
      const p = order[k] * 4;
      occupied[cubeCell(points[p], points[p + 1], points[p + 2], res)] = 1;
    }
    for (let k = 0; k < count; k++) {
      const i = shuffled[k];
      if (taken[i]) continue;
      const c = cubeCell(points[i * 4], points[i * 4 + 1], points[i * 4 + 2], res);
      if (occupied[c]) continue;
      occupied[c] = 1;
      taken[i] = 1;
      order[n++] = i;
    }
  }
  for (let k = 0; k < count; k++) {
    const i = shuffled[k];
    if (!taken[i]) order[n++] = i;
  }
  return order;
}
