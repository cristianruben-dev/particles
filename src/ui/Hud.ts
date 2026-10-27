/**
 * HUD: cuerpo enfocado, altitud, fecha, velocidad del tiempo y controles. Ver docs/ARQUITECTURA.md §11.
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
}

export interface HudActions {
  bodies: { id: string; name: string }[];
  onSelectBody(id: string): void;
  onSlower(): void;
  onTogglePause(): void;
  onFaster(): void;
  onNow(): void;
}

export class Hud {
  private readonly info: HTMLElement;
  private readonly timeLabel: HTMLElement;
  private readonly pauseButton: HTMLButtonElement;
  private readonly bodyButtons = new Map<string, HTMLButtonElement>();
  private lastText = '';

  constructor(root: HTMLElement, actions: HudActions) {
    root.innerHTML = `
      <nav class="hud-bodies"></nav>
      <div class="hud-panel">
        <div class="hud-info"></div>
        <div class="hud-time">
          <button data-act="slower" title="Más lento (,)">«</button>
          <button data-act="pause" title="Pausa (espacio)">❚❚</button>
          <button data-act="faster" title="Más rápido (.)">»</button>
          <span class="hud-rate"></span>
          <button data-act="now" title="Volver a ahora (N)">ahora</button>
        </div>
        <div class="hud-hint">Arrastra: girar · Rueda: zoom · Clic o 1–3: enfocar</div>
      </div>`;
    this.info = root.querySelector('.hud-info')!;
    this.timeLabel = root.querySelector('.hud-rate')!;
    this.pauseButton = root.querySelector('[data-act="pause"]')!;

    const nav = root.querySelector('.hud-bodies')!;
    actions.bodies.forEach(({ id, name }, i) => {
      const b = document.createElement('button');
      b.textContent = name;
      b.title = `${name} (${i + 1})`;
      b.addEventListener('click', () => actions.onSelectBody(id));
      nav.append(b);
      this.bodyButtons.set(id, b);
    });

    const handlers: Record<string, () => void> = {
      slower: actions.onSlower,
      pause: actions.onTogglePause,
      faster: actions.onFaster,
      now: actions.onNow,
    };
    root.querySelectorAll<HTMLButtonElement>('[data-act]').forEach((b) =>
      b.addEventListener('click', () => handlers[b.dataset.act!]()),
    );
  }

  setActiveBody(id: string): void {
    for (const [bodyId, b] of this.bodyButtons) b.classList.toggle('active', bodyId === id);
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
  }
}

export function formatDistance(km: number): string {
  if (km >= 0.1 * AU_KM) return `${(km / AU_KM).toLocaleString('es', { maximumFractionDigits: 2 })} UA`;
  if (km >= 1e6) return `${(km / 1e6).toLocaleString('es', { maximumFractionDigits: 2 })} millones de km`;
  if (km >= 10) return `${Math.round(km).toLocaleString('es')} km`;
  return `${(km * 1000).toLocaleString('es', { maximumFractionDigits: 0 })} m`;
}
