/**
 * Posiciones orbitales keplerianas. Ver docs/ARQUITECTURA.md §5.
 */
import type { OrbitalElements } from './bodies';
import type { Vec3d } from './frames';
import { AU_KM, DEG, julianCenturiesSinceJ2000 } from './units';

/** Resuelve la ecuación de Kepler M = E − e·sin(E) por Newton-Raphson (radianes). */
export function solveKepler(M: number, e: number, tolerance = 1e-10): number {
  let E = e < 0.8 ? M : Math.PI;
  for (let iter = 0; iter < 30; iter++) {
    const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= dE;
    if (Math.abs(dE) < tolerance) break;
  }
  return E;
}

/**
 * Posición heliocéntrica eclíptica J2000 (km) para una fecha (ms Unix).
 * Algoritmo de JPL "Keplerian Elements for Approximate Positions of the Major Planets".
 */
export function heliocentricPosition(orbit: OrbitalElements, timeMs: number): Vec3d {
  const T = julianCenturiesSinceJ2000(timeMs);
  const at = (o: { value: number; ratePerCentury: number }) => o.value + o.ratePerCentury * T;

  const a = at(orbit.a);
  const e = at(orbit.e);
  const i = at(orbit.i) * DEG;
  const L = at(orbit.L);
  const longPeri = at(orbit.longPeri);
  const longNode = at(orbit.longNode);

  const argPeri = (longPeri - longNode) * DEG;
  const node = longNode * DEG;
  let M = ((L - longPeri) % 360) * DEG;
  if (M > Math.PI) M -= 2 * Math.PI;
  if (M < -Math.PI) M += 2 * Math.PI;

  const E = solveKepler(M, e);

  // Coordenadas en el plano orbital
  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);

  // Rotación al marco eclíptico J2000
  const cw = Math.cos(argPeri), sw = Math.sin(argPeri);
  const cO = Math.cos(node), sO = Math.sin(node);
  const ci = Math.cos(i), si = Math.sin(i);

  const x = (cw * cO - sw * sO * ci) * xp + (-sw * cO - cw * sO * ci) * yp;
  const y = (cw * sO + sw * cO * ci) * xp + (-sw * sO + cw * cO * ci) * yp;
  const z = sw * si * xp + cw * si * yp;

  return { x: x * AU_KM, y: y * AU_KM, z: z * AU_KM };
}
