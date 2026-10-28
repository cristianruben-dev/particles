/**
 * Medidor de rendimiento: fps, tiempo de frame y gráfica de los últimos 120 frames.
 * Abre los ajustes al pulsarlo. Ver docs/ARQUITECTURA.md §11–12.
 */
import type { FrameStats } from '../core/Quality';
import { el, setText } from './dom';

const WIDTH = 92;
const HEIGHT = 24;
/** Escala vertical de la gráfica: 40 ms arriba (25 fps). */
const MAX_MS = 40;

export class PerfMeter {
  readonly el: HTMLButtonElement;
  private readonly fps: HTMLElement;
  private readonly level: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private lastText = 0;
  private lastDraw = 0;

  constructor(onClick: () => void) {
    this.el = el('button', 'ui-perf glass');
    this.el.type = 'button';
    this.el.dataset.tip = 'Rendimiento y ajustes';
    this.el.dataset.tipPos = 'below';
    this.el.setAttribute('aria-label', 'Rendimiento y ajustes');
    this.el.innerHTML = `
      <span class="ui-perf-fps"><b>60</b><small>fps</small></span>
      <canvas class="ui-perf-graph" aria-hidden="true"></canvas>
      <span class="ui-perf-level">Alta</span>`;
    this.fps = this.el.querySelector('b')!;
    this.level = this.el.querySelector('.ui-perf-level')!;
    this.canvas = this.el.querySelector('canvas')!;
    const dpr = Math.min(window.devicePixelRatio, 2);
    this.canvas.width = WIDTH * dpr;
    this.canvas.height = HEIGHT * dpr;
    this.canvas.style.width = `${WIDTH}px`;
    this.canvas.style.height = `${HEIGHT}px`;
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.scale(dpr, dpr);
    this.el.addEventListener('click', onClick);
  }

  update(stats: FrameStats, levelName: string, now: number): void {
    if (now - this.lastText > 250) {
      this.lastText = now;
      setText(this.fps, stats.fps.toFixed(0));
      setText(this.level, levelName);
      this.el.dataset.state = stats.fps >= 50 ? 'good' : stats.fps >= 30 ? 'warn' : 'bad';
    }
    // La gráfica a ~20 Hz: suficiente para ver tirones sin repintar cada frame.
    if (now - this.lastDraw < 50 || this.el.offsetParent === null) return;
    this.lastDraw = now;
    const { ctx } = this;
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    // Referencia de 60 fps.
    const y60 = HEIGHT - (16.7 / MAX_MS) * HEIGHT;
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(0, Math.round(y60), WIDTH, 1);
    const bar = WIDTH / stats.history.length;
    let i = 0;
    for (const ms of stats.ordered()) {
      if (ms > 0) {
        const h = Math.max(1, Math.min(1, ms / MAX_MS) * HEIGHT);
        ctx.fillStyle = ms <= 20 ? 'rgba(170, 235, 200, 0.75)' : ms <= 34 ? 'rgba(255, 210, 122, 0.85)' : 'rgba(255, 128, 110, 0.95)';
        ctx.fillRect(i * bar, HEIGHT - h, Math.max(1, bar - 0.25), h);
      }
      i++;
    }
  }
}
