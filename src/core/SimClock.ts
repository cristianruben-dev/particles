/**
 * Tiempo simulado con multiplicador. Ver docs/ARQUITECTURA.md §3.
 * El tiempo se guarda en float64 (ms Unix); nunca se pasa absoluto a la GPU.
 */

/** Velocidades disponibles (segundos simulados por segundo real). */
export const TIME_RATES: readonly { rate: number; label: string }[] = [
  { rate: 1, label: 'tiempo real' },
  { rate: 60, label: '1 min/s' },
  { rate: 600, label: '10 min/s' },
  { rate: 3600, label: '1 h/s' },
  { rate: 6 * 3600, label: '6 h/s' },
  { rate: 86_400, label: '1 día/s' },
  { rate: 7 * 86_400, label: '1 semana/s' },
  { rate: 30 * 86_400, label: '1 mes/s' },
  { rate: 365.25 * 86_400, label: '1 año/s' },
];

export class SimClock {
  /** Fecha simulada actual (ms Unix). */
  timeMs: number;
  rateIndex = 2;
  paused = false;

  constructor(startMs = Date.now()) {
    this.timeMs = startMs;
  }

  get rate(): number {
    return TIME_RATES[this.rateIndex].rate;
  }

  get rateLabel(): string {
    return TIME_RATES[this.rateIndex].label;
  }

  faster(): void {
    this.rateIndex = Math.min(TIME_RATES.length - 1, this.rateIndex + 1);
  }

  slower(): void {
    this.rateIndex = Math.max(0, this.rateIndex - 1);
  }

  tick(dtRealSeconds: number): void {
    if (this.paused) return;
    this.timeMs += dtRealSeconds * this.rate * 1000;
  }

  get date(): Date {
    return new Date(this.timeMs);
  }
}
