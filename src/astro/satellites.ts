/**
 * Posición de las lunas a partir de sus elementos medios (JPL). Ver docs/ARQUITECTURA.md §5.
 *
 * Órbita kepleriana en el plano de Laplace (o el ecuador del planeta) con giro de la
 * línea de ápsides y precesión del nodo. Precisión de pocos grados: de sobra para lo visual.
 */
import type { BodyData, SatelliteElements } from './bodies';
import type { Vec3d } from './frames';
import { solveKepler } from './kepler';
import { bodyFrame, cross3d, planeFrame } from './orientation';
import { DEG, daysSinceJ2000 } from './units';

const DAYS_PER_YEAR = 365.25;

/** Posición relativa al planeta (eclíptica J2000, km). */
export function satellitePosition(s: SatelliteElements, parent: BodyData, timeMs: number): Vec3d {
  const d = daysSinceJ2000(timeMs);
  const ref = s.laplacePole ? planeFrame(s.laplacePole.ra, s.laplacePole.dec) : bodyFrame(parent.pole, timeMs);

  // Nodo: regresión para órbitas directas y avance para las retrógradas (∝ −cos i).
  const nodeRate = s.nodeYears ? (-Math.sign(Math.cos(s.i * DEG)) * 360) / (s.nodeYears * DAYS_PER_YEAR) : 0;
  // Ápsides: la diferencia entre el movimiento medio en longitud y el anomalístico.
  const anomalisticRate = 360 / s.anomalisticDays;
  const periRate = s.meanMotion - anomalisticRate - nodeRate;

  const node = (s.node + nodeRate * d) * DEG;
  const peri = (s.peri + periRate * d) * DEG;
  const M = (((s.M + anomalisticRate * d) % 360) * DEG);
  const E = solveKepler(M, s.e);
  const xp = s.a * (Math.cos(E) - s.e);
  const yp = s.a * Math.sqrt(1 - s.e * s.e) * Math.sin(E);

  // Plano orbital → marco de referencia (x hacia su nodo sobre el ICRF, z hacia su polo).
  const i = s.i * DEG;
  const cw = Math.cos(peri), sw = Math.sin(peri);
  const cO = Math.cos(node), sO = Math.sin(node);
  const ci = Math.cos(i), si = Math.sin(i);
  const x = (cw * cO - sw * sO * ci) * xp + (-sw * cO - cw * sO * ci) * yp;
  const y = (cw * sO + sw * cO * ci) * xp + (-sw * sO + cw * cO * ci) * yp;
  const z = sw * si * xp + cw * si * yp;

  // Marco de referencia → eclíptica J2000.
  const q = ref.node, p = ref.pole, b = cross3d(p, q);
  return {
    x: x * q.x + y * b.x + z * p.x,
    y: x * q.y + y * b.y + z * p.y,
    z: x * q.z + y * b.z + z * p.z,
  };
}
