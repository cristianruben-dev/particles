/**
 * Sonido ambiente procedural con Web Audio: sin archivos ni licencias. Ver docs/ARQUITECTURA.md §13.
 *
 * - En el vacío, silencio.
 * - Cerca de un gigante gaseoso, un zumbido grave: osciladores algo desafinados por un paso
 *   bajo que respira, más un retumbo de ruido marrón. Sube con el tamaño aparente del planeta
 *   (lo que se ve, no la distancia en km) y cada gigante tiene su tono.
 * - Cerca del Sol, un rugido grave con chasquidos.
 * - A ras de suelo en un cuerpo con atmósfera, viento a ráfagas: tenue y agudo en Marte,
 *   grave en Titán, denso en Venus y en las cimas de las nubes de los gigantes.
 * - En los viajes, un soplo que sube con el warp.
 *
 * El navegador solo deja arrancar el audio tras un gesto del usuario: el contexto se crea en
 * el primer clic o tecla (`unlock`). Con la pestaña oculta o el sonido apagado se suspende.
 * Todos los cambios de nivel y tono van suavizados (`setTargetAtTime`): sin chasquidos.
 */
import type { BodyId } from '../astro/bodies';

export interface SoundState {
  /** Gigante gaseoso que más se ve y su radio angular (rad), o null. */
  giant: { id: BodyId; angularRadius: number } | null;
  /** Radio angular del Sol (rad). */
  sunAngularRadius: number;
  /** Cuerpo de referencia y altitud de la cámara sobre su suelo (km). */
  focusId: BodyId;
  altitudeKm: number;
  radiusKm: number;
  /** Intensidad del warp (0–1). */
  warp: number;
}

/** Tono del zumbido de cada gigante (Hz): Júpiter el más grave. */
const DRONE_HZ: Partial<Record<BodyId, number>> = { jupiter: 36, saturn: 41, uranus: 52, neptune: 47 };

/**
 * Viento por cuerpo: volumen, tono relativo (1 = la Tierra) y altitud a la que se apaga (en km,
 * o en radios si es negativa: las cimas de las nubes de los gigantes).
 */
const WIND: Partial<Record<BodyId, { gain: number; pitch: number; top: number }>> = {
  earth: { gain: 1, pitch: 1, top: 40 },
  mars: { gain: 0.45, pitch: 1.7, top: 30 },
  titan: { gain: 0.9, pitch: 0.6, top: 120 },
  venus: { gain: 1.1, pitch: 0.5, top: 90 },
  jupiter: { gain: 1, pitch: 0.45, top: -0.03 },
  saturn: { gain: 1, pitch: 0.5, top: -0.03 },
  uranus: { gain: 0.8, pitch: 0.7, top: -0.03 },
  neptune: { gain: 1, pitch: 0.6, top: -0.03 },
};

/** Volumen general con el sonido activado. */
const MASTER = 0.55;
/** Constante de tiempo de los cambios de nivel (s). */
const SMOOTH = 0.25;

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

interface Voices {
  ctx: AudioContext;
  master: GainNode;
  drone: { level: GainNode; oscillators: OscillatorNode[]; ratios: number[] };
  sun: { level: GainNode; crackle: GainNode };
  wind: { level: GainNode; gusts: GainNode; band: BiquadFilterNode };
  warp: { level: GainNode; band: BiquadFilterNode; tone: OscillatorNode; toneLevel: GainNode };
}

export class Soundscape {
  private voices: Voices | null = null;
  private droneHz = 40;
  private windPitch = 1;

  constructor(private on: boolean) {
    document.addEventListener('visibilitychange', () => this.applyRunning());
  }

  get enabled(): boolean {
    return this.on;
  }

  setEnabled(on: boolean): void {
    this.on = on;
    if (on) this.unlock();
    const v = this.voices;
    if (v) v.master.gain.setTargetAtTime(on ? MASTER : 0, v.ctx.currentTime, 0.12);
    // Apagado: se suspende cuando ya ha bajado el volumen.
    if (!on) setTimeout(() => this.applyRunning(), 600);
  }

  /** En un gesto del usuario: crea el contexto (la primera vez) o lo reanuda. */
  unlock(): void {
    if (!this.on) return;
    if (!this.voices) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.voices = build(new Ctx());
      this.voices.master.gain.setTargetAtTime(MASTER, this.voices.ctx.currentTime, 0.5);
    }
    this.applyRunning();
  }

  private applyRunning(): void {
    const ctx = this.voices?.ctx;
    if (!ctx) return;
    const run = this.on && document.visibilityState === 'visible';
    if (run && ctx.state === 'suspended') void ctx.resume();
    else if (!run && ctx.state === 'running') void ctx.suspend();
  }

  update(s: SoundState): void {
    const v = this.voices;
    if (!v || !this.on || v.ctx.state !== 'running') return;
    const t = v.ctx.currentTime;

    // Gigantes: con el planeta llenando media pantalla, el zumbido entero.
    const giant = s.giant ? smoothstep(0.02, 0.35, s.giant.angularRadius) : 0;
    v.drone.level.gain.setTargetAtTime(giant * 0.5, t, SMOOTH);
    const hz = (s.giant && DRONE_HZ[s.giant.id]) ?? this.droneHz;
    if (hz !== this.droneHz) {
      this.droneHz = hz;
      v.drone.oscillators.forEach((o, k) => o.frequency.setTargetAtTime(hz * v.drone.ratios[k], t, 1.2));
    }

    // Sol.
    const sun = smoothstep(0.03, 0.5, s.sunAngularRadius);
    v.sun.level.gain.setTargetAtTime(sun * 0.45, t, SMOOTH);
    v.sun.crackle.gain.setTargetAtTime(sun, t, SMOOTH);

    // Viento: solo dentro de la atmósfera, más fuerte cuanto más abajo.
    const w = WIND[s.focusId];
    let wind = 0;
    if (w) {
      const top = w.top > 0 ? w.top : -w.top * s.radiusKm;
      wind = w.gain * (1 - smoothstep(top * 0.05, top, s.altitudeKm));
      if (w.pitch !== this.windPitch) {
        this.windPitch = w.pitch;
        v.wind.band.frequency.setTargetAtTime(420 * w.pitch, t, 0.8);
      }
    }
    v.wind.level.gain.setTargetAtTime(wind * 0.32, t, SMOOTH);
    v.wind.gusts.gain.setTargetAtTime(wind * 0.22, t, SMOOTH);

    // Warp: soplo que sube de tono y un barrido grave.
    const warp = s.warp * s.warp;
    v.warp.level.gain.setTargetAtTime(warp * 0.5, t, 0.08);
    v.warp.band.frequency.setTargetAtTime(280 + 2600 * s.warp, t, 0.08);
    v.warp.toneLevel.gain.setTargetAtTime(warp * 0.12, t, 0.08);
    v.warp.tone.frequency.setTargetAtTime(55 + 120 * s.warp, t, 0.08);
  }
}

/** Ruido blanco o marrón (integrado, más grave) de unos segundos, en bucle. */
function noise(ctx: AudioContext, brown: boolean, seconds = 9): AudioBufferSourceNode {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    if (brown) {
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    } else {
      data[i] = white;
    }
  }
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  source.start(0, Math.random() * seconds);
  return source;
}

function oscillator(ctx: AudioContext, type: OscillatorType, hz: number): OscillatorNode {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = hz;
  o.start();
  return o;
}

function filter(ctx: AudioContext, type: BiquadFilterType, hz: number, q = 0.7): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = hz;
  f.Q.value = q;
  return f;
}

function gain(ctx: AudioContext, value: number): GainNode {
  const g = ctx.createGain();
  g.gain.value = value;
  return g;
}

/** Un LFO lento (seno) con su profundidad, para conectarlo a un parámetro. */
function lfo(ctx: AudioContext, hz: number, depth: number): GainNode {
  const g = gain(ctx, depth);
  oscillator(ctx, 'sine', hz).connect(g);
  return g;
}

function build(ctx: AudioContext): Voices {
  const master = gain(ctx, 0);
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -12;
  limiter.ratio.value = 6;
  master.connect(limiter).connect(ctx.destination);

  // Zumbido de los gigantes: fundamental, sierra desafinada, subarmónico y quinta suave.
  const droneLevel = gain(ctx, 0);
  const droneFilter = filter(ctx, 'lowpass', 150, 0.9);
  lfo(ctx, 0.05, 55).connect(droneFilter.frequency);
  const ratios = [1, 1.004, 0.5, 1.5];
  const types: OscillatorType[] = ['sine', 'sawtooth', 'sine', 'triangle'];
  const mixes = [0.5, 0.18, 0.45, 0.08];
  const oscillators = ratios.map((r, k) => {
    const o = oscillator(ctx, types[k], 40 * r);
    o.connect(gain(ctx, mixes[k])).connect(droneFilter);
    return o;
  });
  droneFilter.connect(droneLevel);
  noise(ctx, true).connect(filter(ctx, 'lowpass', 90)).connect(gain(ctx, 0.5)).connect(droneLevel);
  droneLevel.connect(master);

  // Sol: rugido grave y chasquidos (ruido agudo abierto a ráfagas por otro ruido muy lento).
  const sunLevel = gain(ctx, 0);
  noise(ctx, true).connect(filter(ctx, 'lowpass', 260)).connect(sunLevel);
  const crackleGate = gain(ctx, 0);
  noise(ctx, false).connect(filter(ctx, 'bandpass', 1900, 0.6)).connect(crackleGate).connect(gain(ctx, 0.35)).connect(sunLevel);
  const shaper = ctx.createWaveShaper();
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.max(0, Math.abs(x) * 9 - 0.35) ** 2;
  }
  shaper.curve = curve;
  const crackle = gain(ctx, 0);
  noise(ctx, false).connect(filter(ctx, 'lowpass', 14)).connect(shaper).connect(crackle).connect(crackleGate.gain);
  sunLevel.connect(master);

  // Viento: ruido por un paso banda que se mueve, con ráfagas (dos LFO de ritmos distintos).
  const windLevel = gain(ctx, 0);
  const band = filter(ctx, 'bandpass', 420, 0.5);
  lfo(ctx, 0.11, 160).connect(band.frequency);
  noise(ctx, false).connect(band).connect(windLevel).connect(master);
  const gusts = gain(ctx, 0);
  lfo(ctx, 0.09, 0.7).connect(gusts);
  lfo(ctx, 0.23, 0.4).connect(gusts);
  gusts.connect(windLevel.gain);

  // Warp.
  const warpLevel = gain(ctx, 0);
  const warpBand = filter(ctx, 'bandpass', 280, 1.2);
  noise(ctx, false).connect(warpBand).connect(warpLevel).connect(master);
  const tone = oscillator(ctx, 'sine', 55);
  const toneLevel = gain(ctx, 0);
  tone.connect(toneLevel).connect(master);

  return {
    ctx,
    master,
    drone: { level: droneLevel, oscillators, ratios },
    sun: { level: sunLevel, crackle },
    wind: { level: windLevel, gusts, band },
    warp: { level: warpLevel, band: warpBand, tone, toneLevel },
  };
}
