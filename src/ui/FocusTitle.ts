/**
 * Título del cuerpo de referencia (arriba a la izquierda): tipo, nombre, altitud, distancia
 * al Sol y las acciones principales (aterrizar o despegar, ficha).
 */
import { el, setText } from './dom';
import { distanceParts, speedParts, type Quantity } from './format';
import { icons } from './icons';

export interface TitleState {
  id: string;
  name: string;
  kicker: string;
  altitudeKm: number;
  /** Rótulo de la altitud («Altitud»; en los cometas, «Al núcleo»). */
  altitudeLabel: string;
  sunDistanceKm: number;
  /** Segunda cifra con otro rótulo (las galaxias: «De la Tierra»). */
  second?: { label: string; km: number };
  /** Velocidad en vuelo libre (km/s), o null en órbita. */
  speedKmS: number | null;
  landable: boolean;
  /** Cerca del suelo: la acción pasa a ser despegar. */
  nearGround: boolean;
  /** Bajando o subiendo con el botón. */
  descending: boolean;
  siteName: string | null;
}

export interface TitleActions {
  onLand(): void;
  onAscend(): void;
  onInfo(): void;
}

export class FocusTitle {
  readonly el: HTMLElement;
  private readonly kicker: HTMLElement;
  private readonly name: HTMLElement;
  private readonly altitude: [HTMLElement, HTMLElement, HTMLElement];
  private readonly second: [HTMLElement, HTMLElement, HTMLElement];
  private readonly land: HTMLButtonElement;
  private id = '';
  private landMode = '';
  private landKey = '';

  constructor(actions: TitleActions) {
    this.el = el('header', 'ui-title');
    this.kicker = el('p', 'ui-kicker');
    this.name = el('h1', 'ui-name');
    const readouts = el('div', 'ui-readouts');
    const readout = (label: string): [HTMLElement, HTMLElement, HTMLElement] => {
      const r = el('div', 'ui-readout');
      const l = el('span', 'ui-readout-label', label);
      const v = el('b');
      const u = el('small');
      const value = el('span', 'ui-readout-value');
      value.append(v, u);
      r.append(l, value);
      readouts.append(r);
      return [l, v, u];
    };
    this.altitude = readout('Altitud');
    this.second = readout('Del Sol');

    const actionsRow = el('div', 'ui-title-actions');
    this.land = el('button', 'ui-action ui-action-primary');
    this.land.type = 'button';
    this.land.addEventListener('click', () => (this.landMode === 'ascend' ? actions.onAscend() : actions.onLand()));
    const info = el('button', 'ui-action', `${icons.info}<span>Ficha</span>`);
    info.type = 'button';
    info.dataset.tip = 'Datos del cuerpo';
    info.dataset.key = 'I';
    info.addEventListener('click', actions.onInfo);
    actionsRow.append(this.land, info);
    this.el.append(this.kicker, this.name, readouts, actionsRow);
  }

  /** Entrada animada del nombre. */
  replay(): void {
    this.el.classList.remove('enter');
    void this.el.offsetWidth;
    this.el.classList.add('enter');
  }

  update(s: TitleState): void {
    if (s.id !== this.id) {
      this.id = s.id;
      setText(this.kicker, s.kicker);
      setText(this.name, s.name);
      this.replay();
    }
    setText(this.altitude[0], s.altitudeLabel);
    setQuantity(this.altitude, distanceParts(s.altitudeKm));
    if (s.speedKmS !== null) {
      setText(this.second[0], 'Velocidad');
      setQuantity(this.second, speedParts(s.speedKmS));
    } else if (s.second) {
      setText(this.second[0], s.second.label);
      setQuantity(this.second, distanceParts(s.second.km));
    } else {
      setText(this.second[0], s.id === 'sun' ? 'Radio' : 'Del Sol');
      setQuantity(this.second, distanceParts(s.sunDistanceKm));
    }

    const mode = !s.landable || s.speedKmS !== null ? 'none' : s.nearGround ? 'ascend' : 'land';
    const key = `${mode}|${s.descending}|${s.siteName}`;
    if (key !== this.landKey) {
      this.landMode = mode;
      this.landKey = key;
      this.land.hidden = mode === 'none';
      this.land.disabled = s.descending;
      this.land.innerHTML = mode === 'ascend'
        ? `${icons.ascend}<span>Volver a la órbita</span>`
        : `${icons.land}<span>${s.descending ? 'Descendiendo…' : 'Aterrizar'}</span>`;
      this.land.dataset.tip = mode === 'ascend' ? 'Subir a la órbita' : s.siteName ? `Aterrizar en ${s.siteName}` : 'Bajar a la superficie';
      this.land.dataset.key = 'T';
    }
  }
}

function setQuantity(target: [HTMLElement, HTMLElement, HTMLElement], q: Quantity): void {
  setText(target[1], q.value);
  setText(target[2], q.unit);
}
