/**
 * Procedural SFX ported onto the v2 SDK AudioBus. ASMR-leaning palette: soft
 * wooden ticks, marble plops with a streak pitch ladder, dull felt thuds.
 *
 * v1 built each graph on its own AudioContext + masterGain. Here every sound
 * is registered as a bus 'voice' whose `render(ctx, out)` builds the same
 * oscillator/noise graph and connects it to the 'sfx' channel gain (`out`).
 * One-shots schedule their own envelopes + node stops and self-terminate; the
 * rolling loop is a continuous voice whose handle we keep and later stop.
 */
import type { AudioSource, PlayHandle } from '@fabrikav2/sdk/audio';
import { audioBus } from './bus.ts';
import { saveState } from '../core/SaveState.ts';

export { unlockAudio } from './bus.ts';

function on(): boolean {
  return saveState.sfxEnabled;
}

function jitter(base: number, range = 0.06): number {
  return base * (1 + (Math.random() * 2 - 1) * range);
}

interface StopHandle {
  stop(): void;
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

/** Build a single decaying tone into `out`; returns a teardown handle. */
function buildTone(ctx: BaseAudioContext, out: AudioNode, opts: ToneOpts): StopHandle {
  const t = ctx.currentTime + (opts.at ?? 0);
  const dur = opts.dur ?? 0.12;

  const osc = ctx.createOscillator();
  osc.type = opts.type ?? 'sine';
  osc.frequency.setValueAtTime(opts.freq, t);
  if (opts.pitchTo) osc.frequency.exponentialRampToValueAtTime(opts.pitchTo, t + dur);

  const env = ctx.createGain();
  env.gain.setValueAtTime(opts.gain ?? 0.2, t);
  env.gain.exponentialRampToValueAtTime(0.001, t + dur);

  let tail: AudioNode = env;
  if (opts.lpf) {
    const lpf = ctx.createBiquadFilter();
    lpf.type = 'lowpass';
    lpf.frequency.setValueAtTime(opts.lpf, t);
    env.connect(lpf);
    tail = lpf;
  }
  osc.connect(env);
  tail.connect(out);
  osc.start(t);
  osc.stop(t + dur + 0.02);

  return {
    stop(): void {
      try {
        osc.stop();
      } catch {
        // Already stopped.
      }
    },
  };
}

interface NoiseOpts {
  dur?: number;
  gain?: number;
  at?: number;
  lpf?: number;
  hpf?: number;
}

/** Build a short filtered noise burst into `out`; returns a teardown handle. */
function buildNoise(ctx: BaseAudioContext, out: AudioNode, opts: NoiseOpts): StopHandle {
  const t = ctx.currentTime + (opts.at ?? 0);
  const dur = opts.dur ?? 0.08;
  const len = Math.max(1, Math.ceil(ctx.sampleRate * dur));
  const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;

  const src = ctx.createBufferSource();
  src.buffer = buffer;

  const env = ctx.createGain();
  env.gain.setValueAtTime(opts.gain ?? 0.12, t);
  env.gain.exponentialRampToValueAtTime(0.001, t + dur);

  let head: AudioNode = src;
  if (opts.hpf) {
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(opts.hpf, t);
    head.connect(hp);
    head = hp;
  }
  if (opts.lpf) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(opts.lpf, t);
    head.connect(lp);
    head = lp;
  }
  head.connect(env);
  env.connect(out);
  src.start(t);

  return {
    stop(): void {
      try {
        src.stop();
      } catch {
        // Already stopped.
      }
    },
  };
}

/** Wrap a layer-builder into a bus voice whose stop() tears down every layer. */
function voice(build: (ctx: BaseAudioContext, out: AudioNode) => StopHandle[]): AudioSource {
  return {
    kind: 'voice',
    render(ctx: BaseAudioContext, out: AudioNode): StopHandle {
      const parts = build(ctx, out);
      return {
        stop(): void {
          for (const p of parts) p.stop();
        },
      };
    },
  };
}

/** Register the freshly-parameterized voice under its stable id, then fire it. */
function playOneShot(id: string, source: AudioSource): void {
  audioBus.register(id, source);
  audioBus.play(id, { channel: 'sfx' });
}

// ── Public one-shots ────────────────────────────────────────────────

/** Soft woodblock for UI taps. */
export function uiTap(): void {
  if (!on()) return;
  playOneShot(
    'sfx/uiTap',
    voice((ctx, out) => [
      buildTone(ctx, out, { freq: jitter(980), type: 'triangle', dur: 0.055, gain: 0.16, lpf: 3200 }),
      buildNoise(ctx, out, { dur: 0.025, gain: 0.05, hpf: 1800 }),
    ]),
  );
}

/** Marble pop-in at level start (staggered, gentle pitch rise). */
export function spawnTick(index: number): void {
  if (!on()) return;
  const f = 520 * Math.pow(2, Math.min(index, 14) / 36);
  playOneShot(
    'sfx/spawnTick',
    voice((ctx, out) => [
      buildTone(ctx, out, { freq: jitter(f, 0.03), type: 'sine', dur: 0.07, gain: 0.07, lpf: 3200 }),
    ]),
  );
}

/** Very soft tick as a rolling marble crosses a dimple. */
export function rollTic(): void {
  if (!on()) return;
  playOneShot(
    'sfx/rollTic',
    voice((ctx, out) => [
      buildTone(ctx, out, { freq: jitter(1350, 0.12), type: 'sine', dur: 0.035, gain: 0.035, lpf: 4200 }),
    ]),
  );
}

const ROLLING_ID = 'sfx/rolling';
let rollingHandle: PlayHandle | null = null;

/** Continuous rolling-marble bed. Starts/stops the looped voice on 'sfx'. */
export function setRollingActive(active: boolean): void {
  if (!active || !on()) {
    if (rollingHandle) {
      audioBus.stop(rollingHandle);
      rollingHandle = null;
    }
    return;
  }
  if (rollingHandle) return;

  const source: AudioSource = {
    kind: 'voice',
    render(ctx: BaseAudioContext, out: AudioNode): StopHandle {
      const dur = 0.32;
      const len = Math.max(1, Math.ceil(ctx.sampleRate * dur));
      const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < len; i += 1) {
        data[i] = (Math.random() * 2 - 1) * 0.45 + Math.sin((i / len) * Math.PI * 16) * 0.12;
      }

      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;

      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.setValueAtTime(170, ctx.currentTime);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(820, ctx.currentTime);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.setTargetAtTime(0.028, ctx.currentTime, 0.05);

      src.connect(hp).connect(lp).connect(gain).connect(out);
      src.start();

      return {
        stop(): void {
          // Faithful v1 fade-out: duck the gain then stop the source shortly after.
          const now = ctx.currentTime;
          gain.gain.cancelScheduledValues(now);
          gain.gain.setTargetAtTime(0.0001, now, 0.035);
          try {
            src.stop(now + 0.16);
          } catch {
            // Already stopped.
          }
        },
      };
    },
  };

  audioBus.register(ROLLING_ID, source);
  rollingHandle = audioBus.play(ROLLING_ID, { channel: 'sfx' });
}

/** Marble leaves through its gate. Streak walks up a pentatonic ladder. */
export function absorbPlop(streak: number): void {
  if (!on()) return;
  const ladder = [0, 2, 4, 7, 9, 12, 14, 16, 19];
  const step = ladder[Math.min(Math.max(streak - 1, 0), ladder.length - 1)];
  const base = 240 * Math.pow(2, step / 12);
  playOneShot(
    'sfx/absorbPlop',
    voice((ctx, out) => [
      buildTone(ctx, out, { freq: base, pitchTo: base * 1.9, type: 'sine', dur: 0.1, gain: 0.2, lpf: 3400 }),
      buildTone(ctx, out, { freq: base * 4, type: 'triangle', dur: 0.05, gain: 0.05, at: 0.02 }),
      buildNoise(ctx, out, { dur: 0.025, gain: 0.07, hpf: 1400, lpf: 6400 }),
    ]),
  );
}

/** Dull felt thud — blocked tap. */
export function thud(): void {
  if (!on()) return;
  playOneShot(
    'sfx/thud',
    voice((ctx, out) => [
      buildTone(ctx, out, { freq: 220, pitchTo: 95, type: 'triangle', dur: 0.22, gain: 0.26, lpf: 700 }),
      buildTone(ctx, out, { freq: 165, pitchTo: 120, type: 'sine', dur: 0.16, gain: 0.12, at: 0.05, lpf: 600 }),
      buildNoise(ctx, out, { dur: 0.06, gain: 0.07, lpf: 800 }),
    ]),
  );
}

/** Heart cracks: two thin descending notes. */
export function heartBreak(): void {
  if (!on()) return;
  playOneShot(
    'sfx/heartBreak',
    voice((ctx, out) => [
      buildTone(ctx, out, { freq: 640, type: 'square', dur: 0.07, gain: 0.05, lpf: 1500 }),
      buildTone(ctx, out, { freq: 508, type: 'square', dur: 0.1, gain: 0.05, at: 0.07, lpf: 1300 }),
    ]),
  );
}

/** Win: wooden marimba arpeggio + air. */
export function winFanfare(): void {
  if (!on()) return;
  const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
  playOneShot(
    'sfx/winFanfare',
    voice((ctx, out) => {
      const parts: StopHandle[] = [];
      notes.forEach((f, i) => {
        parts.push(buildTone(ctx, out, { freq: f, type: 'sine', dur: 0.34, gain: 0.18, at: i * 0.095, lpf: 3600 }));
        parts.push(buildTone(ctx, out, { freq: f * 2, type: 'sine', dur: 0.12, gain: 0.04, at: i * 0.095 }));
      });
      parts.push(buildNoise(ctx, out, { dur: 0.5, gain: 0.03, hpf: 5200, at: 0.3 }));
      return parts;
    }),
  );
}

/** Lose: soft descending pair, sympathetic not punishing. */
export function loseSting(): void {
  if (!on()) return;
  playOneShot(
    'sfx/loseSting',
    voice((ctx, out) => [
      buildTone(ctx, out, { freq: 392, type: 'sine', dur: 0.3, gain: 0.16, lpf: 2000 }),
      buildTone(ctx, out, { freq: 311, type: 'sine', dur: 0.42, gain: 0.16, at: 0.22, lpf: 1700 }),
    ]),
  );
}

/** Settings toggle click. */
export function toggleClick(onState: boolean): void {
  if (!on()) return;
  playOneShot(
    'sfx/toggleClick',
    voice((ctx, out) => [
      buildTone(ctx, out, { freq: onState ? 760 : 520, type: 'triangle', dur: 0.05, gain: 0.13, lpf: 2600 }),
    ]),
  );
}
