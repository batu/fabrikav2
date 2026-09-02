import { createAudioBus, type AudioBus, type AudioSource } from "@fabrikav2/sdk/audio";

/**
 * Procedural sound effects on the sdk audio bus: no clip assets, every voice is
 * an oscillator/noise envelope. Gated by the sfx setting through the bus mute.
 */
export type SfxName =
  | "tap"
  | "hit"
  | "crit"
  | "death"
  | "boss"
  | "heal"
  | "stageClear"
  | "win"
  | "lose"
  | "pull"
  | "rare"
  | "equip"
  | "coin"
  | "upgrade";

function tone(
  ctx: BaseAudioContext,
  out: AudioNode,
  opts: { type: OscillatorType; from: number; to?: number; seconds: number; gain?: number; delay?: number },
): OscillatorNode {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const t0 = ctx.currentTime + (opts.delay ?? 0);
  osc.type = opts.type;
  osc.frequency.setValueAtTime(opts.from, t0);
  if (opts.to !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.to), t0 + opts.seconds);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(opts.gain ?? 0.25, t0 + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.seconds);
  osc.connect(gain).connect(out);
  osc.start(t0);
  osc.stop(t0 + opts.seconds + 0.02);
  return osc;
}

let noiseBuffer: AudioBuffer | null = null;
function noise(ctx: BaseAudioContext, out: AudioNode, opts: { seconds: number; gain?: number; cutoff?: number; delay?: number }): AudioBufferSourceNode {
  if (!noiseBuffer || noiseBuffer.sampleRate !== ctx.sampleRate) {
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  }
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = opts.cutoff ?? 1200;
  const gain = ctx.createGain();
  const t0 = ctx.currentTime + (opts.delay ?? 0);
  gain.gain.setValueAtTime(opts.gain ?? 0.2, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.seconds);
  src.connect(filter).connect(gain).connect(out);
  src.start(t0);
  src.stop(t0 + opts.seconds + 0.02);
  return src;
}

const VOICES: Record<SfxName, AudioSource["kind"] extends "voice" ? never : (ctx: BaseAudioContext, out: AudioNode) => void> = {
  tap: (ctx, out) => {
    tone(ctx, out, { type: "square", from: 620, to: 520, seconds: 0.06, gain: 0.12 });
  },
  hit: (ctx, out) => {
    noise(ctx, out, { seconds: 0.08, gain: 0.16, cutoff: 1800 });
    tone(ctx, out, { type: "triangle", from: 220, to: 90, seconds: 0.09, gain: 0.18 });
  },
  crit: (ctx, out) => {
    noise(ctx, out, { seconds: 0.12, gain: 0.22, cutoff: 3000 });
    tone(ctx, out, { type: "sawtooth", from: 340, to: 70, seconds: 0.16, gain: 0.22 });
    tone(ctx, out, { type: "square", from: 880, to: 1320, seconds: 0.08, gain: 0.08, delay: 0.02 });
  },
  death: (ctx, out) => {
    tone(ctx, out, { type: "sawtooth", from: 300, to: 40, seconds: 0.28, gain: 0.16 });
    noise(ctx, out, { seconds: 0.22, gain: 0.12, cutoff: 900 });
  },
  boss: (ctx, out) => {
    tone(ctx, out, { type: "sawtooth", from: 70, to: 55, seconds: 0.6, gain: 0.25 });
    tone(ctx, out, { type: "square", from: 140, to: 110, seconds: 0.5, gain: 0.1, delay: 0.05 });
    noise(ctx, out, { seconds: 0.5, gain: 0.1, cutoff: 500 });
  },
  heal: (ctx, out) => {
    tone(ctx, out, { type: "sine", from: 660, to: 990, seconds: 0.18, gain: 0.12 });
    tone(ctx, out, { type: "sine", from: 990, to: 1320, seconds: 0.18, gain: 0.08, delay: 0.09 });
  },
  stageClear: (ctx, out) => {
    [523, 659, 784].forEach((f, i) => tone(ctx, out, { type: "square", from: f, seconds: 0.12, gain: 0.1, delay: i * 0.07 }));
  },
  win: (ctx, out) => {
    [523, 659, 784, 1047].forEach((f, i) => tone(ctx, out, { type: "square", from: f, seconds: 0.18, gain: 0.12, delay: i * 0.11 }));
    tone(ctx, out, { type: "triangle", from: 262, seconds: 0.6, gain: 0.08, delay: 0.33 });
  },
  lose: (ctx, out) => {
    [392, 349, 311, 262].forEach((f, i) => tone(ctx, out, { type: "sawtooth", from: f, to: f * 0.94, seconds: 0.26, gain: 0.1, delay: i * 0.18 }));
  },
  pull: (ctx, out) => {
    tone(ctx, out, { type: "sine", from: 200, to: 1600, seconds: 0.45, gain: 0.14 });
    noise(ctx, out, { seconds: 0.45, gain: 0.06, cutoff: 2500 });
  },
  rare: (ctx, out) => {
    [784, 988, 1175, 1568, 1976].forEach((f, i) => tone(ctx, out, { type: "sine", from: f, seconds: 0.35, gain: 0.1, delay: i * 0.06 }));
    noise(ctx, out, { seconds: 0.6, gain: 0.05, cutoff: 4000 });
  },
  equip: (ctx, out) => {
    tone(ctx, out, { type: "square", from: 440, to: 660, seconds: 0.09, gain: 0.1 });
    tone(ctx, out, { type: "square", from: 660, to: 880, seconds: 0.1, gain: 0.1, delay: 0.08 });
  },
  coin: (ctx, out) => {
    tone(ctx, out, { type: "sine", from: 1320, seconds: 0.08, gain: 0.08 });
    tone(ctx, out, { type: "sine", from: 1760, seconds: 0.12, gain: 0.08, delay: 0.05 });
  },
  upgrade: (ctx, out) => {
    tone(ctx, out, { type: "triangle", from: 300, to: 900, seconds: 0.3, gain: 0.12 });
    tone(ctx, out, { type: "sine", from: 900, to: 1200, seconds: 0.2, gain: 0.08, delay: 0.25 });
  },
};

export interface Sfx {
  play(name: SfxName): void;
  setEnabled(enabled: boolean): void;
  /** Call from a user gesture once; iOS keeps the context suspended until then. */
  unlock(): void;
}

export function createSfx(): Sfx {
  let bus: AudioBus | null = null;
  let enabled = true;
  let unlocked = false;
  const lastPlayed = new Map<SfxName, number>();
  const ensure = (): AudioBus | null => {
    if (bus) return bus;
    if (typeof AudioContext === "undefined") return null;
    try {
      bus = createAudioBus();
    } catch {
      return null;
    }
    for (const [name, render] of Object.entries(VOICES) as [SfxName, (typeof VOICES)[SfxName]][]) {
      bus.register(name, {
        kind: "voice",
        render: (ctx, out) => {
          render(ctx, out);
          return { stop: () => undefined };
        },
      });
    }
    bus.setMuted("sfx", !enabled);
    return bus;
  };
  return {
    play(name) {
      if (!enabled || !unlocked) return;
      const b = ensure();
      if (!b) return;
      // Rate-limit identical rapid cues (melee clusters would otherwise buzz).
      const now = performance.now();
      const minGap = name === "hit" ? 45 : name === "coin" ? 60 : 0;
      if (minGap && now - (lastPlayed.get(name) ?? -1000) < minGap) return;
      lastPlayed.set(name, now);
      try {
        b.play(name, { channel: "sfx" });
      } catch {
        // A failed voice must never break gameplay.
      }
    },
    setEnabled(next) {
      enabled = next;
      bus?.setMuted("sfx", !next);
    },
    unlock() {
      if (unlocked) return;
      unlocked = true;
      const b = ensure();
      void b?.unlock();
    },
  };
}
