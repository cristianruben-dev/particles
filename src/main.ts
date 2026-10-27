import './style.css';
import { config } from './config';
import { Engine } from './core/Engine';

const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
const hud = document.querySelector<HTMLElement>('#hud')!;

const engine = new Engine();
await engine.start(canvas, hud);

// Acceso desde la consola para depurar (solo con ?debug).
if (config.debug) Object.assign(window, { engine });
