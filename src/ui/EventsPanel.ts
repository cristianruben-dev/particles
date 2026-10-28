/**
 * Eventos: próximos (o anteriores) eclipses de Sol y de Luna, tránsitos de sombra y eclipses
 * en el sistema de Júpiter, y el paso de los cometas por el perihelio, calculados con las
 * mismas efemérides que mueven la escena. «Ir» lleva el reloj y la cámara allí.
 * Ver docs/ARQUITECTURA.md §11.
 */
import { BODIES } from '../astro/bodies';
import { geodeticLatitude, type ShadowEvent } from '../astro/eclipses';
import { el, iconButton, setText } from './dom';
import { dateParts, formatDuration } from './format';
import { icons } from './icons';

/** Paso de un cometa por el perihelio. */
export interface PerihelionEvent {
  id: string;
  name: string;
  timeMs: number;
  /** Distancia al Sol en el perihelio (UA). */
  qAU: number;
}

export interface EventsSource {
  shadows(group: 'solar' | 'lunar' | 'jupiter', fromMs: number, direction: 1 | -1): ShadowEvent[];
  perihelia(fromMs: number, direction: 1 | -1): PerihelionEvent[];
  onGo(event: ShadowEvent, fromGround: boolean): void;
  onGoComet(event: PerihelionEvent): void;
  onClose(): void;
}

const TYPE_TEXT: Record<ShadowEvent['kind'], Partial<Record<ShadowEvent['type'], string>>> = {
  solar: { total: 'Eclipse total de Sol', annular: 'Eclipse anular de Sol', partial: 'Eclipse parcial de Sol' },
  lunar: { total: 'Eclipse total de Luna', partial: 'Eclipse parcial de Luna', penumbral: 'Eclipse penumbral de Luna' },
  transit: {},
  moonEclipse: {},
};

/**
 * Cada cuánto (ms simulados) se rehace la lista mientras está abierta, y como mucho una vez
 * cada `REFRESH_WALL_MS` de reloj real: con el tiempo a 1 año/s, si no, se buscaría cada frame.
 */
const REFRESH_MS: Record<'slow' | 'jupiter', number> = { slow: 20 * 86_400_000, jupiter: 3 * 3600_000 };
const REFRESH_WALL_MS = 1500;

const num = (x: number, digits = 1) => x.toLocaleString('es', { maximumFractionDigits: digits, minimumFractionDigits: digits });
const hhmm = (ms: number) => dateParts(new Date(ms)).time.slice(0, 5);
const day = (ms: number) => dateParts(new Date(ms)).day;
const latLon = (s: { lat: number; lon: number }) =>
  `${num(Math.abs(s.lat))}° ${s.lat >= 0 ? 'N' : 'S'}, ${num(Math.abs(s.lon))}° ${s.lon >= 0 ? 'E' : 'O'}`;

export class EventsPanel {
  readonly el: HTMLElement;
  private readonly from: HTMLElement;
  private readonly lists: Record<'solar' | 'lunar' | 'jupiter' | 'comets', HTMLElement>;
  private readonly segments: HTMLButtonElement[];
  private direction: 1 | -1 = 1;
  private computedAt: Record<'slow' | 'jupiter', number> = { slow: NaN, jupiter: NaN };
  private refreshedAt = 0;
  private timeMs = 0;

  constructor(private readonly source: EventsSource) {
    this.el = el('aside', 'ui-info ui-events glass');
    this.el.setAttribute('aria-label', 'Eventos');
    this.el.hidden = true;

    const head = el('header', 'ui-info-head');
    const titles = el('div');
    titles.append(el('p', 'ui-kicker', 'Calendario'), el('h2', 'ui-info-name', 'Eventos'));
    head.append(titles, iconButton('close', 'Cerrar', source.onClose, 'C', 'ui-close'));

    const seg = el('div', 'ui-segmented');
    seg.setAttribute('role', 'radiogroup');
    this.segments = (['Próximos', 'Anteriores'] as const).map((label, i) => {
      const b = el('button', '', label);
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.addEventListener('click', () => {
        this.direction = i === 0 ? 1 : -1;
        this.refresh(true);
      });
      seg.append(b);
      return b;
    });
    this.from = el('p', 'ui-events-from');

    const section = (title: string) => {
      const s = el('section', 'ui-section', `<h3>${title}</h3>`);
      const list = el('ul', 'ui-events-list');
      s.append(list);
      return [s, list] as const;
    };
    const solar = section('Eclipses de Sol');
    const lunar = section('Eclipses de Luna');
    const jupiter = section('Sombras en Júpiter');
    const comets = section('Cometas en el perihelio');
    this.lists = { solar: solar[1], lunar: lunar[1], jupiter: jupiter[1], comets: comets[1] };

    const note = el('p', 'ui-info-source',
      'Calculados con las efemérides de la escena (la Luna con ELP-2000/82): el lugar del máximo cae a menos de 25 km del que da la NASA (algo más en los rasantes, cerca de los polos) y la hora, en menos de un minuto. En la escala comprimida la sombra cae en su sitio, pero desde el suelo la Luna no tapa exactamente al Sol: para verlo así, escala real.');
    const body = el('div', 'ui-info-body');
    body.append(seg, this.from, solar[0], lunar[0], jupiter[0], comets[0], note);
    this.el.append(head, body);
  }

  get open(): boolean {
    return !this.el.hidden;
  }

  setOpen(open: boolean): void {
    this.el.hidden = !open;
    if (open) this.refresh(true);
  }

  /** Con la fecha simulada de cada frame: rehace la lista si se ha movido mucho. */
  update(timeMs: number): void {
    this.timeMs = timeMs;
    if (!this.open || performance.now() - this.refreshedAt < REFRESH_WALL_MS) return;
    if (Math.abs(timeMs - this.computedAt.jupiter) > REFRESH_MS.jupiter) this.refresh(false);
  }

  private refresh(all: boolean): void {
    const t = this.timeMs;
    this.refreshedAt = performance.now();
    this.segments.forEach((b, i) => {
      const on = (i === 0) === (this.direction === 1);
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    });
    setText(this.from, `${this.direction > 0 ? 'Desde' : 'Hasta'} el ${day(t)} (fecha simulada)`);
    if (all || Math.abs(t - this.computedAt.slow) > REFRESH_MS.slow) {
      this.computedAt.slow = t;
      this.fill(this.lists.solar, this.source.shadows('solar', t, this.direction).map((e) => this.shadowRow(e)));
      this.fill(this.lists.lunar, this.source.shadows('lunar', t, this.direction).map((e) => this.shadowRow(e)));
      this.fill(this.lists.comets, this.source.perihelia(t, this.direction).map((e) => this.cometRow(e)));
    }
    this.computedAt.jupiter = t;
    this.fill(this.lists.jupiter, this.source.shadows('jupiter', t, this.direction).map((e) => this.shadowRow(e)));
  }

  private fill(list: HTMLElement, rows: HTMLElement[]): void {
    list.replaceChildren(...(rows.length ? rows : [el('li', 'ui-events-empty', 'Ninguno en los próximos años')]));
  }

  private shadowRow(e: ShadowEvent): HTMLElement {
    const occluder = BODIES[e.occluder].name, receiver = BODIES[e.receiver].name;
    let title = TYPE_TEXT[e.kind][e.type] ?? '';
    let detail = `${day(e.maxMs)} · máximo ${hhmm(e.maxMs)} UTC`;
    if (e.kind === 'solar' && e.site) detail += ` · ${latLon({ lat: geodeticLatitude(e.site.lat), lon: e.site.lon })}`;
    if (e.kind === 'lunar') detail += ` · ${formatDuration((e.endMs - e.startMs) / 3600_000)}`;
    if (e.kind === 'transit') {
      title = `Sombra de ${occluder} sobre ${receiver}`;
      detail = `${day(e.startMs)} · ${hhmm(e.startMs)}–${hhmm(e.endMs)} UTC`;
    }
    if (e.kind === 'moonEclipse') {
      title = `Eclipse de ${receiver}`;
      detail = `${day(e.startMs)} · ${hhmm(e.startMs)}–${hhmm(e.endMs)} UTC · en la sombra de ${occluder}`;
    }
    const kind = e.kind === 'solar' || e.kind === 'transit' ? 'sun' : 'moon';
    const buttons = [this.goButton('Ir', () => this.source.onGo(e, false))];
    // Desde el suelo, solo donde pasa la umbra o la antumbra.
    if (e.kind === 'solar' && e.site && e.type !== 'partial') buttons.push(this.goButton('Desde el suelo', () => this.source.onGo(e, true), true));
    return this.row(kind, e.type, title, detail, buttons);
  }

  private cometRow(e: PerihelionEvent): HTMLElement {
    const detail = `${day(e.timeMs)} · a ${num(e.qAU, 2)} UA del Sol`;
    return this.row('comet', 'shadow', e.name, detail, [this.goButton('Ir', () => this.source.onGoComet(e))]);
  }

  private row(kind: 'sun' | 'moon' | 'comet', type: string, title: string, detail: string, buttons: HTMLButtonElement[]): HTMLElement {
    const li = el('li', 'ui-event');
    li.append(el('span', `ui-event-mark ${kind} ${type}`), el('div', 'ui-event-text', `<b>${title}</b><small>${detail}</small>`));
    const actions = el('div', 'ui-event-go');
    actions.append(...buttons);
    li.append(actions);
    return li;
  }

  private goButton(label: string, run: () => void, secondary = false): HTMLButtonElement {
    const b = el('button', secondary ? 'ui-action ui-event-btn' : 'ui-action ui-action-primary ui-event-btn', secondary ? `${icons.land}<span>${label}</span>` : `<span>${label}</span>`);
    b.type = 'button';
    b.addEventListener('click', run);
    return b;
  }
}
