/**
 * AudioBus — a minimal mixing/state bus that kills v1's 4×~1,860-line
 * per-game audio rewrite (research 04: 4 games, 4 incompatible mute/volume
 * APIs, zero sharing). Games plug in decoded clips or procedural voices;
 * the bus owns the channel graph and the mute/volume/duck state machine.
 *
 * Scope discipline (per the card + brainstorm): this is the mixer + state
 * layer ONLY. No synth content is ported from any game — the sole synthesis
 * the SDK ships is one trivial test beep (`test-synth`) so the bus is
 * exercisable in isolation. Each game keeps (or later migrates) its own
 * oscillator/noise content and registers it as voices.
 *
 * The gain math lives in the pure `Mixer` (mixer.ts); this file is the thin
 * Web Audio apply-layer that pushes `mixer.effectiveGain(channel)` onto real
 * GainNodes, with optional millisecond fades.
 */
import {
  AUDIO_CHANNELS,
  Mixer,
  type AudioChannel,
} from './mixer.ts';

export type { AudioChannel } from './mixer.ts';

/** A game plugs in either a decoded clip or a procedural voice factory. */
export type AudioSource =
  | { kind: 'clip'; buffer: AudioBuffer }
  | {
      kind: 'voice';
      /** Build a playing node graph into `out`; return a stop handle. */
      render: (ctx: BaseAudioContext, out: AudioNode) => { stop(): void };
    };

/** Opaque handle for a single in-flight playback. */
export interface PlayHandle {
  stop(): void;
}

export interface PlayOptions {
  channel?: AudioChannel;
  /** Clip playback-rate multiplier (block_blast's per-cue pitch). */
  pitch?: number;
  loop?: boolean;
}

export interface AudioBus {
  register(id: string, source: AudioSource): void;
  play(id: string, opts?: PlayOptions): PlayHandle;
  stop(handle: PlayHandle): void;

  // --- the state machine the AC unit-tests (mute / volume / duck) ---
  setMuted(channel: AudioChannel, muted: boolean): void;
  isMuted(channel: AudioChannel): boolean;
  /** 0..1 clamped; optional linear fade over `ms`. */
  setVolume(channel: AudioChannel, volume: number, ms?: number): void;
  getVolume(channel: AudioChannel): number;
  /** Depth-counted attenuation (generalizes FTD's ad-pause depth). */
  duck(channel: AudioChannel, toGain: number, ms?: number): void;
  unduck(channel: AudioChannel, ms?: number): void;
  /** muted ? 0 : volume * duckFactor — the pure, tested value. */
  effectiveGain(channel: AudioChannel): number;

  // --- context lifecycle (games own WHEN to call these) ---
  unlock(): Promise<void>;
  suspend(): void;
  resume(): Promise<void>;

  /** Master output — the recording-tap accessor (testkit/debug harness). */
  readonly master: GainNode;
}

export interface CreateAudioBusOptions {
  /**
   * Inject an existing/stub context. When omitted a real `AudioContext`
   * is created lazily — passing a stub is how the bus is unit-tested
   * without jsdom Web Audio. `AudioContext` (not `BaseAudioContext`) is
   * required for the `suspend`/`resume` lifecycle methods.
   */
  context?: AudioContext;
}

/** Id of the single built-in test voice (the only synth the SDK ships). */
export const TEST_SYNTH_ID = 'test-synth';

/** A trivial short sine beep — lets the bus be played/demoed in isolation. */
export const testSynth: AudioSource = {
  kind: 'voice',
  render(ctx: BaseAudioContext, out: AudioNode): { stop(): void } {
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.frequency.value = 440;
    env.gain.value = 0.2;
    osc.connect(env);
    env.connect(out);
    osc.start();
    return {
      stop(): void {
        try {
          osc.stop();
        } catch {
          // Already stopped — nothing to do.
        }
      },
    };
  },
};

export function createAudioBus(opts: CreateAudioBusOptions = {}): AudioBus {
  const ctx: AudioContext = opts.context ?? new AudioContext();

  const master = ctx.createGain();
  master.connect(ctx.destination);

  const channelNodes: Record<AudioChannel, GainNode> = {
    music: ctx.createGain(),
    sfx: ctx.createGain(),
  };
  for (const channel of AUDIO_CHANNELS) {
    channelNodes[channel].connect(master);
  }

  const mixer = new Mixer();
  const registry = new Map<string, AudioSource>();

  /** Push the channel's effective gain onto its node, optionally faded. */
  function apply(channel: AudioChannel, ms?: number): void {
    const param = channelNodes[channel].gain;
    const target = mixer.effectiveGain(channel);
    if (ms !== undefined && ms > 0) {
      const now = ctx.currentTime;
      param.cancelScheduledValues(now);
      param.setValueAtTime(param.value, now);
      param.linearRampToValueAtTime(target, now + ms / 1000);
    } else {
      param.value = target;
    }
  }

  // Seed every channel node to its initial effective gain (1).
  for (const channel of AUDIO_CHANNELS) apply(channel);

  const bus: AudioBus = {
    register(id: string, source: AudioSource): void {
      registry.set(id, source);
    },

    play(id: string, playOpts: PlayOptions = {}): PlayHandle {
      const source = registry.get(id);
      if (source === undefined) {
        throw new Error(`AudioBus: unknown source id "${id}" (register it first)`);
      }
      const out = channelNodes[playOpts.channel ?? 'sfx'];

      if (source.kind === 'clip') {
        const node = ctx.createBufferSource();
        node.buffer = source.buffer;
        node.loop = playOpts.loop ?? false;
        if (playOpts.pitch !== undefined) node.playbackRate.value = playOpts.pitch;
        node.connect(out);
        node.start();
        return {
          stop(): void {
            try {
              node.stop();
            } catch {
              // Already stopped.
            }
          },
        };
      }

      return source.render(ctx, out);
    },

    stop(handle: PlayHandle): void {
      handle.stop();
    },

    setMuted(channel: AudioChannel, muted: boolean): void {
      mixer.setMuted(channel, muted);
      apply(channel);
    },

    isMuted(channel: AudioChannel): boolean {
      return mixer.isMuted(channel);
    },

    setVolume(channel: AudioChannel, volume: number, ms?: number): void {
      mixer.setVolume(channel, volume);
      apply(channel, ms);
    },

    getVolume(channel: AudioChannel): number {
      return mixer.getVolume(channel);
    },

    duck(channel: AudioChannel, toGain: number, ms?: number): void {
      mixer.duck(channel, toGain);
      apply(channel, ms);
    },

    unduck(channel: AudioChannel, ms?: number): void {
      mixer.unduck(channel);
      apply(channel, ms);
    },

    effectiveGain(channel: AudioChannel): number {
      return mixer.effectiveGain(channel);
    },

    async unlock(): Promise<void> {
      // iOS/WKWebView starts the context suspended; resume on first gesture.
      // Idempotent — a no-op once already running.
      if (ctx.state === 'suspended') await ctx.resume();
    },

    suspend(): void {
      void Promise.resolve(ctx.suspend()).catch(() => {
        // Lifecycle suspend is best-effort; a failure must not throw at
        // the call site (games call this from visibilitychange handlers).
      });
    },

    resume(): Promise<void> {
      return ctx.resume();
    },

    master,
  };

  // Register the single built-in test voice so the bus is playable/demoable
  // in isolation and pilots have something to plug. The ONLY synth we ship.
  bus.register(TEST_SYNTH_ID, testSynth);

  return bus;
}
