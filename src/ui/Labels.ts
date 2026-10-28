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
  /** Fuera del sistema solar no se ve ningún cuerpo: sin nombres, aunque estén activados (§14.4). */
  suppressed = false;

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
    // Prioridad: Sol, planetas y después lunas, la ISS y los cometas.
    const rank = (b: CelestialBody) => (b.parent === null ? 0 : b.data.comet ? 3 : b.parent.parent === null ? 1 : 2);
    this.ordered = [...bodies].sort((a, b) => rank(a) - rank(b));
  }

  update(camera: THREE.PerspectiveCamera, width: number, height: number, focus: CelestialBody): void {
    // A ras de suelo, nada de nombres bajo el horizonte (se verían sobre el terreno).
    const sky = focus.sky;
    // Discos en pantalla de los cuerpos grandes: tapan las etiquetas de lo que hay detrás.
    const discs: { x: number; y: number; r: number; distance: number }[] = [];
    for (const body of this.ordered) {
      if (body.screenRadiusPx < 3 || behind(body.object3d.position, camera, this.v)) continue;
      this.v.copy(body.object3d.position).project(camera);
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
      let show = this.visible && !this.suppressed && body !== focus && body.object3d.visible && body.screenRadiusPx < MAX_RADIUS_PX;
      let x = 0, y = 0;
      if (show) {
        // La cámara está en el origen: la posición del objeto ya es relativa a ella.
        show = !behind(body.object3d.position, camera, this.v);
        this.v.copy(body.object3d.position).project(camera);
        show &&= Math.abs(this.v.x) < 1.05 && Math.abs(this.v.y) < 1.05;
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

/**
 * ¿Queda detrás de la cámara? Con la profundidad invertida, la z proyectada no lo dice (lo de
 * detrás salía reflejado): se mira en el espacio de la cámara. `tmp` se reutiliza.
 */
function behind(position: THREE.Vector3, camera: THREE.Camera, tmp: THREE.Vector3): boolean {
  return tmp.copy(position).transformDirection(camera.matrixWorldInverse).z >= 0;
}

/** Un nombre de la capa cósmica (§14): en una dirección desde la cámara, sin cuerpo detrás. */
export interface Marker {
  text: string;
  color: string;
  /** Dirección desde la cámara (unitaria, ejes de escena). */
  dir: { x: number; y: number; z: number };
  show: boolean;
  /** Clave estable (para reutilizar el elemento) y, si se puede pulsar, qué hace. */
  key: string;
  onClick?: () => void;
}

/**
 * Nombres de la capa cósmica: dónde está el Sol, el centro galáctico, las galaxias (que se
 * pulsan para viajar). Van por orden de importancia: los que caen encima de otro se ocultan.
 */
export class MarkerLabels {
  private readonly layer: HTMLElement;
  private readonly elements = new Map<string, { el: HTMLElement; click: { fn?: () => void } }>();
  private readonly v = new THREE.Vector3();

  constructor(root: HTMLElement) {
    this.layer = document.createElement('div');
    this.layer.className = 'labels';
    root.append(this.layer);
  }

  update(camera: THREE.PerspectiveCamera, width: number, height: number, markers: readonly Marker[]): void {
    const placed: { x: number; y: number }[] = [];
    const seen = new Set<string>();
    for (const m of markers) {
      seen.add(m.key);
      let entry = this.elements.get(m.key);
      if (!entry) {
        const el = document.createElement(m.onClick ? 'button' : 'span');
        el.className = m.onClick ? 'label marker clickable' : 'label marker';
        const click: { fn?: () => void } = {};
        el.addEventListener('click', () => click.fn?.());
        this.layer.append(el);
        entry = { el, click };
        this.elements.set(m.key, entry);
      }
      const el = entry.el;
      entry.click.fn = m.onClick;
      if (el.textContent !== m.text) el.textContent = m.text;
      el.style.setProperty('--dot', m.color);
      let show = m.show;
      if (show) {
        show = !behind(this.v.set(m.dir.x, m.dir.y, m.dir.z), camera, this.v);
        // La cámara está en el origen: basta un punto en esa dirección.
        this.v.set(m.dir.x, m.dir.y, m.dir.z).multiplyScalar(1e6).project(camera);
        show &&= Math.abs(this.v.x) < 1.05 && Math.abs(this.v.y) < 1.05;
        const x = (this.v.x * 0.5 + 0.5) * width, y = (-this.v.y * 0.5 + 0.5) * height;
        if (show && placed.some((p) => Math.abs(p.x - x) < MIN_GAP_PX * 3 && Math.abs(p.y - y) < MIN_GAP_PX)) show = false;
        if (show) {
          placed.push({ x, y });
          el.style.transform = `translate(${(x + 6).toFixed(1)}px, ${(y - 7).toFixed(1)}px)`;
        }
      }
      el.hidden = !show;
    }
    for (const [key, { el }] of this.elements) if (!seen.has(key)) el.hidden = true;
  }
}
