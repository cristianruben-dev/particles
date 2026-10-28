/**
 * Menú de constelaciones: qué se dibuja (figuras, límites, nombres, guías), las 88 en tarjetas
 * con el dibujo de su figura (buscador y filtros) y la ficha de cada una, con la figura grande
 * y el nombre de sus estrellas. Ver docs/ARQUITECTURA.md §15.3.
 */
import { bestMonth, figureStarLabel, sunPassage, type Constellation, type SkyData } from '../astro/constellations';
import { el, iconButton, setText } from './dom';
import { icons } from './icons';
import type { SettingsToggle } from './SettingsPanel';

export interface ConstellationSource {
  /** Interruptores del cielo (los mismos que se guardan en las preferencias). */
  toggles: SettingsToggle[];
  /** Altura sobre el horizonte (grados) del centro de la constelación a ras de suelo; null en órbita. */
  altitude(index: number): number | null;
  /** El usuario elige una (o ninguna, −1) en el menú. */
  onSelect(index: number): void;
  onLook(index: number): void;
  /** Ratón sobre una tarjeta del menú (−1 al salir): se ilumina en el cielo. */
  onHover(index: number): void;
  onClose(): void;
}

type Filter = 'all' | 'zodiac' | 'north' | 'south' | 'now';

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const num = (x: number, digits = 0) => x.toLocaleString('es', { maximumFractionDigits: digits, minimumFractionDigits: digits });
const shortDate = (d: Date) => d.toLocaleDateString('es', { day: 'numeric', month: 'short', timeZone: 'UTC' }).replace('.', '');
/** Sin tildes ni mayúsculas, para buscar. */
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const latitude = (lat: number) => (Math.abs(lat) < 0.5 ? 'el ecuador' : `${num(Math.abs(lat))}° ${lat > 0 ? 'N' : 'S'}`);
const escape = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);

/** Desde qué latitudes sale entera alguna vez: entre dec máx − 90° y dec mín + 90°. */
function visibleFrom(c: Constellation): string {
  const south = c.dec[1] - 90, north = c.dec[0] + 90;
  if (south <= -89.5 && north >= 89.5) return 'Desde toda la Tierra';
  if (south <= -89.5) return `Al sur de ${latitude(north)}`;
  if (north >= 89.5) return `Al norte de ${latitude(south)}`;
  return `Entre ${latitude(south)} y ${latitude(north)}`;
}

function hemisphere(c: Constellation): string {
  if (c.dec[0] > 0) return 'boreal';
  if (c.dec[1] < 0) return 'austral';
  return 'ecuatorial';
}

/**
 * Dibujo de la figura en SVG (como se ve en el cielo: norte arriba y este a la izquierda),
 * centrado en `w` × `h` con un margen. Las estrellas, mayores cuanto más brillan; con
 * `labels`, sus nombres o letras de Bayer.
 */
function figureSvg(c: Constellation, w: number, h: number, labels: boolean): string {
  // Con nombres, más margen a los lados (donde van) que arriba y abajo.
  const mx = labels ? 40 : 9, my = labels ? 16 : 9;
  const stars = c.figure.stars;
  const sx = Math.max(...stars.map((s) => Math.abs(s[0])), 0.05), sy = Math.max(...stars.map((s) => Math.abs(s[1])), 0.05);
  const k = Math.min((w / 2 - mx) / sx, (h / 2 - my) / sy);
  const unit = Math.min(w, h) / 100;
  const xy = stars.map(([x, y]) => [w / 2 + x * k, h / 2 - y * k]);
  const radius = (mag: number) => Math.max(0.7, Math.min(3.6, 0.8 + (4.8 - mag) * 0.62)) * unit * (labels ? 0.55 : 1);
  const lines = c.figure.segments.map(([a, b]) => `<line x1="${xy[a][0].toFixed(1)}" y1="${xy[a][1].toFixed(1)}" x2="${xy[b][0].toFixed(1)}" y2="${xy[b][1].toFixed(1)}"/>`).join('');
  const dots = stars.map(([, , mag], i) => {
    const [x, y] = xy[i], r = radius(mag);
    const halo = mag < 2.2 ? `<circle class="fig-halo" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(r * 2.6).toFixed(1)}"/>` : '';
    return `${halo}<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(2)}"/>`;
  }).join('');
  // Nombres de la más brillante a la más débil, a la derecha de su estrella o, si no cabe o
  // pisa otro nombre (o una estrella), a la izquierda; si tampoco, sin nombre.
  const boxes: [number, number, number, number][] = xy.map(([x, y], i) => {
    const r = radius(stars[i][2]) + 1;
    return [x - r, y - r, x + r, y + r];
  });
  const free = (b: [number, number, number, number], own: number) =>
    b[0] >= 2 && b[2] <= w - 2 && boxes.every((o, k) => k === own || o[0] >= b[2] || o[2] <= b[0] || o[1] >= b[3] || o[3] <= b[1]);
  const names = labels
    ? [...stars.keys()].sort((a, b) => stars[a][2] - stars[b][2]).map((i) => {
      const s = stars[i], text = figureStarLabel(s);
      if (!text) return '';
      const [x, y] = xy[i];
      const letter = !(s[3] && text === s[3]);
      const tw = letter ? text.length * 6.5 + 2 : text.length * 5.4 + 2, gap = radius(s[2]) + 3;
      // A la derecha, a la izquierda, encima o debajo: el primer sitio libre.
      const places: { box: [number, number, number, number]; tx: number; ty: number; anchor: string }[] = [
        { box: [x + gap, y - 6, x + gap + tw, y + 5], tx: x + gap, ty: y + 3.5, anchor: '' },
        { box: [x - gap - tw, y - 6, x - gap, y + 5], tx: x - gap, ty: y + 3.5, anchor: 'end' },
        { box: [x - tw / 2, y - gap - 11, x + tw / 2, y - gap], tx: x, ty: y - gap - 2, anchor: 'middle' },
        { box: [x - tw / 2, y + gap, x + tw / 2, y + gap + 11], tx: x, ty: y + gap + 9, anchor: 'middle' },
      ];
      const place = places.find((p) => free(p.box, i));
      if (!place) return '';
      boxes.push(place.box);
      return `<text x="${place.tx.toFixed(1)}" y="${place.ty.toFixed(1)}"${place.anchor ? ` text-anchor="${place.anchor}"` : ''}${letter ? ' class="letter"' : ''}>${escape(text)}</text>`;
    }).join('')
    : '';
  return `<svg class="fig" viewBox="0 0 ${w} ${h}" aria-hidden="true"><g class="fig-lines">${lines}</g><g class="fig-stars">${dots}</g><g class="fig-names">${names}</g></svg>`;
}

export class ConstellationPanel {
  readonly el: HTMLElement;
  private readonly kicker: HTMLElement;
  private readonly name: HTMLElement;
  private readonly back: HTMLButtonElement;
  private readonly listView: HTMLElement;
  private readonly detailView: HTMLElement;
  private readonly grid: HTMLElement;
  private readonly search: HTMLInputElement;
  private readonly filters = new Map<Filter, HTMLButtonElement>();
  private readonly chips: { toggle: SettingsToggle; button: HTMLButtonElement }[] = [];
  /** Una tarjeta por constelación (se hacen una vez y se reordenan al filtrar). */
  private readonly cards = new Map<number, { card: HTMLButtonElement; detail: HTMLElement }>();
  private data: SkyData | null = null;
  private filter: Filter = 'all';
  /** Las del menú, en su orden: la ficha pasa a la anterior o a la siguiente. */
  private order: number[] = [];
  private current = -1;
  private year = 0;
  private live: { row: HTMLElement; value: HTMLElement } | null = null;
  private lastLive = 0;

  constructor(private readonly source: ConstellationSource) {
    this.el = el('aside', 'ui-info ui-sky glass');
    this.el.setAttribute('aria-label', 'Constelaciones');
    this.el.hidden = true;

    const head = el('header', 'ui-info-head');
    const titles = el('div');
    this.back = el('button', 'ui-sky-back', `${icons.slower}<span>Todas</span>`);
    this.back.type = 'button';
    this.back.addEventListener('click', () => {
      this.source.onSelect(-1);
      this.showList();
    });
    this.kicker = el('p', 'ui-kicker');
    this.name = el('h2', 'ui-info-name');
    titles.append(this.back, this.kicker, this.name);
    head.append(titles, iconButton('close', 'Cerrar', source.onClose, 'Esc', 'ui-close'));

    // Menú: qué se dibuja (fichas que se encienden), buscador, filtros y las tarjetas.
    this.listView = el('div', 'ui-info-body');
    const chips = el('div', 'ui-sky-chips');
    const short: Record<string, string> = {
      constellations: 'Figuras', boundaries: 'Límites', constellationNames: 'Nombres', starNames: 'Estrellas', ecliptic: 'Eclíptica', equator: 'Ecuador',
    };
    for (const toggle of source.toggles) {
      const button = el('button', 'ui-sky-chip', `<i></i>${short[toggle.id] ?? toggle.label}${toggle.key ? `<kbd>${toggle.key}</kbd>` : ''}`);
      button.type = 'button';
      button.title = toggle.label;
      button.addEventListener('click', () => {
        toggle.set(!toggle.get());
        this.refreshChips();
      });
      chips.append(button);
      this.chips.push({ toggle, button });
    }
    this.search = el('input', 'ui-sky-search');
    this.search.type = 'search';
    this.search.placeholder = 'Buscar: Orión, Cruz, Lyra…';
    this.search.setAttribute('aria-label', 'Buscar una constelación');
    this.search.addEventListener('input', () => this.renderList());
    // Esc dentro del buscador: que cierre el panel (el motor ignora las teclas en los campos).
    this.search.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') source.onClose();
    });

    const seg = el('div', 'ui-segmented ui-sky-filters');
    seg.setAttribute('role', 'radiogroup');
    const labels: [Filter, string][] = [['all', 'Todas'], ['zodiac', 'Zodiaco'], ['north', 'Norte'], ['south', 'Sur'], ['now', 'Ahora']];
    for (const [filter, label] of labels) {
      const b = el('button', '', label);
      b.type = 'button';
      b.setAttribute('role', 'radio');
      if (filter === 'now') b.title = 'Las que están sobre el horizonte (a ras de suelo)';
      b.addEventListener('click', () => {
        this.filter = filter;
        this.renderList();
      });
      seg.append(b);
      this.filters.set(filter, b);
    }
    // Hasta saber si la cámara está a ras de suelo.
    this.filters.get('now')!.hidden = true;
    this.grid = el('div', 'ui-sky-grid');
    const note = el('p', 'ui-info-source',
      'Las 88 constelaciones de la IAU, como se ven en el cielo (norte arriba, este a la izquierda). Figuras de la IAU y Sky & Telescope (vía d3-celestial), límites de Delporte (1930) y estrellas del catálogo de Yale. En el cielo, la que hay bajo el ratón se ilumina y con un clic se encuadra.');
    this.listView.append(chips, this.search, seg, this.grid, note);

    this.detailView = el('div', 'ui-info-body');
    this.el.append(head, this.listView, this.detailView);
    this.showList();
  }

  get open(): boolean {
    return !this.el.hidden;
  }

  /** Constelación de la ficha abierta (−1 en el menú). */
  get shown(): number {
    return this.current;
  }

  setData(data: SkyData): void {
    this.data = data;
    for (const c of data.constellations) {
      const card = el('button', 'ui-sky-card');
      card.type = 'button';
      const detail = el('small');
      card.innerHTML = figureSvg(c, 100, 100, false);
      card.append(el('b', '', c.name), detail);
      card.setAttribute('aria-label', c.name);
      card.addEventListener('click', () => this.select(c.index));
      card.addEventListener('pointerenter', () => this.source.onHover(c.index));
      card.addEventListener('pointerleave', () => this.source.onHover(-1));
      this.cards.set(c.index, { card, detail });
    }
    if (this.open) this.current >= 0 ? this.show(this.current) : this.renderList();
  }

  setOpen(open: boolean): void {
    if (open === this.open) return;
    this.el.hidden = !open;
    if (!open) {
      this.source.onHover(-1);
      if (this.current >= 0) this.source.onSelect(-1);
    }
    if (open) this.showList();
  }

  /** Abre el menú. */
  showList(): void {
    this.current = -1;
    this.back.hidden = true;
    this.listView.hidden = false;
    this.detailView.hidden = true;
    setText(this.kicker, 'El cielo');
    setText(this.name, 'Constelaciones');
    this.refreshChips();
    this.renderList();
  }

  /** Elegida en el menú (o con anterior y siguiente): se encuadra y se abre su ficha. */
  private select(index: number): void {
    this.source.onHover(-1);
    this.source.onSelect(index);
    this.show(index);
  }

  /** Abre la ficha de una constelación. */
  show(index: number, timeMs = Date.now()): void {
    const c = this.data?.constellations[index];
    if (!c) return;
    this.el.hidden = false;
    this.current = index;
    this.back.hidden = false;
    this.listView.hidden = true;
    this.detailView.hidden = false;
    setText(this.kicker, `Constelación ${c.zodiac ? 'del zodiaco' : hemisphere(c)}`);
    setText(this.name, c.name);
    this.year = new Date(timeMs).getUTCFullYear();
    if (!this.order.includes(index)) this.order = [...this.data!.constellations].sort((a, b) => a.name.localeCompare(b.name, 'es')).map((x) => x.index);

    // La figura grande, con anterior y siguiente a los lados.
    const hero = el('div', 'ui-sky-hero', figureSvg(c, 324, 236, true));
    const step = (delta: number) => {
      const k = this.order.indexOf(index);
      this.select(this.order[(k + delta + this.order.length) % this.order.length]);
    };
    const prev = iconButton('slower', 'Anterior', () => step(-1), undefined, 'ui-sky-prev');
    const next = iconButton('faster', 'Siguiente', () => step(1), undefined, 'ui-sky-next');
    hero.append(prev, next);

    const facts: [string, string, string?][] = [
      ['Nombre latino', c.latin, `genitivo ${c.genitive} · ${c.id}`],
      ['Área', `${num(c.area, 1)} grados²`, `${c.areaRank}.ª de 88 por tamaño`],
      ['Estrella más brillante', c.brightest.name || c.brightest.desig || '—', `${c.brightest.name && c.brightest.desig ? `${c.brightest.desig} · ` : ''}magnitud ${num(c.brightest.mag, 2)}`],
      ['A simple vista', `${num(c.nakedEye)} estrellas`, 'hasta la magnitud 6'],
      ['Se ve entera', visibleFrom(c), 'en latitud'],
      ['Mejor época', MONTHS[bestMonth(c)], 'alta a medianoche'],
    ];
    if (c.ecliptic) {
      const p = sunPassage(this.year, c.ecliptic);
      facts.push(['El Sol pasa por ella', `${shortDate(p.from)} – ${shortDate(p.to)}`, `en ${this.year}, visto desde la Tierra`]);
    }
    const grid = el('dl', 'ui-facts');
    grid.append(...facts.map(([label, value, note]) => {
      const wrap = el('div');
      const dd = el('dd');
      dd.textContent = value;
      if (note) dd.append(el('small', '', note));
      wrap.append(el('dt', '', label), dd);
      return wrap;
    }));

    const liveGrid = el('dl', 'ui-facts ui-facts-live');
    const row = el('div');
    const value = el('dd');
    row.append(el('dt', '', 'A ras de suelo'), value);
    liveGrid.append(row);
    const liveSection = el('div', 'ui-info-live', '<h3>Ahora mismo</h3>');
    liveSection.append(liveGrid);
    this.live = { row: liveSection, value };
    this.lastLive = 0;

    const look = el('button', 'ui-action ui-action-primary ui-info-land', `${icons.eye}<span>Encuadrar ${c.name}</span>`);
    look.type = 'button';
    look.addEventListener('click', () => this.source.onLook(index));

    this.detailView.replaceChildren(
      hero,
      el('p', 'ui-info-blurb', c.meaning),
      grid,
      liveSection,
      look,
      el('p', 'ui-info-source', `${c.origin}. Figura de la IAU y Sky & Telescope; límite de Delporte (1930), del que salen el área y las estrellas.`),
    );
    this.detailView.scrollTop = 0;
    this.updateLive();
  }

  /** Con la fecha simulada: la altura a ras de suelo y, si cambia el año, el paso del Sol. */
  update(timeMs: number, now: number): void {
    if (!this.open) return;
    if (this.current >= 0 && new Date(timeMs).getUTCFullYear() !== this.year) this.show(this.current, timeMs);
    if (now - this.lastLive < 400) return;
    this.lastLive = now;
    this.refreshChips();
    if (this.current >= 0) this.updateLive();
    else if (this.filter === 'now') this.renderList();
    // «Ahora» solo tiene sentido a ras de suelo.
    const ground = this.data !== null && this.source.altitude(0) !== null;
    const nowButton = this.filters.get('now')!;
    if (nowButton.hidden === ground) nowButton.hidden = !ground;
    if (!ground && this.filter === 'now') {
      this.filter = 'all';
      this.renderList();
    }
  }

  private refreshChips(): void {
    for (const { toggle, button } of this.chips) {
      const on = toggle.get();
      button.classList.toggle('on', on);
      button.setAttribute('aria-pressed', String(on));
    }
  }

  private updateLive(): void {
    if (!this.live || this.current < 0) return;
    const alt = this.source.altitude(this.current);
    this.live.row.hidden = alt === null;
    if (alt !== null) setText(this.live.value, alt > 0 ? `A ${num(alt)}° sobre el horizonte` : `Bajo el horizonte (${num(alt)}°)`);
  }

  private renderList(): void {
    for (const [filter, b] of this.filters) {
      const on = filter === this.filter;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    }
    if (!this.data) {
      this.grid.replaceChildren(el('p', 'ui-events-empty', 'Cargando el cielo…'));
      return;
    }
    const q = fold(this.search.value.trim());
    const altitude = new Map<number, number>();
    let items = this.data.constellations.filter((c) => {
      if (q && !fold(`${c.name} ${c.latin} ${c.id}`).includes(q)) return false;
      if (this.filter === 'zodiac') return c.ecliptic !== null;
      if (this.filter === 'north') return c.figure.center[1] >= 0;
      if (this.filter === 'south') return c.figure.center[1] < 0;
      if (this.filter === 'now') {
        const a = this.source.altitude(c.index);
        if (a === null || a <= 0) return false;
        altitude.set(c.index, a);
      }
      return true;
    });
    items = this.filter === 'now'
      ? items.sort((a, b) => altitude.get(b.index)! - altitude.get(a.index)!)
      : items.sort((a, b) => a.name.localeCompare(b.name, 'es'));
    // El zodiaco, en el orden en que el Sol pasa por él.
    if (this.filter === 'zodiac') items.sort((a, b) => a.ecliptic![0] - b.ecliptic![0]);
    this.order = items.map((c) => c.index);

    for (const c of items) {
      const { detail } = this.cards.get(c.index)!;
      setText(detail, this.filter === 'now' ? `a ${num(altitude.get(c.index)!)}°` : this.filter === 'zodiac' && c.ecliptic ? `${c.latin}` : `${num(c.area)} grados²`);
    }
    this.grid.replaceChildren(...(items.length
      ? items.map((c) => this.cards.get(c.index)!.card)
      : [el('p', 'ui-events-empty', this.filter === 'now' ? 'Ninguna sobre el horizonte' : 'Ninguna con ese nombre')]));
  }
}
