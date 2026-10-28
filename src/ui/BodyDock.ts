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

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
/** Tamaño de la esfera (px): logarítmico con el radio, del Plutón de 9 px al Sol de 20. */
const orbSize = (radiusKm: number) => 8 + 4.2 * Math.log10(radiusKm / 1000 + 1);

export class BodyDock {
  readonly el: HTMLElement;
  private readonly moons: HTMLElement;
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private readonly cometsToggle: HTMLButtonElement;
  /** Grupo de cometas abierto con su botón (sin tener uno enfocado). */
  private cometsOpen = false;
  private activeId = '';

  constructor(private readonly bodies: HudBody[], onSelect: (id: string) => void) {
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
    }
    this.cometsToggle = el('button', 'ui-body ui-body-comets', '<span class="ui-orb comet"></span><span class="ui-body-name">Cometas</span>');
    this.cometsToggle.type = 'button';
    this.cometsToggle.dataset.tip = 'Cometas';
    this.cometsToggle.setAttribute('aria-label', 'Cometas');
    this.cometsToggle.addEventListener('click', () => {
      this.cometsOpen = !this.cometsOpen;
      this.setActive(this.activeId);
    });
    row.append(this.cometsToggle);
    this.el.append(this.moons, row);
  }

  setActive(id: string): void {
    if (id !== this.activeId) this.cometsOpen = false;
    this.activeId = id;
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
