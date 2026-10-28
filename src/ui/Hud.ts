/**
 * Interfaz: compone y coloca los componentes, y reparte el estado de cada frame.
 * Ver docs/ARQUITECTURA.md §11.
 *
 * - Arriba a la izquierda, el cuerpo de referencia; arriba a la derecha, el rendimiento y los
 *   ajustes; abajo, el tiempo, el navegador de cuerpos y las herramientas; a la derecha, la ficha.
 * - Las cifras se repintan a ~20 Hz y solo si cambian (`setText`).
 * - Tras un clic con el ratón el botón suelta el foco: así Espacio sigue pausando y no
 *   repite el clic. Con el teclado (Tab) el foco se queda y se ve.
 */
import type { BodyId } from '../astro/bodies';
import { FACTS } from '../astro/facts';
import type { FrameStats, Quality } from '../core/Quality';
import { BodyDock, type HudBody } from './BodyDock';
import { accentColor, el } from './dom';
import { FocusTitle, type TitleActions } from './FocusTitle';
import { InfoPanel, bodyKicker, type InfoLive } from './InfoPanel';
import { Coach, HelpOverlay, Toasts, TravelCard } from './Overlays';
import { PerfMeter } from './PerfMeter';
import { SettingsPanel, type SettingsToggle } from './SettingsPanel';
import { TimeBar, type TimeActions, type TimeState } from './TimeBar';
import { Toolbar, type ToolState } from './Toolbar';

export type { HudBody } from './BodyDock';

export interface HudActions extends TimeActions, TitleActions {
  bodies: HudBody[];
  quality: Quality;
  /** Preferencias del panel de ajustes. */
  toggles: SettingsToggle[];
  onSelectBody(id: string): void;
  onSetScale(mode: 'compressed' | 'real'): void;
  onToggleOrbits(): void;
  onToggleLabels(): void;
  onToggleFly(): void;
}

export interface HudState extends InfoLive {
  focusId: BodyId;
  focusName: string;
  altitudeKm: number;
  /** Velocidad en vuelo libre (km/s), o null en órbita. */
  speedKmS: number | null;
  landable: boolean;
  nearGround: boolean;
  descending: boolean;
  time: TimeState;
  tools: ToolState;
  travel: { name: string; progress: number; distanceKm: number } | null;
  stats: FrameStats;
  particles: number;
  pixelRatio: number;
  backend: string;
}

export class Hud {
  readonly toasts = new Toasts();
  readonly coach = new Coach();
  private readonly layer: HTMLElement;
  private readonly title: FocusTitle;
  private readonly dock: BodyDock;
  private readonly time: TimeBar;
  private readonly tools: Toolbar;
  private readonly perf: PerfMeter;
  private readonly settings: SettingsPanel;
  private readonly info: InfoPanel;
  private readonly help: HelpOverlay;
  private readonly travel = new TravelCard();
  private readonly fly: HTMLElement;
  private activeId = '';
  private lastRender = 0;
  private hidden = false;
  private flying = false;

  constructor(private readonly root: HTMLElement, private readonly actions: HudActions) {
    this.layer = el('div', 'ui-layer');

    this.title = new FocusTitle({
      onLand: actions.onLand,
      onAscend: actions.onAscend,
      onInfo: () => this.toggleInfo(),
    });
    this.perf = new PerfMeter(() => this.toggleSettings());
    this.settings = new SettingsPanel(actions.quality, actions.toggles, () => this.settings.setOpen(false));
    this.time = new TimeBar(actions);
    this.dock = new BodyDock(actions.bodies, (id) => actions.onSelectBody(id));
    this.tools = new Toolbar({
      onSetScale: actions.onSetScale,
      onToggleOrbits: actions.onToggleOrbits,
      onToggleLabels: actions.onToggleLabels,
      onToggleFly: actions.onToggleFly,
      onHelp: () => this.toggleHelp(),
      onSettings: () => this.toggleSettings(),
      onHideUi: () => this.toggleHidden(),
    });
    this.info = new InfoPanel({ onClose: () => this.info.setOpen(false), onLand: actions.onLand });
    this.help = new HelpOverlay(() => this.help.setOpen(false));

    this.fly = el('div', 'ui-fly');
    this.fly.innerHTML = `
      <div class="ui-reticle" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
      <div class="ui-fly-hint glass">
        <span class="ui-fly-badge">Vuelo libre</span>
        <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> moverse</span>
        <span><kbd>R</kbd><kbd>F</kbd> subir · bajar</span>
        <span><kbd>Q</kbd><kbd>E</kbd> girar</span>
        <span><kbd>Mayús</kbd> turbo</span>
        <span><kbd>Esc</kbd> salir</span>
      </div>`;

    const region = (cls: string, ...children: HTMLElement[]) => {
      const r = el('div', `ui-region ${cls}`);
      r.append(...children);
      return r;
    };
    this.layer.append(
      region('ui-tl', this.title.el),
      region('ui-tr', this.perf.el, this.settings.el),
      region('ui-bottom', this.time.el, region('ui-bc', this.coach.el, this.dock.el), this.tools.el),
      region('ui-right', this.info.el),
      this.travel.el,
      this.fly,
      this.toasts.el,
      this.help.el,
    );
    root.append(this.layer);

    // Tras un clic con el ratón, fuera el foco (e.detail = 0 cuando lo pulsa el teclado).
    root.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (b && e.detail > 0) setTimeout(() => b.blur());
    });
    // Clic fuera de los ajustes: se cierran.
    document.addEventListener('pointerdown', (e) => {
      const t = e.target as Node;
      if (this.settings.open && !this.settings.el.contains(t) && !this.perf.el.contains(t) && !this.tools.el.contains(t)) this.settings.setOpen(false);
    });
  }

  /** Entrada de la interfaz al irse la pantalla de carga. */
  reveal(): void {
    this.title.replay();
    this.coach.start(3);
  }

  /** Atajos propios de la interfaz. Devuelve true si la tecla era suya. */
  handleKey(e: KeyboardEvent): boolean {
    const key = e.key.toLowerCase();
    if (e.key === 'Escape') {
      if (this.help.open) this.help.setOpen(false);
      else if (this.settings.open) this.settings.setOpen(false);
      else if (this.info.open) this.info.setOpen(false);
      else if (this.hidden) this.toggleHidden();
      else return false;
      return true;
    }
    if (e.key === '?') this.toggleHelp();
    else if (key === 'u') this.toggleHidden();
    else if (key === 'i') this.toggleInfo();
    else return false;
    return true;
  }

  get uiHidden(): boolean {
    return this.hidden;
  }

  setActiveBody(id: BodyId, landable: boolean): void {
    this.activeId = id;
    this.dock.setActive(id);
    const body = this.actions.bodies.find((b) => b.id === id);
    if (body) this.root.style.setProperty('--body', accentColor(body.color));
    this.info.show(id, landable);
  }

  render(s: HudState, now: number): void {
    this.travel.update(s.travel);
    if (s.tools.flying !== this.flying) {
      this.flying = s.tools.flying;
      this.root.classList.toggle('flying', this.flying);
    }
    this.perf.update(s.stats, this.actions.quality.profile.name, now);
    if (now - this.lastRender < 50) return;
    this.lastRender = now;

    if (s.focusId !== this.activeId) this.setActiveBody(s.focusId, s.landable);
    const site = FACTS[s.focusId].site;
    this.title.update({
      id: s.focusId,
      name: s.focusName,
      kicker: bodyKicker(s.focusId),
      altitudeKm: s.altitudeKm,
      sunDistanceKm: s.focusId === 'sun' ? 695_700 : s.sunDistanceKm,
      speedKmS: s.speedKmS,
      landable: s.landable,
      nearGround: s.nearGround,
      descending: s.descending,
      siteName: site?.name ?? null,
    });
    this.time.update(s.time);
    this.tools.update(s.tools);
    this.info.landDisabled = s.descending;
    this.info.update(s, now);
    this.settings.update({ particles: s.particles, pixelRatio: s.pixelRatio, backend: s.backend, fps: s.stats.fps, frameMs: s.stats.frameMs }, now);
  }

  /** La ficha y los ajustes comparten el lado derecho: abrir uno cierra el otro. */
  private toggleInfo(): void {
    this.info.setOpen(!this.info.open);
    if (this.info.open) this.settings.setOpen(false);
  }

  private toggleSettings(): void {
    this.settings.setOpen(!this.settings.open);
    if (this.settings.open) this.info.setOpen(false);
  }

  private toggleHelp(): void {
    this.help.setOpen(!this.help.open);
    this.coach.dismiss();
  }

  private toggleHidden(): void {
    this.hidden = !this.hidden;
    this.root.classList.toggle('ui-hidden', this.hidden);
    if (this.hidden) this.toasts.show('Interfaz oculta · pulsa U o Esc para volver', 'eye', 2.6);
  }
}
