/**
 * Herramientas: escala, órbitas, nombres, modo de vuelo, ayuda, pantalla completa y
 * ocultar la interfaz.
 */
import { el, iconButton } from './dom';

export interface ToolActions {
  onSetScale(mode: 'compressed' | 'real'): void;
  onToggleOrbits(): void;
  onToggleLabels(): void;
  onToggleFly(): void;
  onEvents(): void;
  onHelp(): void;
  onSettings(): void;
  onHideUi(): void;
}

export interface ToolState {
  scale: 'compressed' | 'real';
  orbits: boolean;
  labels: boolean;
  flying: boolean;
}

export class Toolbar {
  readonly el: HTMLElement;
  private readonly compressed: HTMLButtonElement;
  private readonly real: HTMLButtonElement;
  private readonly orbits: HTMLButtonElement;
  private readonly labels: HTMLButtonElement;
  private readonly fly: HTMLButtonElement;
  private last = '';

  constructor(actions: ToolActions) {
    this.el = el('section', 'ui-tools glass');
    this.el.setAttribute('aria-label', 'Herramientas');

    const scale = el('div', 'ui-segmented ui-scale');
    scale.dataset.tip = 'Escala del sistema';
    scale.dataset.key = 'E';
    const option = (mode: 'compressed' | 'real', label: string) => {
      const b = el('button', '', label);
      b.type = 'button';
      b.addEventListener('click', () => actions.onSetScale(mode));
      scale.append(b);
      return b;
    };
    this.compressed = option('compressed', 'Comprimida');
    this.real = option('real', 'Real');

    this.orbits = iconButton('orbits', 'Órbitas', actions.onToggleOrbits, 'O');
    this.labels = iconButton('labels', 'Nombres', actions.onToggleLabels, 'L');
    this.fly = iconButton('fly', 'Vuelo libre', actions.onToggleFly, 'V', 'ui-fly-toggle');
    const fullscreen = iconButton('fullscreen', 'Pantalla completa', () => {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen?.().catch(() => undefined);
    });
    if (!document.documentElement.requestFullscreen) fullscreen.hidden = true;

    this.el.append(
      scale,
      el('span', 'ui-sep'),
      this.orbits,
      this.labels,
      el('span', 'ui-sep'),
      this.fly,
      el('span', 'ui-sep'),
      iconButton('eclipse', 'Eclipses y eventos', actions.onEvents, 'C'),
      iconButton('settings', 'Ajustes', actions.onSettings),
      iconButton('help', 'Ayuda y controles', actions.onHelp, '?'),
      iconButton('eye', 'Ocultar la interfaz', actions.onHideUi, 'U'),
      fullscreen,
    );
  }

  update(s: ToolState): void {
    const key = `${s.scale}${s.orbits}${s.labels}${s.flying}`;
    if (key === this.last) return;
    this.last = key;
    this.compressed.classList.toggle('on', s.scale === 'compressed');
    this.real.classList.toggle('on', s.scale === 'real');
    this.orbits.classList.toggle('on', s.orbits);
    this.labels.classList.toggle('on', s.labels);
    this.fly.classList.toggle('on', s.flying);
    this.fly.dataset.tip = s.flying ? 'Volver a la órbita' : 'Vuelo libre';
  }
}
