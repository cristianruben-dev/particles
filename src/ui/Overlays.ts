/**
 * Capas sobre la escena: tarjeta de viaje, avisos, pista de bienvenida y ayuda de controles.
 */
import { el, iconButton, setText } from './dom';
import { formatDistance } from './format';
import { icons } from './icons';

/** «Rumbo a Marte» con el progreso del viaje. */
export class TravelCard {
  readonly el: HTMLElement;
  private readonly name: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly distance: HTMLElement;
  private active = false;

  constructor() {
    this.el = el('div', 'ui-travel');
    this.el.setAttribute('aria-live', 'polite');
    this.el.innerHTML = `<p class="ui-kicker">Rumbo a</p><p class="ui-travel-name"></p><div class="ui-travel-track"><i></i></div><p class="ui-travel-distance"></p>`;
    this.name = this.el.querySelector('.ui-travel-name')!;
    this.bar = this.el.querySelector('i')!;
    this.distance = this.el.querySelector('.ui-travel-distance')!;
  }

  update(travel: { name: string; progress: number; distanceKm: number } | null): void {
    const show = travel !== null && travel.progress < 0.97;
    if (show !== this.active) {
      this.active = show;
      this.el.classList.toggle('on', show);
    }
    if (!travel) return;
    setText(this.name, travel.name);
    this.bar.style.transform = `scaleX(${travel.progress.toFixed(3)})`;
    setText(this.distance, formatDistance(travel.distanceKm));
  }
}

/** Avisos breves arriba en el centro. */
export class Toasts {
  readonly el: HTMLElement;

  constructor() {
    this.el = el('div', 'ui-toasts');
    this.el.setAttribute('role', 'status');
  }

  show(text: string, icon: keyof typeof icons = 'sparkle', seconds = 3.6): void {
    const t = el('div', 'ui-toast glass', `${icons[icon]}<span></span>`);
    t.querySelector('span')!.textContent = text;
    this.el.append(t);
    requestAnimationFrame(() => t.classList.add('on'));
    setTimeout(() => {
      t.classList.remove('on');
      setTimeout(() => t.remove(), 400);
    }, seconds * 1000);
  }
}

const COACH_KEY = 'particles.coach';

/** Pista de la primera visita; desaparece al usar los controles. */
export class Coach {
  readonly el: HTMLElement;
  private done: boolean;

  constructor() {
    let seen = false;
    try {
      seen = localStorage.getItem(COACH_KEY) === '1';
    } catch {
      seen = false;
    }
    this.done = seen;
    this.el = el('div', 'ui-coach glass');
    this.el.innerHTML = `
      <span><kbd>Arrastra</kbd> para girar</span>
      <span><kbd>Rueda</kbd> para acercarte hasta el suelo</span>
      <span><kbd>Clic</kbd> en un planeta para viajar</span>`;
    this.el.append(iconButton('close', 'Entendido', () => this.dismiss(), undefined, 'ui-close'));
    this.el.hidden = seen;
  }

  /** Se muestra un poco después de entrar (cuando la escena ya está formada). */
  start(delaySeconds: number): void {
    if (this.done) return;
    setTimeout(() => !this.done && this.el.classList.add('on'), delaySeconds * 1000);
  }

  dismiss(): void {
    if (this.done) return;
    this.done = true;
    this.el.classList.remove('on');
    setTimeout(() => (this.el.hidden = true), 500);
    try {
      localStorage.setItem(COACH_KEY, '1');
    } catch {
      // Sin almacenamiento: volverá a salir en la próxima visita.
    }
  }
}

const SHORTCUTS: [string, [string, string][]][] = [
  ['Ratón', [
    ['Arrastrar', 'Girar alrededor del cuerpo'],
    ['Botón derecho · Mayús + arrastrar', 'Mirar alrededor'],
    ['Rueda', 'Acercarse y alejarse, hasta el suelo'],
    ['Clic', 'Viajar al cuerpo o al nombre pulsado'],
  ]],
  ['Teclado', [
    ['0 – 9', 'Sol y planetas'],
    ['Espacio', 'Pausar el tiempo'],
    [', .', 'Más lento · más rápido'],
    ['N', 'Volver a ahora'],
    ['T', 'Aterrizar · volver a la órbita'],
    ['I', 'Ficha del cuerpo'],
    ['C', 'Eclipses, tránsitos y cometas'],
    ['E · O · L', 'Escala · órbitas · nombres'],
    ['U', 'Ocultar la interfaz'],
  ]],
  ['Vuelo libre (V)', [
    ['W A S D', 'Avanzar, retroceder y a los lados'],
    ['R F', 'Subir y bajar'],
    ['Q E', 'Girar sobre el eje'],
    ['Arrastrar', 'Mirar'],
    ['Mayús', 'Turbo'],
    ['Rueda', 'Velocidad de crucero'],
    ['V · Esc', 'Volver a la órbita'],
  ]],
];

export class HelpOverlay {
  readonly el: HTMLElement;

  constructor(onClose: () => void) {
    this.el = el('div', 'ui-modal');
    this.el.hidden = true;
    const card = el('section', 'ui-help glass');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', 'Controles');
    const head = el('header', 'ui-pop-head', '<h2>Cómo moverse</h2>');
    head.append(iconButton('close', 'Cerrar', onClose, 'Esc', 'ui-close'));
    const cols = el('div', 'ui-help-cols');
    for (const [title, rows] of SHORTCUTS) {
      const col = el('div', 'ui-help-col', `<h3>${title}</h3>`);
      const dl = el('dl');
      for (const [keys, what] of rows) {
        const dt = el('dt');
        for (const k of keys.split(' · ')) dt.append(el('kbd', '', k));
        dl.append(dt, el('dd', '', what));
      }
      col.append(dl);
      cols.append(col);
    }
    card.append(head, cols, el('p', 'ui-help-foot', 'Las posiciones y la orientación de los cuerpos son las reales para la fecha mostrada. La escala comprimida acerca los planetas y los agranda para que quepan en pantalla; la real respeta las distancias.'));
    this.el.append(card);
    this.el.addEventListener('pointerdown', (e) => e.target === this.el && onClose());
  }

  get open(): boolean {
    return !this.el.hidden;
  }

  setOpen(open: boolean): void {
    this.el.hidden = !open;
  }
}
