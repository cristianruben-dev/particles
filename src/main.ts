import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import '@fontsource/instrument-serif/latin.css';
import '@fontsource/instrument-serif/latin-ext.css';
import './style.css';
import { nameInText } from './astro/facts';
import { BaseBody } from './bodies/BaseBody';
import { config } from './config';
import { Engine } from './core/Engine';

/** API de la pantalla de carga (script en línea de index.html). */
interface LoaderApi {
  set(p: number, text?: string): void;
  finish(): Promise<void>;
  error(text: string): void;
}
const loader = (window as unknown as { __loader?: LoaderApi }).__loader;
const MIN_LOADER_MS = 2600;
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
const hud = document.querySelector<HTMLElement>('#hud')!;

// La fuente del título de la pantalla de carga llega con este código.
void document.fonts?.load('400 48px "Instrument Serif"').finally(() => document.querySelector('#loader')?.classList.add('fonts'));

// Los cuerpos se hornean detrás de la pantalla de carga, pero se condensan a la vista.
document.documentElement.classList.add('booting');
BaseBody.formationHeld = true;
loader?.set(0.04, 'Buscando la GPU…');

const engine = new Engine();
// Acceso desde la consola para depurar (solo con ?debug).
if (config.debug) Object.assign(window, { engine });
try {
  await engine.start(canvas, hud, (p, text) => loader?.set(p, text));
} catch (error) {
  loader?.error('Este navegador no puede dibujar la escena: hace falta WebGPU o WebGL2. Prueba con una versión reciente de Chrome, Edge, Safari o Firefox.');
  throw error;
}

let formed = 0;
await Promise.all(engine.bodies.map((b) => b.ready.then(() => loader?.set(0.16 + 0.74 * (++formed / engine.bodies.length), `Formando ${nameInText(b.data.id, b.data.name)}…`))));
loader?.set(0.93, 'Encendiendo las estrellas…');
await engine.starsReady;
// Unos frames para compilar los shaders antes de levantar el telón, y un mínimo de tiempo
// para que el polvo llegue a agruparse aunque todo cargue al instante.
for (let i = 0; i < 3; i++) await nextFrame();
await new Promise((resolve) => setTimeout(resolve, Math.max(0, MIN_LOADER_MS - performance.now())));
await loader?.finish();
BaseBody.formationHeld = false;
document.documentElement.classList.remove('booting');
engine.revealed();
