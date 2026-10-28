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
import { BODIES, type BodyId } from '../astro/bodies';
import { FACTS } from '../astro/facts';
import { GALAXIES, GALAXY_IDS, type GalaxyId } from '../astro/galaxies';
import { LY_KM } from '../astro/units';
import type { FrameStats, Quality } from '../core/Quality';
import { BodyDock, type HudBody } from './BodyDock';
import { ConstellationPanel, type ConstellationSource } from './ConstellationPanel';
import { EventsPanel, type EventsSource } from './EventsPanel';
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
  onSelectGalaxy(id: GalaxyId): void;
  /** Desde el cosmos, de vuelta al sistema solar. */
  onSolarSystem(): void;
  /** Eclipses, tránsitos y cometas para el calendario. */
  events: Omit<EventsSource, 'onClose'>;
  /** Constelaciones: interruptores, lista y ficha. */
  sky: Omit<ConstellationSource, 'onClose'>;
  quality: Quality;
  /** Preferencias del panel de ajustes. */
  toggles: SettingsToggle[];
  onSelectBody(id: string): void;
  onSetScale(mode: 'compressed' | 'real'): void;
  onToggleOrbits(): void;
  onToggleLabels(): void;
  onToggleFly(): void;
  onToggleSound(): void;
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
  tools: Omit<ToolState, 'sky'>;
  travel: { name: string; progress: number; distanceKm: number } | null;
  stats: FrameStats;
  particles: number;
  pixelRatio: number;
  backend: string;
  /** Fuera del sistema solar (§14.5): la galaxia de referencia y la distancia de la cámara a su centro. */
  cosmic: { id: GalaxyId; distanceKm: number; sunKm: number } | null;
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
  private readonly events: EventsPanel;
  readonly sky: ConstellationPanel;
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
    const galaxies = GALAXY_IDS.map((id) => {
      const g = GALAXIES[id];
      return { id, name: g.short ?? g.name, parent: g.parent ?? null, color: g.color, diameterLy: g.diameterLy, kind: g.shape.kind };
    });
    this.dock = new BodyDock(actions.bodies, galaxies, {
      onSelect: (id) => actions.onSelectBody(id),
      onSelectGalaxy: (id) => actions.onSelectGalaxy(id as GalaxyId),
      onSolarSystem: actions.onSolarSystem,
    });
    this.tools = new Toolbar({
      onSetScale: actions.onSetScale,
      onToggleOrbits: actions.onToggleOrbits,
      onToggleLabels: actions.onToggleLabels,
      onConstellations: () => this.toggleSky(),
      onToggleFly: actions.onToggleFly,
      onToggleSound: actions.onToggleSound,
      onEvents: () => this.toggleEvents(),
      onHelp: () => this.toggleHelp(),
      onSettings: () => this.toggleSettings(),
      onHideUi: () => this.toggleHidden(),
    });
    this.info = new InfoPanel({ onClose: () => this.info.setOpen(false), onLand: actions.onLand });
    this.events = new EventsPanel({ ...actions.events, onClose: () => this.events.setOpen(false) });
    this.sky = new ConstellationPanel({ ...actions.sky, onClose: () => this.sky.setOpen(false) });
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
      region('ui-right', this.info.el, this.events.el, this.sky.el),
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
      else if (this.events.open) this.events.setOpen(false);
      else if (this.sky.open) this.sky.setOpen(false);
      else if (this.info.open) this.info.setOpen(false);
      else if (this.hidden) this.toggleHidden();
      else return false;
      return true;
    }
    if (e.key === '?') this.toggleHelp();
    else if (key === 'u') this.toggleHidden();
    else if (key === 'i') this.toggleInfo();
    else if (key === 'c') this.toggleEvents();
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
    this.root.classList.remove('cosmic');
  }

  /** Galaxia de referencia (§14.5): la barra pasa a las galaxias, el acento a su color y la ficha a sus datos. */
  private setActiveGalaxy(id: GalaxyId): void {
    this.activeId = `galaxy:${id}`;
    this.dock.setActiveGalaxy(id);
    const g = GALAXIES[id];
    this.root.style.setProperty('--body', accentColor(g.color));
    this.info.showGalaxy(g, GALAXY_IDS.filter((s) => GALAXIES[s].parent === id).map((s) => GALAXIES[s].name));
    this.root.classList.add('cosmic');
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

    if (s.cosmic) {
      if (`galaxy:${s.cosmic.id}` !== this.activeId) this.setActiveGalaxy(s.cosmic.id);
      this.renderGalaxy(s, s.cosmic);
      return;
    }
    if (s.focusId !== this.activeId) this.setActiveBody(s.focusId, s.landable);
    const site = FACTS[s.focusId].site;
    // En un cometa el radio es el de referencia de la coma: cuenta la distancia al núcleo.
    const comet = BODIES[s.focusId].kind === 'comet';
    this.title.update({
      id: s.focusId,
      name: s.focusName,
      kicker: bodyKicker(s.focusId),
      altitudeKm: comet ? s.altitudeKm + BODIES[s.focusId].radiusKm : s.altitudeKm,
      altitudeLabel: comet ? 'Al núcleo' : 'Altitud',
      sunDistanceKm: s.focusId === 'sun' ? 695_700 : s.sunDistanceKm,
      speedKmS: s.speedKmS,
      landable: s.landable,
      nearGround: s.nearGround,
      descending: s.descending,
      siteName: site?.name ?? null,
    });
    this.time.update(s.time);
    this.tools.update({ ...s.tools, sky: this.sky.open });
    this.info.landDisabled = s.descending;
    this.info.update(s, now);
    this.events.update(s.time.date.getTime());
    this.sky.update(s.time.date.getTime(), now);
    this.settings.update({ particles: s.particles, pixelRatio: s.pixelRatio, backend: s.backend, fps: s.stats.fps, frameMs: s.stats.frameMs }, now);
  }

  /** El título y la ficha de una galaxia: distancia de la cámara a su centro y a qué distancia está de aquí. */
  private renderGalaxy(s: HudState, cosmic: NonNullable<HudState['cosmic']>): void {
    const g = GALAXIES[cosmic.id];
    this.title.update({
      id: `galaxy:${g.id}`,
      name: g.name,
      kicker: `${g.type} · ${g.group}`,
      altitudeKm: cosmic.distanceKm,
      altitudeLabel: g.id === 'milkyway' ? 'Del centro' : 'Distancia',
      sunDistanceKm: 0,
      second: g.id === 'milkyway' ? { label: 'Del Sol', km: cosmic.sunKm } : { label: 'De la Tierra', km: g.distanceLy * LY_KM },
      speedKmS: null,
      landable: false,
      nearGround: false,
      descending: false,
      siteName: null,
    });
    this.tools.update({ ...s.tools, sky: this.sky.open });
    this.info.update({ ...s, cameraDistanceKm: cosmic.distanceKm }, performance.now());
    this.events.update(s.time.date.getTime());
    this.settings.update({ particles: s.particles, pixelRatio: s.pixelRatio, backend: s.backend, fps: s.stats.fps, frameMs: s.stats.frameMs }, performance.now());
  }

  /**
   * La ficha, los eventos, las constelaciones y los ajustes comparten el lado derecho: abrir
   * uno cierra los otros.
   */
  private toggleInfo(): void {
    this.info.setOpen(!this.info.open);
    if (this.info.open) {
      this.settings.setOpen(false);
      this.events.setOpen(false);
      this.sky.setOpen(false);
    }
  }

  private toggleSettings(): void {
    this.settings.setOpen(!this.settings.open);
    if (this.settings.open) {
      this.info.setOpen(false);
      this.events.setOpen(false);
      this.sky.setOpen(false);
    }
  }

  private toggleEvents(): void {
    this.events.setOpen(!this.events.open);
    if (this.events.open) {
      this.info.setOpen(false);
      this.settings.setOpen(false);
      this.sky.setOpen(false);
    }
  }

  private toggleSky(): void {
    this.sky.setOpen(!this.sky.open);
    if (this.sky.open) this.closeOthers();
  }

  /** Ficha de una constelación (clic en el cielo o en su nombre). */
  showConstellation(index: number, timeMs: number): void {
    this.sky.show(index, timeMs);
    this.closeOthers();
  }

  private closeOthers(): void {
    this.info.setOpen(false);
    this.events.setOpen(false);
    this.settings.setOpen(false);
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
