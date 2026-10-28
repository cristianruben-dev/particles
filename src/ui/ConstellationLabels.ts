/**
 * Nombres de las constelaciones y de las estrellas más brillantes. Ver docs/ARQUITECTURA.md §15.3.
 *
 * Aparte de `Labels`: están en el infinito (una dirección, sin cuerpo detrás). Primero las
 * grandes (rango 1), sin solaparse, y nada bajo el horizonte. Los de las constelaciones se pulsan.
 */
import * as THREE from 'three/webgpu';
import { figureStarLabel, type SkyData } from '../astro/constellations';
import { eclToScene, equatorialToEcliptic, raDecToVector, type Vec3d } from '../astro/frames';
import { DEG } from '../astro/units';

/** Las estrellas con nombre que se escriben: hasta esta magnitud. */
const STAR_NAME_MAG = 1.9;

interface SkyLabel {
  el: HTMLElement;
  dir: THREE.Vector3;
  /** Constelación (índice), −1 si es una estrella con nombre y −2 si es de la figura seleccionada. */
  index: number;
  /** Medidas aproximadas (px) para no solaparse. */
  width: number;
  height: number;
  /** Desplazamiento respecto al punto: centrado los de constelación, a la derecha los de estrella. */
  dx: number;
  dy: number;
  transform: string;
}

/** Lo que el motor sabe del cielo en este frame. */
export interface SkyLabelState {
  /** 0–1: lo mismo que las líneas (de día, en la totalidad y lejos del Sol se apagan). */
  fade: number;
  names: boolean;
  stars: boolean;
  hover: number;
  selected: number;
  /** A ras de suelo: vertical del lugar y coseno del horizonte (como `Labels`). */
  sky: { amount: number; up: Vec3d; dip: number };
  /** Cuerpos (posición respecto a la cámara y radio en pantalla): tapan los nombres del cielo. */
  bodies: readonly { object3d: THREE.Object3D; screenRadiusPx: number }[];
}

const toVector = (ra: number, dec: number) => {
  const d = eclToScene(equatorialToEcliptic(raDecToVector(ra * DEG, dec * DEG)));
  return new THREE.Vector3(d.x, d.y, d.z);
};

export class ConstellationLabels {
  private readonly layer: HTMLElement;
  private readonly labels: SkyLabel[] = [];
  private readonly v = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private lastState = '';
  /** Nombres (o letras de Bayer) de las estrellas de la figura seleccionada. */
  private members: SkyLabel[] = [];
  private membersOf = -1;

  constructor(root: HTMLElement, private readonly data: SkyData, onSelect: (index: number) => void, onHover: (index: number) => void) {
    this.layer = document.createElement('div');
    this.layer.className = 'labels sky-labels';
    // Debajo de los nombres de los cuerpos: se añade al principio.
    root.prepend(this.layer);

    // Constelaciones por rango y, dentro de cada uno, de mayor a menor.
    const order = [...data.constellations].sort((a, b) => a.rank - b.rank || a.areaRank - b.areaRank);
    for (const c of order) {
      for (const [ra, dec] of c.labels) {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = `sky-label rank-${c.rank}`;
        el.textContent = c.name;
        el.addEventListener('click', () => onSelect(c.index));
        el.addEventListener('pointerenter', () => onHover(c.index));
        el.addEventListener('pointerleave', () => onHover(-1));
        this.layer.append(el);
        const width = c.name.length * (c.rank === 1 ? 9 : 8) + 16;
        this.labels.push({ el, dir: toVector(ra, dec), index: c.index, width, height: 16, dx: -width / 2, dy: -8, transform: '' });
      }
    }
    for (const [name, ra, dec, mag] of data.stars) {
      if (mag > STAR_NAME_MAG) continue;
      const el = document.createElement('span');
      el.className = 'sky-label star';
      el.textContent = name;
      this.layer.append(el);
      const width = name.length * 6.5 + 8;
      this.labels.push({ el, dir: toVector(ra, dec), index: -1, width, height: 13, dx: 7, dy: -6, transform: '' });
    }
    // Las estrellas primero en la colocación: un nombre de estrella junto a su punto se lee mejor
    // que el de la constelación desplazado, y son pocas.
    this.labels.sort((a, b) => (a.index < 0 ? 0 : 1) - (b.index < 0 ? 0 : 1));
  }

  update(camera: THREE.PerspectiveCamera, width: number, height: number, s: SkyLabelState): void {
    const state = `${s.fade.toFixed(2)}`;
    if (state !== this.lastState) {
      this.lastState = state;
      this.layer.style.opacity = state;
      this.layer.style.visibility = s.fade > 0.01 ? '' : 'hidden';
    }
    if (s.selected !== this.membersOf) this.setMembers(s.selected);
    this.layer.classList.toggle('focus', s.selected >= 0);
    camera.getWorldDirection(this.forward);
    // Discos de los cuerpos en pantalla: todo el cielo queda detrás.
    const discs: { x: number; y: number; r: number }[] = [];
    if (s.fade > 0.01) {
      for (const b of s.bodies) {
        if (!b.object3d.visible || b.screenRadiusPx < 3 || b.object3d.position.dot(this.forward) <= 0) continue;
        this.v.copy(b.object3d.position).project(camera);
        discs.push({ x: (this.v.x * 0.5 + 0.5) * width, y: (-this.v.y * 0.5 + 0.5) * height, r: b.screenRadiusPx + 6 });
      }
    }
    const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
    for (const label of [...this.members, ...this.labels]) {
      const isStar = label.index < 0;
      const member = label.index === -2;
      const focus = member || (!isStar && (label.index === s.hover || label.index === s.selected));
      let show = s.fade > 0.01 && (member || (isStar ? s.stars : s.names || focus));
      // Delante de la cámara (con la profundidad invertida, la z proyectada no lo dice).
      if (show) show = label.dir.dot(this.forward) > 0.05;
      if (show && s.sky.amount > 0.001) show = label.dir.x * s.sky.up.x + label.dir.y * s.sky.up.y + label.dir.z * s.sky.up.z > s.sky.dip + 0.02;
      let x = 0, y = 0;
      if (show) {
        this.v.copy(label.dir).multiplyScalar(1e6).project(camera);
        const px = (this.v.x * 0.5 + 0.5) * width, py = (-this.v.y * 0.5 + 0.5) * height;
        x = px + label.dx;
        y = py + label.dy;
        show = x > -label.width && x < width && y > -label.height && y < height;
        if (show) show = !discs.some((d) => Math.hypot(d.x - px, d.y - py) < d.r);
        // Sin solaparse; la resaltada siempre.
        const box = { x0: x - 4, y0: y - 2, x1: x + label.width + 4, y1: y + label.height + 2 };
        // Sin pisarse (los de la figura van antes que el resto, así que mandan); el nombre de la
        // seleccionada o la de debajo del ratón, siempre.
        const named = focus && !member;
        if (show && !named && placed.some((p) => p.x0 < box.x1 && p.x1 > box.x0 && p.y0 < box.y1 && p.y1 > box.y0)) show = false;
        if (show) placed.push(box);
      }
      if (show) {
        const transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
        if (transform !== label.transform) {
          label.transform = transform;
          label.el.style.transform = transform;
        }
      }
      if (label.el.hidden === show) label.el.hidden = !show;
      if (!isStar) label.el.classList.toggle('on', focus);
    }
  }

  /** Las estrellas de la figura seleccionada, con su nombre o su letra (van antes que el resto). */
  private setMembers(index: number): void {
    for (const m of this.members) m.el.remove();
    this.members = [];
    this.membersOf = index;
    const c = this.data.constellations[index];
    if (!c) return;
    // De la más brillante a la más débil: si no caben, se quedan las importantes.
    for (const star of [...c.figure.stars].sort((a, b) => a[2] - b[2])) {
      const text = figureStarLabel(star);
      if (!text) continue;
      const el = document.createElement('span');
      const letter = !star[3] || text !== star[3];
      el.className = `sky-label member${letter ? ' letter' : ''}`;
      el.textContent = text;
      this.layer.append(el);
      const width = letter ? text.length * 9 + 6 : text.length * 7 + 8;
      this.members.push({ el, dir: toVector(star[5], star[6]), index: -2, width, height: 14, dx: 9, dy: -7, transform: '' });
    }
  }
}
