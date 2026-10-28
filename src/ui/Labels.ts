/**
 * Etiquetas con el nombre de los cuerpos que se ven pequeños. Ver docs/ARQUITECTURA.md §11.
 * Imprescindibles en escala real, donde casi todo mide menos de un píxel.
 */
import * as THREE from 'three/webgpu';
import type { CelestialBody } from '../bodies/CelestialBody';

/** Por encima de este radio en pantalla el cuerpo ya se reconoce sin nombre. */
const MAX_RADIUS_PX = 30;
/** Separación mínima entre etiquetas (px): las menos importantes se ocultan. */
const MIN_GAP_PX = 22;

export class Labels {
  private readonly elements = new Map<CelestialBody, HTMLButtonElement>();
  private readonly ordered: CelestialBody[];
  private readonly v = new THREE.Vector3();
  visible = true;

  constructor(root: HTMLElement, bodies: readonly CelestialBody[], onSelect: (body: CelestialBody) => void) {
    const layer = document.createElement('div');
    layer.className = 'labels';
    root.append(layer);
    for (const body of bodies) {
      const el = document.createElement('button');
      el.className = 'label';
      el.textContent = body.data.name;
      el.style.setProperty('--dot', `#${new THREE.Color(body.data.color).getHexString()}`);
      el.addEventListener('click', () => onSelect(body));
      layer.append(el);
      this.elements.set(body, el);
    }
    // Prioridad: Sol, planetas y después lunas.
    const rank = (b: CelestialBody) => (b.parent === null ? 0 : b.parent.parent === null ? 1 : 2);
    this.ordered = [...bodies].sort((a, b) => rank(a) - rank(b));
  }

  update(camera: THREE.PerspectiveCamera, width: number, height: number, focus: CelestialBody): void {
    // A ras de suelo, nada de nombres bajo el horizonte (se verían sobre el terreno).
    const sky = focus.sky;
    // Discos en pantalla de los cuerpos grandes: tapan las etiquetas de lo que hay detrás.
    const discs: { x: number; y: number; r: number; distance: number }[] = [];
    for (const body of this.ordered) {
      if (body.screenRadiusPx < 3) continue;
      this.v.copy(body.object3d.position).project(camera);
      if (this.v.z >= 1) continue;
      discs.push({
        x: (this.v.x * 0.5 + 0.5) * width,
        y: (-this.v.y * 0.5 + 0.5) * height,
        r: body.screenRadiusPx,
        distance: body.object3d.position.length(),
      });
    }

    const placed: { x: number; y: number }[] = [];
    for (const body of this.ordered) {
      const el = this.elements.get(body)!;
      let show = this.visible && body !== focus && body.screenRadiusPx < MAX_RADIUS_PX;
      let x = 0, y = 0;
      if (show) {
        // La cámara está en el origen: la posición del objeto ya es relativa a ella.
        this.v.copy(body.object3d.position).project(camera);
        show = this.v.z < 1 && Math.abs(this.v.x) < 1.05 && Math.abs(this.v.y) < 1.05;
        x = (this.v.x * 0.5 + 0.5) * width;
        y = (-this.v.y * 0.5 + 0.5) * height;
        if (show && placed.some((p) => Math.abs(p.x - x) < MIN_GAP_PX * 3 && Math.abs(p.y - y) < MIN_GAP_PX)) show = false;
        const distance = body.object3d.position.length();
        if (show && discs.some((d) => d.distance < distance && Math.hypot(d.x - x, d.y - y) < d.r)) show = false;
        if (show && sky.amount > 0.001 && body.object3d.position.dot(sky.up) / distance < sky.dip) show = false;
      }
      if (show) {
        placed.push({ x, y });
        el.style.transform = `translate(${(x + Math.max(6, body.screenRadiusPx + 4)).toFixed(1)}px, ${(y - 7).toFixed(1)}px)`;
      }
      el.hidden = !show;
    }
  }
}
