/**
 * Ajustes: perfil de calidad (§12), datos del equipo y preferencias de la interfaz.
 */
import { QUALITY_LEVELS, QUALITY_PROFILES, type Quality, type QualityChoice } from '../core/Quality';
import { el, iconButton, setText } from './dom';

export interface SettingsToggle {
  id: string;
  label: string;
  key?: string;
  get(): boolean;
  set(on: boolean): void;
}

export interface SettingsLive {
  particles: number;
  pixelRatio: number;
  backend: string;
  fps: number;
  frameMs: number;
}

export class SettingsPanel {
  readonly el: HTMLElement;
  private readonly segments = new Map<QualityChoice, HTMLButtonElement>();
  private readonly summary: HTMLElement;
  private readonly note: HTMLElement;
  private readonly live: Record<'fps' | 'particles' | 'density' | 'backend', HTMLElement>;
  private readonly switches: { toggle: SettingsToggle; input: HTMLInputElement }[] = [];
  private lastLive = 0;

  constructor(private readonly quality: Quality, toggles: SettingsToggle[], onClose: () => void) {
    this.el = el('section', 'ui-settings glass ui-pop');
    this.el.setAttribute('aria-label', 'Ajustes');
    this.el.hidden = true;

    const head = el('header', 'ui-pop-head', '<h2>Ajustes</h2>');
    head.append(iconButton('close', 'Cerrar', onClose, 'Esc', 'ui-close'));
    this.el.append(head);

    // Calidad: Auto + los cuatro perfiles.
    const qualitySection = el('div', 'ui-section', '<h3>Calidad</h3>');
    const seg = el('div', 'ui-segmented ui-segmented-5');
    seg.setAttribute('role', 'radiogroup');
    for (const choice of ['auto', ...QUALITY_LEVELS] as QualityChoice[]) {
      const b = el('button', '', choice === 'auto' ? 'Auto' : QUALITY_PROFILES[choice].name);
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.addEventListener('click', () => {
        quality.set(choice);
        this.refresh();
      });
      seg.append(b);
      this.segments.set(choice, b);
    }
    this.summary = el('p', 'ui-quality-summary');
    this.note = el('p', 'ui-quality-note');
    qualitySection.append(seg, this.summary, this.note);

    const liveSection = el('div', 'ui-section', '<h3>Rendimiento</h3>');
    const grid = el('dl', 'ui-live');
    const cell = (label: string) => {
      const wrap = el('div');
      const value = el('dd');
      wrap.append(el('dt', '', label), value);
      grid.append(wrap);
      return value;
    };
    this.live = { fps: cell('Fotogramas'), particles: cell('Partículas'), density: cell('Densidad de píxeles'), backend: cell('Motor') };
    liveSection.append(grid);

    const prefs = el('div', 'ui-section', '<h3>Interfaz</h3>');
    for (const toggle of toggles) {
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

    this.el.append(qualitySection, liveSection, prefs);
    quality.onChange(() => this.refresh());
  }

  get open(): boolean {
    return !this.el.hidden;
  }

  setOpen(open: boolean): void {
    this.el.hidden = !open;
    if (open) this.refresh();
  }

  refresh(): void {
    const q = this.quality;
    for (const [choice, b] of this.segments) {
      const on = choice === q.choice;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    }
    const p = q.profile;
    this.summary.innerHTML = `<b>${p.name}</b> · ${p.summary}`;
    const recommended = QUALITY_PROFILES[q.device.recommended].name;
    const notes = [`Recomendada para tu equipo: <b>${recommended}</b> <span class="ui-dim">(${escapeHtml(q.device.gpu)})</span>`];
    if (q.choice === 'auto') notes.push('En automático baja sola si los fotogramas no llegan.');
    if (q.pinned) notes.push('Fijada desde la dirección (<code>?quality=</code>).');
    if (q.needsReload) notes.push('El antialias cambia al recargar la página. <button type="button" class="ui-link" data-reload>Recargar</button>');
    this.note.innerHTML = notes.join('<br>');
    this.note.querySelector('[data-reload]')?.addEventListener('click', () => location.reload());
    for (const { toggle, input } of this.switches) input.checked = toggle.get();
  }

  update(live: SettingsLive, now: number): void {
    if (!this.open || now - this.lastLive < 250) return;
    this.lastLive = now;
    setText(this.live.fps, `${live.fps.toFixed(0)} fps · ${live.frameMs.toFixed(1).replace('.', ',')} ms`);
    setText(this.live.particles, live.particles >= 1e6 ? `${(live.particles / 1e6).toLocaleString('es', { maximumFractionDigits: 2 })} M` : live.particles.toLocaleString('es'));
    setText(this.live.density, `${live.pixelRatio.toLocaleString('es', { maximumFractionDigits: 2 })}×`);
    setText(this.live.backend, live.backend);
    for (const { toggle, input } of this.switches) if (input.checked !== toggle.get()) input.checked = toggle.get();
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
