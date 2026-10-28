/**
 * Utilidades mínimas de DOM para la UI (sin framework).
 */
import { icons, type IconName } from './icons';

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (html) e.innerHTML = html;
  return e;
}

/**
 * Botón de icono con descripción emergente (`data-tip`) y nombre accesible.
 * @param tip Texto de la descripción; `key` se muestra como tecla.
 */
export function iconButton(icon: IconName, tip: string, onClick: () => void, key?: string, className = ''): HTMLButtonElement {
  const b = el('button', `ui-icon ${className}`.trim(), icons[icon]);
  b.type = 'button';
  b.setAttribute('aria-label', tip);
  b.dataset.tip = tip;
  if (key) b.dataset.key = key;
  b.addEventListener('click', onClick);
  return b;
}

/** Cambia el texto solo si es distinto (evita reflujos en cada frame). */
export function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

/** Color del cuerpo realzado para usarlo como acento sobre fondo oscuro. */
export function accentColor(hex: number): string {
  const r = ((hex >> 16) & 255) / 255, g = ((hex >> 8) & 255) / 255, b = (hex & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  h = (h * 60 + 360) % 360;
  // Claro y algo saturado: los cuerpos oscuros (Calisto) también deben leerse.
  return `hsl(${h.toFixed(0)} ${Math.max(35, Math.min(85, s * 100)).toFixed(0)}% ${Math.max(68, Math.min(80, l * 100)).toFixed(0)}%)`;
}
