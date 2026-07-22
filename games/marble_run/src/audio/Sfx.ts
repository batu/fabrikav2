/**
 * Procedural SFX — Web Audio API, zero dependencies. ASMR-leaning sound
 * palette: soft wooden ticks, marble plops with a streak pitch ladder,
 * dull felt thuds. All output routes through masterGain so recordings
 * can tap the mix (getRecordingStream contract from game-audio skill).
 */
import { gameState } from '../core/GameState';

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let rollingLoop: { source: AudioBufferSourceNode; gain: GainNode } | null = null;

function ac(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

export function getMasterOutput(): GainNode {
  const a = ac();
  if (!masterGain) {
    masterGain = a.createGain();
    masterGain.gain.value = 1;
    masterGain.connect(a.destination);
  }
  return masterGain;
}

/** Tap the master mix for gameplay recordings. Caller owns the stream. */
export async function getRecordingStream(): Promise<MediaStream> {
  const a = ac();
  if (a.state === 'suspended') await a.resume();
  const dest = a.createMediaStreamDestination();
  getMasterOutput().connect(dest);
  return dest.stream;
}

function on(): boolean {
  return gameState.settings.soundEffectsOn;
}

function jitter(base: number, range = 0.06): number {
  return base * (1 + (Math.random() * 2 - 1) * range);
}

interface ToneOpts {
  freq: number;
  type?: OscillatorType;
  dur?: number;
  gain?: number;
  at?: number;
  lpf?: number;
  pitchTo?: number;
}

function tone(opts: ToneOpts): void {
  const a = ac();
  const t = a.currentTime + (opts.at ?? 0);
  const dur = opts.dur ?? 0.12;

  const osc = a.createOscillator();
  osc.type = opts.type ?? 'sine';
  osc.frequency.setValueAtTime(opts.freq, t);
  if (opts.pitchTo) osc.frequency.exponentialRampToValueAtTime(opts.pitchTo, t + dur);

  const env = a.createGain();
  env.gain.setValueAtTime(opts.gain ?? 0.2, t);
  env.gain.exponentialRampToValueAtTime(0.001, t + dur);

  let tail: AudioNode = env;
  if (opts.lpf) {
    const lpf = a.createBiquadFilter();
    lpf.type = 'lowpass';
    lpf.frequency.setValueAtTime(opts.lpf, t);
    env.connect(lpf);
    tail = lpf;
  }
  osc.connect(env);
  tail.connect(getMasterOutput());
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

interface NoiseOpts {
  dur?: number;
  gain?: number;
  at?: number;
  lpf?: number;
  hpf?: number;
}

function noise(opts: NoiseOpts): void {
  const a = ac();
  const t = a.currentTime + (opts.at ?? 0);
  const dur = opts.dur ?? 0.08;
  const len = Math.max(1, Math.ceil(a.sampleRate * dur));
  const buffer = a.createBuffer(1, len, a.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;

  const src = a.createBufferSource();
  src.buffer = buffer;

  const env = a.createGain();
  env.gain.setValueAtTime(opts.gain ?? 0.12, t);
  env.gain.exponentialRampToValueAtTime(0.001, t + dur);

  let head: AudioNode = src;
  if (opts.hpf) {
    const hp = a.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(opts.hpf, t);
    head.connect(hp);
    head = hp;
  }
  if (opts.lpf) {
    const lp = a.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(opts.lpf, t);
    head.connect(lp);
    head = lp;
  }
  head.connect(env);
  env.connect(getMasterOutput());
  src.start(t);
}

// ── Public one-shots ────────────────────────────────────────────────

/** Soft woodblock for UI taps. */
export function uiTap(): void {
  if (!on()) return;
  tone({ freq: jitter(980), type: 'triangle', dur: 0.055, gain: 0.16, lpf: 3200 });
  noise({ dur: 0.025, gain: 0.05, hpf: 1800 });
}

/** Marble pop-in at level start (staggered, gentle pitch rise). */
export function spawnTick(index: number): void {
  if (!on()) return;
  const f = 520 * Math.pow(2, Math.min(index, 14) / 36);
  tone({ freq: jitter(f, 0.03), type: 'sine', dur: 0.07, gain: 0.07, lpf: 3200 });
}

/** Very soft tick as a rolling marble crosses a dimple. */
export function rollTic(): void {
  if (!on()) return;
  tone({ freq: jitter(1350, 0.12), type: 'sine', dur: 0.035, gain: 0.035, lpf: 4200 });
}

export function setRollingActive(active: boolean): void {
  if (!active || !on()) {
    if (rollingLoop) {
      const a = ac();
      rollingLoop.gain.gain.cancelScheduledValues(a.currentTime);
      rollingLoop.gain.gain.setTargetAtTime(0.0001, a.currentTime, 0.035);
      rollingLoop.source.stop(a.currentTime + 0.16);
      rollingLoop = null;
    }
    return;
  }
  if (rollingLoop) return;

  const a = ac();
  const dur = 0.32;
  const len = Math.max(1, Math.ceil(a.sampleRate * dur));
  const buffer = a.createBuffer(1, len, a.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i += 1) {
    data[i] = (Math.random() * 2 - 1) * 0.45 + Math.sin((i / len) * Math.PI * 16) * 0.12;
  }

  const source = a.createBufferSource();
  source.buffer = buffer;
  source.loop = true;

  const hp = a.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.setValueAtTime(170, a.currentTime);
  const lp = a.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(820, a.currentTime);

  const gain = a.createGain();
  gain.gain.setValueAtTime(0.0001, a.currentTime);
  gain.gain.setTargetAtTime(0.028, a.currentTime, 0.05);

  source.connect(hp).connect(lp).connect(gain).connect(getMasterOutput());
  source.start();
  rollingLoop = { source, gain };
}

/** Marble leaves through its gate. Streak walks up a pentatonic ladder. */
export function absorbPlop(streak: number): void {
  if (!on()) return;
  const ladder = [0, 2, 4, 7, 9, 12, 14, 16, 19];
  const step = ladder[Math.min(Math.max(streak - 1, 0), ladder.length - 1)];
  const base = 240 * Math.pow(2, step / 12);
  tone({ freq: base, pitchTo: base * 1.9, type: 'sine', dur: 0.1, gain: 0.2, lpf: 3400 });
  tone({ freq: base * 4, type: 'triangle', dur: 0.05, gain: 0.05, at: 0.02 });
  noise({ dur: 0.025, gain: 0.07, hpf: 1400, lpf: 6400 });
}

/** Dull felt thud — blocked tap. */
export function thud(): void {
  if (!on()) return;
  tone({ freq: 220, pitchTo: 95, type: 'triangle', dur: 0.22, gain: 0.26, lpf: 700 });
  tone({ freq: 165, pitchTo: 120, type: 'sine', dur: 0.16, gain: 0.12, at: 0.05, lpf: 600 });
  noise({ dur: 0.06, gain: 0.07, lpf: 800 });
}

/** Heart cracks: two thin descending notes. */
export function heartBreak(): void {
  if (!on()) return;
  tone({ freq: 640, type: 'square', dur: 0.07, gain: 0.05, lpf: 1500 });
  tone({ freq: 508, type: 'square', dur: 0.1, gain: 0.05, at: 0.07, lpf: 1300 });
}

/** Win: wooden marimba arpeggio + air. */
export function winFanfare(): void {
  if (!on()) return;
  const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
  notes.forEach((f, i) => {
    tone({ freq: f, type: 'sine', dur: 0.34, gain: 0.18, at: i * 0.095, lpf: 3600 });
    tone({ freq: f * 2, type: 'sine', dur: 0.12, gain: 0.04, at: i * 0.095 });
  });
  noise({ dur: 0.5, gain: 0.03, hpf: 5200, at: 0.3 });
}

/** Lose: soft descending pair, sympathetic not punishing. */
export function loseSting(): void {
  if (!on()) return;
  tone({ freq: 392, type: 'sine', dur: 0.3, gain: 0.16, lpf: 2000 });
  tone({ freq: 311, type: 'sine', dur: 0.42, gain: 0.16, at: 0.22, lpf: 1700 });
}

/** Settings toggle click. */
export function toggleClick(onState: boolean): void {
  if (!on()) return;
  tone({ freq: onState ? 760 : 520, type: 'triangle', dur: 0.05, gain: 0.13, lpf: 2600 });
}

/** Unlock AudioContext from the first user gesture (autoplay policy). */
export function unlockAudio(): void {
  void ac();
}
