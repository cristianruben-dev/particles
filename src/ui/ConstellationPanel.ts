/**
 * Constelaciones: qué se dibuja (figuras, límites, nombres, guías), la lista con buscador y
 * filtros, y la ficha de cada una. Ver docs/ARQUITECTURA.md §15.3.
 */
import { bestMonth, sunPassage, type Constellation, type SkyData } from '../astro/constellations';
import { el, iconButton, setText } from './dom';
import { icons } from './icons';
import type { SettingsToggle } from './SettingsPanel';

export interface ConstellationSource {
  /** Interruptores del cielo (los mismos que se guardan en las preferencias). */
  toggles: SettingsToggle[];
  /** Altura sobre el horizonte (grados) del centro de la constelación a ras de suelo; null en órbita. */
  altitude(index: number): number | null;
  /** El usuario elige una (o ninguna, −1) en la lista. */
  onSelect(index: number): void;
  onLook(index: number): void;
  onClose(): void;
}

type Filter = 'all' | 'zodiac' | 'north' | 'south' | 'now';

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const num = (x: number, digits = 0) => x.toLocaleString('es', { maximumFractionDigits: digits, minimumFractionDigits: digits });
const shortDate = (d: Date) => d.toLocaleDateString('es', { day: 'numeric', month: 'short', timeZone: 'UTC' }).replace('.', '');
/** Sin tildes ni mayúsculas, para buscar. */
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const latitude = (lat: number) => (Math.abs(lat) < 0.5 ? 'el ecuador' : `${num(Math.abs(lat))}° ${lat > 0 ? 'N' : 'S'}`);

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

export class ConstellationPanel {
  readonly el: HTMLElement;
  private readonly kicker: HTMLElement;
  private readonly name: HTMLElement;
  private readonly back: HTMLButtonElement;
  private readonly listView: HTMLElement;
  private readonly detailView: HTMLElement;
  private readonly list: HTMLElement;
  private readonly search: HTMLInputElement;
  private readonly filters = new Map<Filter, HTMLButtonElement>();
  private readonly switches: { toggle: SettingsToggle; input: HTMLInputElement }[] = [];
  private data: SkyData | null = null;
  private filter: Filter = 'all';
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

    // Lista: interruptores, buscador, filtros.
    this.listView = el('div', 'ui-info-body');
    const prefs = el('div', 'ui-sky-switches');
    for (const toggle of source.toggles) {
      const row = el('label', 'ui-switch');
      const input = el('input');
      input.type = 'checkbox';
      input.addEventListener('change', () => toggle.set(input.checked));
      row.append(el('span', '', toggle.label));
      if (toggle.key) row.append(el('kbd', '', toggle.key));
      row.append(input, el('i'));
      prefs.append(row);
      this.switches.push({ toggle, input });
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
    this.list = el('ul', 'ui-events-list ui-sky-list');
    const note = el('p', 'ui-info-source',
      'Las 88 constelaciones de la IAU. Figuras de la IAU y Sky & Telescope (vía d3-celestial), límites oficiales de Delporte (1930) y estrellas del catálogo de Yale. Con el ratón sobre el cielo se ilumina la que hay debajo; con un clic, su ficha.');
    this.listView.append(prefs, this.search, seg, this.list, note);

    this.detailView = el('div', 'ui-info-body');
    this.el.append(head, this.listView, this.detailView);
    this.showList();
  }

  get open(): boolean {
    return !this.el.hidden;
  }

  /** Constelación de la ficha abierta (−1 en la lista). */
  get shown(): number {
    return this.current;
  }

  setData(data: SkyData): void {
    this.data = data;
    if (this.open) this.current >= 0 ? this.show(this.current) : this.renderList();
  }

  setOpen(open: boolean): void {
    if (open === this.open) return;
    this.el.hidden = !open;
    if (!open && this.current >= 0) this.source.onSelect(-1);
    if (open) this.showList();
  }

  /** Abre la lista. */
  showList(): void {
    this.current = -1;
    this.back.hidden = true;
    this.listView.hidden = false;
    this.detailView.hidden = true;
    setText(this.kicker, 'El cielo');
    setText(this.name, 'Constelaciones');
    for (const { toggle, input } of this.switches) input.checked = toggle.get();
    this.renderList();
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

    const look = el('button', 'ui-action ui-action-primary ui-info-land', `${icons.eye}<span>Mirar hacia ${c.name}</span>`);
    look.type = 'button';
    look.addEventListener('click', () => this.source.onLook(index));

    this.detailView.replaceChildren(
      el('p', 'ui-info-blurb', c.meaning),
      grid,
      liveSection,
      look,
      el('p', 'ui-info-source', `${c.origin}. Figura de la IAU y Sky & Telescope; límite de Delporte (1930), del que salen el área y las estrellas.`),
    );
    this.updateLive();
  }

  /** Con la fecha simulada: la altura a ras de suelo y, si cambia el año, el paso del Sol. */
  update(timeMs: number, now: number): void {
    if (!this.open) return;
    if (this.current >= 0 && new Date(timeMs).getUTCFullYear() !== this.year) this.show(this.current, timeMs);
    if (now - this.lastLive < 400) return;
    this.lastLive = now;
    for (const { toggle, input } of this.switches) if (input.checked !== toggle.get()) input.checked = toggle.get();
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
      this.list.replaceChildren(el('li', 'ui-events-empty', 'Cargando el cielo…'));
      return;
    }
    const q = fold(this.search.value.trim());
    const altitude = new Map<number, number>();
    let items = this.data.constellations.filter((c) => {
      if (q && !fold(`${c.name} ${c.latin} ${c.id}`).includes(q)) return false;
      if (this.filter === 'zodiac') return c.ecliptic !== null;
      if (this.filter === 'north') return c.view[1] >= 0;
      if (this.filter === 'south') return c.view[1] < 0;
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
    if (this.filter === 'zodiac') items.sort((a, b) => a.ecliptic![0] - b.ecliptic![0]);

    this.list.replaceChildren(...(items.length ? items.map((c) => {
      const li = el('li');
      const b = el('button', 'ui-event ui-sky-row');
      b.type = 'button';
      const detail = this.filter === 'now' ? `a ${num(altitude.get(c.index)!)}° sobre el horizonte` : `${c.latin} · ${num(c.area)} grados²`;
      b.append(el('span', `ui-sky-mark rank-${c.rank}`), el('div', 'ui-event-text', `<b>${c.name}</b><small>${detail}</small>`));
      b.addEventListener('click', () => {
        this.source.onSelect(c.index);
        this.show(c.index);
      });
      li.append(b);
      return li;
    }) : [el('li', 'ui-events-empty', this.filter === 'now' ? 'Ninguna sobre el horizonte' : 'Ninguna con ese nombre')]));
  }
}
