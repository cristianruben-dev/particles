/**
 * Navegador de cuerpos: el Sol y los planetas en una fila de esferas y, encima, las lunas
 * del sistema enfocado (o los cometas, con su botón al final de la fila). Ver
 * docs/ARQUITECTURA.md §11.
 */
import { el } from './dom';

export interface HudBody {
  id: string;
  name: string;
  /** Planeta al que pertenece (lunas), o null. */
  parent: string | null;
  /** Tecla de acceso directo, si tiene. */
  key?: string;
  color: number;
  radiusKm: number;
  rings?: boolean;
  /** Los cometas van en su propio grupo, encima, como las lunas. */
  comet?: boolean;
}

/** Una galaxia del navegador (§14.5): las grandes en la fila, sus satélites encima. */
export interface HudGalaxy {
  id: string;
  name: string;
  parent: string | null;
  color: number;
  diameterLy: number;
  kind: 'spiral' | 'elliptical' | 'irregular' | 'lenticular';
}

export interface DockActions {
  onSelect(id: string): void;
  onSelectGalaxy(id: string): void;
  /** Desde el cosmos, de vuelta al sistema solar. */
  onSolarSystem(): void;
}

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
/** Tamaño de la esfera (px): logarítmico con el radio, del Plutón de 9 px al Sol de 20. */
const orbSize = (radiusKm: number) => 8 + 4.2 * Math.log10(radiusKm / 1000 + 1);
/** Y de una galaxia: de M32 (~9 px) a Andrómeda (~15). */
const galaxySize = (diameterLy: number) => 8 + 4.5 * Math.log10(diameterLy / 5000 + 1);

export class BodyDock {
  readonly el: HTMLElement;
  private readonly moons: HTMLElement;
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private readonly cometsToggle: HTMLButtonElement;
  /** Grupo de cometas abierto con su botón (sin tener uno enfocado). */
  private cometsOpen = false;
  private activeId = '';
  /** Sistema solar o cosmos: la fila enseña los planetas o las galaxias. */
  private mode: 'solar' | 'cosmos' = 'solar';
  private readonly solarOnly: HTMLElement[] = [];
  private readonly cosmosOnly: HTMLElement[] = [];
  private readonly galaxyButtons = new Map<string, HTMLButtonElement>();

  constructor(private readonly bodies: HudBody[], private readonly galaxies: HudGalaxy[], actions: DockActions) {
    const onSelect = actions.onSelect;
    this.el = el('div', 'ui-dock-wrap');
    this.moons = el('nav', 'ui-moons glass');
    this.moons.setAttribute('aria-label', 'Lunas');
    const row = el('nav', 'ui-dock glass');
    row.setAttribute('aria-label', 'Sol y planetas');

    for (const body of bodies) {
      const moon = body.parent !== null || !!body.comet;
      const b = el('button', moon ? 'ui-body ui-body-moon' : 'ui-body');
      b.type = 'button';
      b.style.setProperty('--c', hex(body.color));
      b.style.setProperty('--s', `${orbSize(body.radiusKm).toFixed(1)}px`);
      b.innerHTML = `<span class="ui-orb${body.rings ? ' rings' : ''}${body.id === 'sun' ? ' star' : ''}${body.comet ? ' comet' : ''}"></span><span class="ui-body-name">${body.name}</span>`;
      b.dataset.tip = body.key ? `${body.name}` : body.name;
      if (body.key) b.dataset.key = body.key;
      b.setAttribute('aria-label', body.name);
      b.addEventListener('click', () => onSelect(body.id));
      (moon ? this.moons : row).append(b);
      this.buttons.set(body.id, b);
      if (!moon) this.solarOnly.push(b);
    }
    this.cometsToggle = el('button', 'ui-body ui-body-comets', '<span class="ui-orb comet"></span><span class="ui-body-name">Cometas</span>');
    this.cometsToggle.type = 'button';
    this.cometsToggle.dataset.tip = 'Cometas';
    this.cometsToggle.setAttribute('aria-label', 'Cometas');
    this.cometsToggle.addEventListener('click', () => {
      this.cometsOpen = !this.cometsOpen;
      this.setActive(this.activeId);
    });
    // Al final de la fila, las galaxias: lleva a la Vía Láctea vista desde fuera.
    const toGalaxies = el('button', 'ui-body ui-body-galaxies', '<span class="ui-orb galaxy spiral"></span><span class="ui-body-name">Galaxias</span>');
    toGalaxies.type = 'button';
    toGalaxies.style.setProperty('--c', '#f2e6cf');
    toGalaxies.style.setProperty('--s', '13px');
    toGalaxies.dataset.tip = 'Galaxias';
    toGalaxies.dataset.key = 'G';
    toGalaxies.setAttribute('aria-label', 'Galaxias');
    toGalaxies.addEventListener('click', () => actions.onSelectGalaxy('milkyway'));
    row.append(this.cometsToggle, toGalaxies);
    this.solarOnly.push(this.cometsToggle, toGalaxies);

    // En el cosmos: el sistema solar para volver y las galaxias, con sus satélites encima.
    const home = el('button', 'ui-body', '<span class="ui-orb star"></span><span class="ui-body-name">Sistema solar</span>');
    home.type = 'button';
    home.style.setProperty('--s', '13px');
    home.dataset.tip = 'Volver al sistema solar';
    home.dataset.key = 'G';
    home.setAttribute('aria-label', 'Volver al sistema solar');
    home.addEventListener('click', actions.onSolarSystem);
    row.append(home);
    this.cosmosOnly.push(home);
    for (const g of galaxies) {
      const b = el('button', g.parent ? 'ui-body ui-body-moon' : 'ui-body');
      b.type = 'button';
      b.style.setProperty('--c', hex(g.color));
      b.style.setProperty('--s', `${galaxySize(g.diameterLy).toFixed(1)}px`);
      b.innerHTML = `<span class="ui-orb galaxy ${g.kind}"></span><span class="ui-body-name">${g.name}</span>`;
      b.dataset.tip = g.name;
      b.setAttribute('aria-label', g.name);
      b.addEventListener('click', () => actions.onSelectGalaxy(g.id));
      (g.parent ? this.moons : row).append(b);
      this.galaxyButtons.set(g.id, b);
      if (g.parent) b.hidden = true;
      else this.cosmosOnly.push(b);
    }
    this.el.append(this.moons, row);
    this.applyMode();
  }

  private applyMode(): void {
    for (const b of this.solarOnly) b.hidden = this.mode !== 'solar';
    for (const b of this.cosmosOnly) b.hidden = this.mode !== 'cosmos';
  }

  /** Galaxia de referencia: la fila pasa a las galaxias y encima van sus satélites. */
  setActiveGalaxy(id: string): void {
    this.mode = 'cosmos';
    this.applyMode();
    this.activeId = `galaxy:${id}`;
    // Las lunas y los cometas comparten la fila de encima: fuera.
    for (const body of this.bodies) if (body.parent || body.comet) this.buttons.get(body.id)!.hidden = true;
    const system = this.galaxies.find((g) => g.id === id)?.parent ?? id;
    let satellites = 0;
    for (const g of this.galaxies) {
      const b = this.galaxyButtons.get(g.id)!;
      b.classList.toggle('active', g.id === id);
      b.setAttribute('aria-current', String(g.id === id));
      if (g.parent) {
        b.hidden = g.parent !== system;
        if (!b.hidden) satellites++;
      } else {
        b.classList.toggle('system', g.id === system && g.id !== id);
      }
    }
    this.moons.classList.toggle('open', satellites > 0);
  }

  setActive(id: string): void {
    if (id !== this.activeId) this.cometsOpen = false;
    this.activeId = id;
    if (this.mode !== 'solar') {
      this.mode = 'solar';
      this.applyMode();
      for (const g of this.galaxies) if (g.parent) this.galaxyButtons.get(g.id)!.hidden = true;
    }
    const focus = this.bodies.find((b) => b.id === id);
    const system = focus?.parent ?? id;
    const comets = this.cometsOpen || !!focus?.comet;
    this.cometsToggle.classList.toggle('active', comets);
    this.cometsToggle.setAttribute('aria-pressed', String(comets));
    let moons = 0;
    for (const body of this.bodies) {
      const b = this.buttons.get(body.id)!;
      b.classList.toggle('active', body.id === id);
      b.setAttribute('aria-current', String(body.id === id));
      if (body.parent || body.comet) {
        const show = comets ? !!body.comet : body.parent === system;
        b.hidden = !show;
        if (show) moons++;
      } else {
        // El planeta del sistema queda marcado aunque esté enfocada una de sus lunas.
        b.classList.toggle('system', body.id === system && body.id !== id);
      }
    }
    this.moons.classList.toggle('open', moons > 0);
  }
}
