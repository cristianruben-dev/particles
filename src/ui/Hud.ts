/**
 * HUD: cuerpos (planetas y lunas del sistema enfocado), datos de vuelo, tiempo, fecha y
 * escala. Ver docs/ARQUITECTURA.md §11.
 */
import { AU_KM } from '../astro/units';

export interface HudState {
  focusName: string;
  altitudeKm: number;
  date: Date;
  timeLabel: string;
  paused: boolean;
  fps: number;
  backend: 'WebGPU' | 'WebGL2';
  particles: number;
  scale: 'compressed' | 'real';
  orbits: boolean;
  labels: boolean;
}

export interface HudBody {
  id: string;
  name: string;
  /** Planeta al que pertenece (lunas), o null. */
  parent: string | null;
  /** Tecla de acceso directo, si tiene. */
  key?: string;
}

export interface HudActions {
  bodies: HudBody[];
  onSelectBody(id: string): void;
  onSlower(): void;
  onTogglePause(): void;
  onFaster(): void;
  onNow(): void;
  onSetDate(ms: number): void;
  onToggleScale(): void;
  onToggleOrbits(): void;
  onToggleLabels(): void;
}

export class Hud {
  private readonly info: HTMLElement;
  private readonly timeLabel: HTMLElement;
  private readonly pauseButton: HTMLButtonElement;
  private readonly scaleButton: HTMLButtonElement;
  private readonly orbitsButton: HTMLButtonElement;
  private readonly labelsButton: HTMLButtonElement;
  private readonly dateInput: HTMLInputElement;
  private readonly moonsNav: HTMLElement;
  private readonly bodyButtons = new Map<string, HTMLButtonElement>();
  private lastText = '';

  constructor(root: HTMLElement, private readonly actions: HudActions) {
    root.innerHTML = `
      <div class="hud-top">
        <nav class="hud-bodies"></nav>
        <nav class="hud-moons"></nav>
      </div>
      <div class="hud-panel">
        <div class="hud-info"></div>
        <div class="hud-row">
          <button data-act="slower" title="Más lento (,)">«</button>
          <button data-act="pause" title="Pausa (espacio)">❚❚</button>
          <button data-act="faster" title="Más rápido (.)">»</button>
          <span class="hud-rate"></span>
          <button data-act="now" title="Volver a ahora (N)">ahora</button>
          <input class="hud-date" type="datetime-local" step="60" title="Ir a una fecha (UTC)" />
        </div>
        <div class="hud-row">
          <button data-act="scale" title="Escala comprimida o real (E)"></button>
          <button data-act="orbits" title="Órbitas (O)">órbitas</button>
          <button data-act="labels" title="Nombres (L)">nombres</button>
        </div>
        <div class="hud-hint">Arrastra: girar · Rueda: zoom · Clic: viajar · 0–9: Sol y planetas</div>
      </div>`;
    this.info = root.querySelector('.hud-info')!;
    this.timeLabel = root.querySelector('.hud-rate')!;
    this.pauseButton = root.querySelector('[data-act="pause"]')!;
    this.scaleButton = root.querySelector('[data-act="scale"]')!;
    this.orbitsButton = root.querySelector('[data-act="orbits"]')!;
    this.labelsButton = root.querySelector('[data-act="labels"]')!;
    this.dateInput = root.querySelector('.hud-date')!;
    this.moonsNav = root.querySelector('.hud-moons')!;

    const nav = root.querySelector('.hud-bodies')!;
    for (const body of actions.bodies) {
      const b = document.createElement('button');
      b.textContent = body.name;
      b.title = body.key ? `${body.name} (${body.key})` : body.name;
      b.addEventListener('click', () => actions.onSelectBody(body.id));
      (body.parent ? this.moonsNav : nav).append(b);
      this.bodyButtons.set(body.id, b);
    }

    const handlers: Record<string, () => void> = {
      slower: actions.onSlower,
      pause: actions.onTogglePause,
      faster: actions.onFaster,
      now: actions.onNow,
      scale: actions.onToggleScale,
      orbits: actions.onToggleOrbits,
      labels: actions.onToggleLabels,
    };
    root.querySelectorAll<HTMLButtonElement>('[data-act]').forEach((b) =>
      b.addEventListener('click', () => handlers[b.dataset.act!]()),
    );
    // La fecha del campo se interpreta en UTC, como la del HUD.
    this.dateInput.addEventListener('change', () => {
      const ms = Date.parse(`${this.dateInput.value}:00Z`);
      if (!Number.isNaN(ms)) actions.onSetDate(ms);
    });
  }

  setActiveBody(id: string): void {
    for (const [bodyId, b] of this.bodyButtons) b.classList.toggle('active', bodyId === id);
    // Lunas visibles: las del planeta enfocado (o las hermanas de la luna enfocada).
    const focus = this.actions.bodies.find((b) => b.id === id);
    const system = focus?.parent ?? id;
    for (const body of this.actions.bodies) {
      if (body.parent) this.bodyButtons.get(body.id)!.hidden = body.parent !== system;
    }
    // El planeta del sistema queda marcado aunque esté enfocada una de sus lunas.
    for (const body of this.actions.bodies) {
      if (!body.parent) this.bodyButtons.get(body.id)!.classList.toggle('system', body.id === system && body.id !== id);
    }
  }

  render(s: HudState): void {
    const text = [
      `<strong>${s.focusName}</strong> · altitud ${formatDistance(s.altitudeKm)}`,
      `${s.date.toISOString().replace('T', ' ').slice(0, 19)} UTC`,
      `${s.fps.toFixed(0)} fps · ${s.backend} · ${s.particles.toLocaleString('es')} partículas`,
    ].join('<br>');
    // Solo tocar el DOM cuando cambia algo.
    if (text !== this.lastText) {
      this.info.innerHTML = text;
      this.lastText = text;
    }
    this.timeLabel.textContent = s.paused ? 'en pausa' : s.timeLabel;
    this.pauseButton.textContent = s.paused ? '▶' : '❚❚';
    this.scaleButton.textContent = s.scale === 'real' ? 'escala real' : 'escala comprimida';
    this.orbitsButton.classList.toggle('on', s.orbits);
    this.labelsButton.classList.toggle('on', s.labels);
    if (document.activeElement !== this.dateInput) {
      const value = s.date.toISOString().slice(0, 16);
      if (this.dateInput.value !== value) this.dateInput.value = value;
    }
  }
}

export function formatDistance(km: number): string {
  if (km >= 0.1 * AU_KM) return `${(km / AU_KM).toLocaleString('es', { maximumFractionDigits: 2 })} UA`;
  if (km >= 1e6) return `${(km / 1e6).toLocaleString('es', { maximumFractionDigits: 2 })} millones de km`;
  if (km >= 10) return `${Math.round(km).toLocaleString('es')} km`;
  return `${(km * 1000).toLocaleString('es', { maximumFractionDigits: 0 })} m`;
}
