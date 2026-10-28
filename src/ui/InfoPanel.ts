/**
 * Ficha del cuerpo: descripción, datos físicos y orbitales, distancias en vivo y acceso a
 * la superficie. Ver docs/ARQUITECTURA.md §11 y las fuentes en `astro/facts.ts`.
 */
import { BODIES, type BodyId } from '../astro/bodies';
import { FACTS, G, ofName } from '../astro/facts';
import { el, iconButton, setText } from './dom';
import { formatDistance, formatDuration, lightTime, scientific } from './format';
import { icons } from './icons';

const EARTH_MASS = FACTS.earth.massKg;
const num = (x: number, digits = 2) => x.toLocaleString('es', { maximumFractionDigits: digits });

export interface InfoLive {
  sunDistanceKm: number;
  earthDistanceKm: number;
  cameraDistanceKm: number;
}

/** Tipo del cuerpo para los subtítulos: «Gigante de hielo · 7.º planeta», «Luna de Júpiter». */
export function bodyKicker(id: BodyId): string {
  const data = BODIES[id];
  const facts = FACTS[id];
  if (data.parent && data.parent !== 'sun') return `${facts.type} ${ofName(data.parent, BODIES[data.parent].name)}`;
  const order = ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'].indexOf(id);
  return order >= 0 ? `${facts.type} · ${order + 1}.º planeta` : facts.type;
}

/** Periodo orbital alrededor del padre (días). */
export function orbitalPeriodDays(id: BodyId): number | null {
  const data = BODIES[id];
  if (data.orbit) return 365.25 * data.orbit.a.value ** 1.5;
  if (data.satellite) return 360 / data.satellite.meanMotion;
  return FACTS[id].orbitDays ?? null;
}

export class InfoPanel {
  readonly el: HTMLElement;
  private readonly kicker: HTMLElement;
  private readonly name: HTMLElement;
  private readonly blurb: HTMLElement;
  private readonly grid: HTMLElement;
  private readonly live: Record<keyof InfoLive | 'light', HTMLElement>;
  private readonly liveRows: Record<keyof InfoLive | 'light', HTMLElement>;
  private readonly land: HTMLButtonElement;
  private id: BodyId | null = null;
  private lastLive = 0;

  constructor(private readonly actions: { onClose(): void; onLand(): void }) {
    this.el = el('aside', 'ui-info glass');
    this.el.setAttribute('aria-label', 'Ficha del cuerpo');
    this.el.hidden = true;

    const head = el('header', 'ui-info-head');
    this.kicker = el('p', 'ui-kicker');
    this.name = el('h2', 'ui-info-name');
    const titles = el('div');
    titles.append(this.kicker, this.name);
    head.append(titles, iconButton('close', 'Cerrar', actions.onClose, 'I', 'ui-close'));

    this.blurb = el('p', 'ui-info-blurb');
    this.grid = el('dl', 'ui-facts');

    const liveSection = el('div', 'ui-info-live', '<h3>Ahora mismo</h3>');
    const liveGrid = el('dl', 'ui-facts ui-facts-live');
    const row = (label: string) => {
      const wrap = el('div');
      const dd = el('dd');
      wrap.append(el('dt', '', label), dd);
      liveGrid.append(wrap);
      return [wrap, dd] as const;
    };
    const sun = row('Distancia al Sol');
    const light = row('La luz del Sol tarda');
    const earth = row('Distancia a la Tierra');
    const camera = row('Distancia a la cámara');
    this.live = { sunDistanceKm: sun[1], light: light[1], earthDistanceKm: earth[1], cameraDistanceKm: camera[1] };
    this.liveRows = { sunDistanceKm: sun[0], light: light[0], earthDistanceKm: earth[0], cameraDistanceKm: camera[0] };
    liveSection.append(liveGrid);

    this.land = el('button', 'ui-action ui-action-primary ui-info-land');
    this.land.type = 'button';
    this.land.addEventListener('click', actions.onLand);

    const source = el('p', 'ui-info-source', 'Datos: NASA NSSDCA (Planetary Fact Sheet) y JPL SSD. Posiciones calculadas para la fecha simulada.');
    const body = el('div', 'ui-info-body');
    body.append(this.blurb, this.grid, liveSection, this.land, source);
    this.el.append(head, body);
  }

  get open(): boolean {
    return !this.el.hidden;
  }

  setOpen(open: boolean): void {
    this.el.hidden = !open;
    this.lastLive = 0;
  }

  show(id: BodyId, landable: boolean): void {
    if (id === this.id && this.land.hidden === !landable) return;
    this.id = id;
    const data = BODIES[id];
    const facts = FACTS[id];
    setText(this.kicker, bodyKicker(id));
    setText(this.name, data.name);
    setText(this.blurb, facts.blurb);
    this.el.style.setProperty('--c', `#${data.color.toString(16).padStart(6, '0')}`);

    const r = data.radiusKm * 1000;
    const gm = G * facts.massKg;
    const gravity = gm / (r * r);
    const escape = Math.sqrt((2 * gm) / r) / 1000;
    const rotation = data.rotationPeriodH;
    const period = orbitalPeriodDays(id);
    const rows: [string, string, string?][] = [
      ['Radio', `${num(data.radiusKm, 0)} km`, data.radiusKm > 1000 && id !== 'sun' ? `${num(data.radiusKm / BODIES.earth.radiusKm)} × Tierra` : undefined],
      ['Masa', `${scientific(facts.massKg)} kg`, id !== 'earth' ? `${num(facts.massKg / EARTH_MASS, facts.massKg / EARTH_MASS < 0.01 ? 4 : 2)} × Tierra` : undefined],
      ['Gravedad', `${num(gravity, 2)} m/s²`, `${num(gravity / 9.80665, 2)} g`],
      ['Velocidad de escape', `${num(escape, 1)} km/s`],
      ['Rotación', formatDuration(Math.abs(rotation)), data.tidallyLocked ? 'síncrona' : rotation < 0 ? 'retrógrada' : undefined],
    ];
    if (period !== null) rows.push(['Órbita', formatDuration(period * 24), data.parent && data.parent !== 'sun' ? `alrededor ${ofName(data.parent, BODIES[data.parent].name)}` : 'alrededor del Sol']);
    rows.push(['Inclinación del eje', `${num(data.axialTiltDeg, 1)}°`]);
    if (facts.meanTempC !== undefined) rows.push([id === 'sun' ? 'Temperatura de la superficie' : 'Temperatura media', `${num(facts.meanTempC, 0)} °C`]);
    if (facts.pressureBar !== undefined) rows.push(['Presión en superficie', formatPressure(facts.pressureBar)]);
    if (facts.moons !== undefined) rows.push(['Lunas conocidas', num(facts.moons, 0)]);

    this.grid.replaceChildren(...rows.map(([label, value, note]) => {
      const wrap = el('div');
      const dd = el('dd', '', value);
      if (note) dd.append(el('small', '', note));
      wrap.append(el('dt', '', label), dd);
      return wrap;
    }));

    this.liveRows.sunDistanceKm.hidden = id === 'sun';
    this.liveRows.light.hidden = id === 'sun';
    this.liveRows.earthDistanceKm.hidden = id === 'earth';
    this.land.hidden = !landable;
    this.land.innerHTML = `${icons.land}<span>${facts.site ? `Aterrizar en ${facts.site.name}` : 'Aterrizar'}</span>`;
    this.lastLive = 0;
  }

  update(live: InfoLive, now: number): void {
    if (!this.open || now - this.lastLive < 200) return;
    this.lastLive = now;
    setText(this.live.sunDistanceKm, formatDistance(live.sunDistanceKm));
    setText(this.live.light, lightTime(live.sunDistanceKm));
    setText(this.live.earthDistanceKm, formatDistance(live.earthDistanceKm));
    setText(this.live.cameraDistanceKm, formatDistance(live.cameraDistanceKm));
  }

  set landDisabled(disabled: boolean) {
    this.land.disabled = disabled;
  }

  get bodyId(): BodyId | null {
    return this.id;
  }

  close(): void {
    this.actions.onClose();
  }
}

function formatPressure(bar: number | null): string {
  if (bar === null) return 'Sin superficie sólida';
  if (bar === 0) return 'Casi vacío';
  if (bar < 0.001) return `${num(bar * 1e6, 0)} µbar`;
  return `${num(bar, 2)} bar`;
}
