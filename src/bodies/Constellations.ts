/**
 * Constelaciones en el cielo: figuras, límites y guías (eclíptica y ecuador celeste) como
 * líneas de puntos sobre la esfera celeste, igual que `Starfield`. Ver docs/ARQUITECTURA.md §15.2.
 *
 * Están en el infinito: el objeto queda en el origen de la escena (la cámara) y solo les afecta
 * la rotación. Cada punto lleva el índice de su constelación, así que el resaltado (bajo el
 * ratón o seleccionada) es un uniform: no se tocan los buffers.
 */
import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { abs, float, max, mix, pow, sin, smoothstep, step, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';
import type { SkyData } from '../astro/constellations';
import { eclToScene, equatorialToEcliptic, raDecToVector, type Vec3d } from '../astro/frames';
import { DEG } from '../astro/units';
import { aboveHorizon, horizon } from '../core/Horizon';
import { pixelAngle, softDisc } from '../particles/nodes';
import { ParticleField, vec4Buffer } from '../particles/ParticleField';
import { SKY_RADIUS, starSizePx } from './Starfield';

/**
 * Separación entre puntos de las figuras: 0,1°, pero sin resaltar solo se dibuja uno de cada
 * dos (0,2°: unos 4 px con el campo de visión de 50°). La seleccionada y el zoom, todos.
 */
const FIGURE_SPACING = 0.1 * DEG;
const BORDER_SPACING = 0.32 * DEG;
const GUIDE_SPACING = 0.45 * DEG;

export const constellationLook = {
  /** Como las estrellas: se apagan de día, en la totalidad y lejos del Sol (0–1). */
  brightness: uniform(1),
  /** Brillo de todas las líneas (debug). */
  gain: uniform(1),
  /** Progreso de las figuras (0–1): se trazan desde las estrellas hacia el centro de cada tramo. */
  figures: uniform(0),
  borders: uniform(0),
  ecliptic: uniform(0),
  equator: uniform(0),
  /** Constelación bajo el ratón y seleccionada (índice; −1, ninguna). */
  hover: uniform(-1),
  selected: uniform(-1),
  /** Trazado de la seleccionada (0–1): se vuelve a dibujar desde sus estrellas al elegirla. */
  selectedTrace: uniform(0),
  /** 0–1: con una seleccionada, el resto del cielo se atenúa. */
  dim: uniform(0),
  /** 0–1: con zoom (campo de visión estrecho) se dibujan todos los puntos de las figuras. */
  dense: uniform(0),
  /** Segundos (reducidos en la CPU) para el centelleo de las estrellas resaltadas. */
  time: uniform(0),
};

/** Qué capas pide el usuario. */
export interface SkyOverlay {
  figures: boolean;
  borders: boolean;
  ecliptic: boolean;
  equator: boolean;
}

/** 1 si el índice del punto es `u`, 0 si no (los índices son enteros guardados en float). */
const isIndex = (i: Node<'float'>, u: Node<'float'>) => float(1).sub(smoothstep(0.25, 0.5, abs(i.sub(u))));

/** A ras de suelo, nada bajo el horizonte (se vería entre las partículas del terreno). */
const skyMask = (dir: Node<'vec3'>) => mix(float(1), aboveHorizon(dir.normalize()), horizon.amount.greaterThan(0).select(1, 0));

const angleBetween = (a: Vec3d, b: Vec3d) =>
  Math.atan2(Math.hypot(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x), a.x * b.x + a.y * b.y + a.z * b.z);

/** Interpolación esférica (`w` = ángulo entre `a` y `b`). */
function slerp(a: Vec3d, b: Vec3d, t: number, w: number): Vec3d {
  if (w < 1e-9) return a;
  const s = Math.sin(w), ka = Math.sin((1 - t) * w) / s, kb = Math.sin(t * w) / s;
  return { x: a.x * ka + b.x * kb, y: a.y * ka + b.y * kb, z: a.z * ka + b.z * kb };
}

/** AR y Dec (grados, J2000) → dirección en ejes de escena. */
const skyDir = (ra: number, dec: number) => eclToScene(equatorialToEcliptic(raDecToVector(ra * DEG, dec * DEG)));

function additiveField(position: number[], data: number[]): { field: ParticleField; pos: Node<'vec4'>; data: Node<'vec4'> } {
  const field = new ParticleField(position.length / 4, 'additive');
  field.material.sizeAttenuation = false;
  field.object.renderOrder = -1;
  return { field, pos: vec4Buffer(new Float32Array(position)).toAttribute(), data: vec4Buffer(new Float32Array(data)).toAttribute() };
}

export class ConstellationSky {
  readonly group = new THREE.Group();
  private readonly figures: ParticleField;
  private readonly borders: ParticleField;
  private readonly guides: ParticleField;
  /** Halo de las estrellas de la figura seleccionada. */
  private readonly stars: ParticleField;
  private lastSelected = -1;

  /**
   * @param catalog `stars.bin` (4 floats por estrella): las figuras unen estrellas de Yale por
   *   su índice, así que cada línea acaba en el punto que se dibuja.
   */
  constructor(sky: SkyData, catalog: Float32Array) {
    const look = constellationLook;
    const R = SKY_RADIUS;
    const star = (i: number) => skyDir(catalog[i * 4] / DEG, catalog[i * 4 + 1] / DEG);

    // Figuras: (posición, constelación) y (distancia a la estrella más cercana, su tamaño en px,
    // posición en el tramo: 0 junto a una estrella y 1 en el centro, impar). Sin tramos repetidos.
    const position: number[] = [], data: number[] = [];
    const seen = new Set<string>();
    for (const [c, ...ids] of sky.lines) {
      for (let k = 1; k < ids.length; k++) {
        const a = ids[k - 1], b = ids[k];
        const key = a < b ? `${a}-${b}` : `${b}-${a}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const A = star(a), B = star(b), w = angleBetween(A, B);
        const n = Math.max(2, 2 * Math.round(w / FIGURE_SPACING / 2));
        for (let j = 0; j < n; j++) {
          const t = (j + 0.5) / n;
          const p = slerp(A, B, t, w);
          const nearA = t < 0.5;
          position.push(p.x * R, p.y * R, p.z * R, c);
          data.push((nearA ? t : 1 - t) * w, starSizePx(catalog[(nearA ? a : b) * 4 + 2]), Math.min(t, 1 - t) * 2, j % 2);
        }
      }
    }
    {
      const { field, pos, data: d } = additiveField(position, data);
      const selected = isIndex(pos.w, look.selected);
      const hovered = isIndex(pos.w, look.hover);
      // Hueco junto a cada estrella: su radio en pantalla más 3 px.
      const gap = d.y.mul(0.5).add(3).mul(pixelAngle);
      const clear = smoothstep(gap, gap.add(pixelAngle.mul(1.5)), d.x);
      // Cada punto aparece cuando el progreso pasa su sitio en el tramo; la seleccionada, con el suyo.
      const trace = (progress: Node<'float'>) => smoothstep(d.z, d.z.add(0.12), progress.mul(1.12));
      const appear = mix(trace(look.figures), trace(look.selectedTrace), selected);
      // Los puntos impares, solo en la seleccionada o con zoom: la línea se ve más llena.
      const parity = max(float(1).sub(d.w), max(selected, look.dense));
      const shown = appear.mul(parity).mul(clear).mul(skyMask(pos.xyz)).mul(look.brightness);
      // Sin resaltar, tenues (y más con otra seleccionada); por debajo del umbral del bloom (1,05).
      const level = mix(max(float(0.34).mul(float(1).sub(look.dim.mul(0.65))), hovered.mul(0.62)), float(0.95), selected);
      const color = mix(vec3(0.55, 0.68, 1), vec3(0.8, 0.88, 1), selected);
      const m = field.material;
      m.positionNode = pos.xyz;
      m.scaleNode = mix(float(1.7), float(2.3), max(selected, hovered)).mul(pixelAngle).mul(step(0.002, shown));
      m.colorNode = vec4(color.mul(level).mul(shown).mul(look.gain), 1);
      m.opacityNode = softDisc();
      this.figures = field;
    }

    // Límites: (posición, constelación a un lado) y (la del otro lado).
    position.length = data.length = 0;
    for (const [a, b, ...coords] of sky.borders) {
      for (let k = 2; k < coords.length; k += 2) {
        const A = skyDir(coords[k - 2], coords[k - 1]), B = skyDir(coords[k], coords[k + 1]), w = angleBetween(A, B);
        const n = Math.max(1, Math.round(w / BORDER_SPACING));
        for (let j = 0; j < n; j++) {
          const p = slerp(A, B, j / n, w);
          position.push(p.x * R, p.y * R, p.z * R, a);
          data.push(b, 0, 0, 0);
        }
      }
    }
    {
      const { field, pos, data: d } = additiveField(position, data);
      const selected = max(isIndex(pos.w, look.selected), isIndex(d.x, look.selected));
      const hovered = max(isIndex(pos.w, look.hover), isIndex(d.x, look.hover));
      const focus = max(selected, hovered.mul(0.55));
      const shown = max(look.borders.mul(float(1).sub(look.dim.mul(0.7))), focus).mul(skyMask(pos.xyz)).mul(look.brightness);
      const color = mix(vec3(0.62, 0.5, 0.95).mul(0.17), vec3(0.6, 0.78, 1).mul(0.5), focus);
      const m = field.material;
      m.positionNode = pos.xyz;
      m.scaleNode = mix(float(1.3), float(1.9), focus).mul(pixelAngle).mul(step(0.002, shown));
      m.colorNode = vec4(color.mul(shown).mul(look.gain), 1);
      m.opacityNode = softDisc();
      this.borders = field;
    }

    // Guías: la eclíptica (el camino del Sol por el zodiaco) y el ecuador celeste.
    position.length = data.length = 0;
    for (let l = 0; l < 2 * Math.PI; l += GUIDE_SPACING) {
      const e = eclToScene({ x: Math.cos(l), y: Math.sin(l), z: 0 });
      position.push(e.x * R, e.y * R, e.z * R, 0);
      const q = eclToScene(equatorialToEcliptic({ x: Math.cos(l), y: Math.sin(l), z: 0 }));
      position.push(q.x * R, q.y * R, q.z * R, 1);
      data.push(0, 0, 0, 0, 0, 0, 0, 0);
    }
    {
      const { field, pos } = additiveField(position, data);
      const shown = mix(look.ecliptic, look.equator, pos.w).mul(skyMask(pos.xyz)).mul(look.brightness).mul(float(1).sub(look.dim.mul(0.5)));
      const m = field.material;
      m.positionNode = pos.xyz;
      m.scaleNode = float(1.6).mul(pixelAngle).mul(step(0.002, shown));
      m.colorNode = vec4(mix(vec3(1, 0.78, 0.42), vec3(0.42, 0.78, 1), pos.w).mul(0.3).mul(shown).mul(look.gain), 1);
      m.opacityNode = softDisc();
      this.guides = field;
    }

    // Estrellas de cada figura: un halo (anillo fino y brillo suave) que centellea despacio
    // alrededor de las de la seleccionada. (posición, constelación) y (tamaño en px, fase).
    position.length = data.length = 0;
    for (const c of sky.constellations) {
      for (const [, , mag, , , ra, dec] of c.figure.stars) {
        const p = skyDir(ra, dec);
        position.push(p.x * R, p.y * R, p.z * R, c.index);
        data.push(starSizePx(mag), Math.random(), 0, 0);
      }
    }
    {
      const { field, pos, data: d } = additiveField(position, data);
      const on = isIndex(pos.w, look.selected).mul(smoothstep(0, 0.4, look.selectedTrace)).mul(skyMask(pos.xyz)).mul(look.brightness);
      const r = uv().sub(vec2(0.5)).length().mul(2);
      const ring = smoothstep(0.5, 0.6, r).mul(float(1).sub(smoothstep(0.66, 0.8, r)));
      const glow = pow(max(float(0).sub(r).add(1), 0), 2.5);
      const twinkle = sin(look.time.mul(2.1).add(d.y.mul(6.283))).mul(0.12).add(0.88);
      const m = field.material;
      m.positionNode = pos.xyz;
      // El anillo, a unos 6 px del borde de la estrella.
      m.scaleNode = d.x.mul(1.4).add(14).mul(pixelAngle).mul(step(0.002, on));
      m.colorNode = vec4(vec3(0.8, 0.88, 1).mul(on).mul(twinkle).mul(look.gain), 1);
      m.opacityNode = ring.mul(0.6).add(glow.mul(0.35));
      this.stars = field;
    }

    this.group.add(this.figures.object, this.borders.object, this.guides.object, this.stars.object);
  }

  /** Partículas que se dibujan ahora (para el HUD). */
  get particleCount(): number {
    return [this.figures, this.borders, this.guides, this.stars].reduce((n, f) => n + (f.object.visible ? f.count : 0), 0);
  }

  /**
   * Acerca cada capa a lo pedido: las figuras se trazan en 1,6 s y se recogen en 0,6; el resto
   * se funde. `visible` = false lejos del Sol, donde las estrellas de Yale ya no están.
   * @param zoom 0–1: cuánto se ha estrechado el campo de visión (más puntos en las figuras).
   */
  update(dt: number, on: SkyOverlay, visible: boolean, zoom: number, seconds: number): void {
    const look = constellationLook;
    const approach = (u: { value: number }, target: boolean, inSeconds: number, outSeconds: number) => {
      u.value = target ? Math.min(1, u.value + dt / inSeconds) : Math.max(0, u.value - dt / outSeconds);
    };
    approach(look.figures, on.figures, 1.6, 0.6);
    approach(look.borders, on.borders, 0.8, 0.5);
    approach(look.ecliptic, on.ecliptic, 0.8, 0.5);
    approach(look.equator, on.equator, 0.8, 0.5);
    const selected = look.selected.value;
    // Otra seleccionada: se vuelve a trazar desde sus estrellas.
    if (selected !== this.lastSelected) {
      this.lastSelected = selected;
      look.selectedTrace.value = 0;
    }
    approach(look.selectedTrace, selected >= 0, 1.4, 0.3);
    approach(look.dim, selected >= 0, 0.6, 0.6);
    look.dense.value = zoom;
    look.time.value = seconds % 1000;
    const lit = visible && look.brightness.value > 0.001;
    const focus = selected >= 0 || look.hover.value >= 0;
    this.figures.object.visible = lit && (look.figures.value > 0 || selected >= 0);
    this.borders.object.visible = lit && (look.borders.value > 0 || focus);
    this.guides.object.visible = lit && (look.ecliptic.value > 0 || look.equator.value > 0);
    this.stars.object.visible = lit && selected >= 0;
  }
}
