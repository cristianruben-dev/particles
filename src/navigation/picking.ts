/**
 * Selección por clic contra esferas analíticas (no contra partículas). Ver docs/ARQUITECTURA.md §9.
 */
import * as THREE from 'three/webgpu';
import type { CelestialBody } from '../bodies/CelestialBody';

/** Radio mínimo de "agarre" en píxeles, para poder pinchar cuerpos diminutos. */
const MIN_PICK_PX = 14;

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

export function pickBody(
  ndcX: number,
  ndcY: number,
  camera: THREE.PerspectiveCamera,
  bodies: readonly CelestialBody[],
  viewportHeightPx: number,
): CelestialBody | null {
  raycaster.setFromCamera(ndc.set(ndcX, ndcY), camera);
  const ray = raycaster.ray.direction;
  const pxAngle = (2 * Math.tan((camera.fov * Math.PI) / 360)) / viewportHeightPx;

  let best: CelestialBody | null = null;
  let bestDistance = Infinity;
  for (const body of bodies) {
    // La cámara está en el origen: la posición del objeto ya es relativa a ella.
    const c = body.object3d.position;
    const dist = c.length();
    if (dist <= body.sceneRadius || !body.object3d.visible) continue;
    const angle = ray.angleTo(c);
    const angularRadius = Math.asin(body.sceneRadius / dist);
    if (angle < Math.max(angularRadius, MIN_PICK_PX * pxAngle) && dist < bestDistance) {
      best = body;
      bestDistance = dist;
    }
  }
  return best;
}
