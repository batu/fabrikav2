/**
 * Ambient music-box loop ported onto the v2 SDK AudioBus. Very quiet
 * pentatonic pattern over a warm drone — background texture, not a melody
 * fighting the SFX. A lookahead scheduler keeps the pattern jank-free.
 *
 * v1 ramped its own internal bus GainNode for the fade in/out. Here the loop
 * is a bus 'voice' on the 'music' channel and the 2.2s fade-in / 0.8s
 * fade-out are done with `bus.setVolume('music', v, ms)`.
 */
import type { AudioSource, PlayHandle } from '@fabrikav2/sdk/audio';
import { audioBus } from './bus.ts';
import { saveState } from '../core/SaveState.ts';

const MUSIC_ID = 'music/box';
const FADE_IN_MS = 2200;
const FADE_OUT_MS = 800;

// C major pentatonic, octave 5-6, with rests (0 = rest).
const PATTERN: readonly number[] = [
  523.25, 0, 783.99, 0, 659.25, 0, 0, 880,
  0, 587.33, 0, 783.99, 0, 0, 1046.5, 0,
  659.25, 0, 523.25, 0, 880, 0, 0, 587.33,
  0, 783.99, 0, 659.25, 0, 0, 523.25, 0,
];
const STEP_S = 0.34;
const NOTE_GAIN = 0.04;
const DRONE_GAIN = 0.018;

class MusicBox {
  private playing = false;
  private step = 0;
  private nextNoteTime = 0;
  private timer: number | null = null;
  private handle: PlayHandle | null = null;
  private ctx: BaseAudioContext | null = null;
  private out: AudioNode | null = null;
  private droneNodes: OscillatorNode[] = [];

  start(): void {
    if (this.playing || !saveState.musicEnabled) return;
    this.playing = true;
    // Fade in from silence via the channel volume (replaces v1's internal ramp).
    audioBus.setVolume('music', 0);
    audioBus.register(MUSIC_ID, this.buildVoice());
    this.handle = audioBus.play(MUSIC_ID, { channel: 'music' });
    audioBus.setVolume('music', 1, FADE_IN_MS);
  }

  stop(): void {
    if (!this.playing) return;
    this.playing = false;
    audioBus.setVolume('music', 0, FADE_OUT_MS);
    const handle = this.handle;
    this.handle = null;
    // Let the fade finish before tearing down the voice's nodes (v1 waited 900ms).
    window.setTimeout(() => {
      if (handle) audioBus.stop(handle);
    }, FADE_OUT_MS + 100);
  }

  isPlaying(): boolean {
    return this.playing;
  }

  /** Re-evaluate after a settings change. */
  refresh(): void {
    if (saveState.musicEnabled) this.start();
    else this.stop();
  }

  private buildVoice(): AudioSource {
    return {
      kind: 'voice',
      render: (ctx: BaseAudioContext, out: AudioNode): { stop(): void } => {
        this.ctx = ctx;
        this.out = out;

        // Warm two-osc drone (C3 + G3, slightly detuned).
        for (const f of [130.81, 196.0]) {
          const osc = ctx.createOscillator();
          osc.type = 'sine';
          osc.frequency.value = f;
          osc.detune.value = Math.random() * 5 - 2.5;
          const g = ctx.createGain();
          g.gain.value = DRONE_GAIN;
          osc.connect(g);
          g.connect(out);
          osc.start();
          this.droneNodes.push(osc);
        }

        this.step = 0;
        this.nextNoteTime = ctx.currentTime + 0.1;
        this.timer = window.setInterval(() => this.schedule(), 120);

        return { stop: () => this.teardown() };
      },
    };
  }

  private teardown(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    const now = this.ctx?.currentTime ?? 0;
    for (const osc of this.droneNodes) {
      try {
        osc.stop(now + 1);
      } catch {
        // Already stopped.
      }
    }
    this.droneNodes = [];
    this.ctx = null;
    this.out = null;
  }

  private schedule(): void {
    const ctx = this.ctx;
    const out = this.out;
    if (!this.playing || !ctx || !out) return;
    // After interval throttling/suspension, never schedule into the past —
    // Web Audio would fire every missed note simultaneously.
    if (this.nextNoteTime < ctx.currentTime) {
      this.nextNoteTime = ctx.currentTime + 0.05;
    }
    while (this.nextNoteTime < ctx.currentTime + 0.3) {
      const freq = PATTERN[this.step % PATTERN.length];
      if (freq > 0) this.note(ctx, out, freq, this.nextNoteTime);
      this.step += 1;
      this.nextNoteTime += STEP_S;
    }
  }

  private note(ctx: BaseAudioContext, out: AudioNode, freq: number, at: number): void {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, at);
    const harm = ctx.createOscillator();
    harm.type = 'sine';
    harm.frequency.setValueAtTime(freq * 2, at);

    const env = ctx.createGain();
    env.gain.setValueAtTime(NOTE_GAIN, at);
    env.gain.exponentialRampToValueAtTime(0.0005, at + 1.4);
    const harmEnv = ctx.createGain();
    harmEnv.gain.setValueAtTime(NOTE_GAIN * 0.25, at);
    harmEnv.gain.exponentialRampToValueAtTime(0.0005, at + 0.5);

    osc.connect(env);
    harm.connect(harmEnv);
    env.connect(out);
    harmEnv.connect(out);
    osc.start(at);
    osc.stop(at + 1.5);
    harm.start(at);
    harm.stop(at + 0.6);
  }
}

export const music = new MusicBox();

// Background discipline: silence and stop scheduling while hidden (the render
// loop pauses on hide; intervals and the AudioContext do not).
if (typeof document !== 'undefined') {
  let resumeOnShow = false;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      resumeOnShow = music.isPlaying();
      music.stop();
    } else if (resumeOnShow) {
      resumeOnShow = false;
      music.refresh();
    }
  });
}
