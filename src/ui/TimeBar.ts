/**
 * Control del tiempo: fecha simulada (UTC), pausa, velocidad y salto a una fecha.
 */
import { TIME_RATES } from '../core/SimClock';
import { el, iconButton, setText } from './dom';
import { dateParts } from './format';
import { icons } from './icons';

export interface TimeActions {
  onSlower(): void;
  onTogglePause(): void;
  onFaster(): void;
  onSetRate(index: number): void;
  onNow(): void;
  onSetDate(ms: number): void;
}

export interface TimeState {
  date: Date;
  rateIndex: number;
  paused: boolean;
}

export class TimeBar {
  readonly el: HTMLElement;
  private readonly day: HTMLElement;
  private readonly hour: HTMLElement;
  private readonly rate: HTMLElement;
  private readonly play: HTMLButtonElement;
  private readonly ticks: HTMLButtonElement[] = [];
  private readonly picker: HTMLElement;
  private readonly dateInput: HTMLInputElement;
  private paused: boolean | null = null;
  private rateIndex = -1;

  constructor(actions: TimeActions) {
    this.el = el('section', 'ui-time glass');
    this.el.setAttribute('aria-label', 'Tiempo');

    const clock = el('div', 'ui-clock');
    this.day = el('span', 'ui-day');
    this.hour = el('span', 'ui-hour');
    clock.append(this.day, this.hour, el('span', 'ui-utc', 'UTC'));

    const controls = el('div', 'ui-time-controls');
    this.play = iconButton('pause', 'Pausa', actions.onTogglePause, 'Espacio', 'ui-play');
    const rate = el('div', 'ui-rate');
    this.rate = el('span', 'ui-rate-label');
    const ticks = el('div', 'ui-rate-ticks');
    TIME_RATES.forEach((r, i) => {
      const t = el('button', 'ui-tick');
      t.type = 'button';
      t.setAttribute('aria-label', r.label);
      t.dataset.tip = r.label;
      t.addEventListener('click', () => actions.onSetRate(i));
      ticks.append(t);
      this.ticks.push(t);
    });
    rate.append(this.rate, ticks);

    // Fecha: el campo va en una burbuja; en Chrome y Safari se abre el selector nativo.
    this.picker = el('div', 'ui-date-pop glass ui-pop');
    this.picker.hidden = true;
    this.dateInput = el('input', 'ui-date-input');
    this.dateInput.type = 'datetime-local';
    this.dateInput.step = '60';
    this.dateInput.addEventListener('change', () => {
      // La fecha del campo se interpreta en UTC, como la del reloj.
      const ms = Date.parse(`${this.dateInput.value}:00Z`);
      if (!Number.isNaN(ms)) actions.onSetDate(ms);
    });
    this.picker.append(el('label', 'ui-date-label', 'Ir a la fecha (UTC)'), this.dateInput);
    const calendar = iconButton('calendar', 'Ir a una fecha', () => {
      this.picker.hidden = !this.picker.hidden;
      if (!this.picker.hidden) {
        this.dateInput.focus();
        try {
          this.dateInput.showPicker();
        } catch {
          // Sin selector nativo: queda el campo.
        }
      }
    });
    document.addEventListener('pointerdown', (e) => {
      if (!this.picker.hidden && !this.picker.contains(e.target as Node) && !calendar.contains(e.target as Node)) this.picker.hidden = true;
    });

    controls.append(
      iconButton('slower', 'Más lento', actions.onSlower, ','),
      this.play,
      iconButton('faster', 'Más rápido', actions.onFaster, '.'),
      rate,
      iconButton('now', 'Volver a ahora', actions.onNow, 'N'),
      calendar,
    );
    this.el.append(clock, controls, this.picker);
  }

  update(s: TimeState): void {
    const { day, time } = dateParts(s.date);
    setText(this.day, day);
    setText(this.hour, time);
    if (s.paused !== this.paused) {
      this.paused = s.paused;
      this.play.innerHTML = s.paused ? icons.play : icons.pause;
      this.play.dataset.tip = s.paused ? 'Reanudar' : 'Pausa';
      this.play.setAttribute('aria-label', this.play.dataset.tip);
      this.el.classList.toggle('paused', s.paused);
    }
    if (s.rateIndex !== this.rateIndex) {
      this.rateIndex = s.rateIndex;
      this.ticks.forEach((t, i) => {
        t.classList.toggle('lit', i <= s.rateIndex);
        t.classList.toggle('on', i === s.rateIndex);
      });
    }
    setText(this.rate, s.paused ? 'En pausa' : TIME_RATES[s.rateIndex].label);
    if (document.activeElement !== this.dateInput) {
      const value = s.date.toISOString().slice(0, 16);
      if (this.dateInput.value !== value) this.dateInput.value = value;
    }
  }
}
