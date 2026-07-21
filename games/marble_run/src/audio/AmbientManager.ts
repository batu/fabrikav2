import { ensureAudioUnlocked, getAudioContext, getMusicOutput, resumeAudioForLifecycle } from './AudioManager';
import { gameState } from '../core/GameState';
import { hasUserActivated } from '../platform/browserScheduling';
import { registerLifecycleHooks } from '../platform/gameLifecycle';

/**
 * Background music and ambient loops. Routed through the music bus so
 * the settings modal can mute music independently from sound effects.
 * Each preset is built on demand, gets crossfaded in, and its own
 * cleanup callback tears down its event generators when replaced.
 */

interface ActivePreset {
  key: string;
  outGain: GainNode;
  cleanup: () => void;
}

type PresetBuilder = (ctx: AudioContext) => { outGain: GainNode; cleanup: () => void };

let active: ActivePreset | null = null;
let desiredPresetKey: string | null = null;
let desiredFadeMs = 500;
let ambientUnlockArmed = false;
let wasActiveBeforeLifecycleSuspend = false;
const DEFAULT_BACKGROUND_PRESET = 'background_music';
const BACKGROUND_MUSIC_URL = '/audio/background-music.mp3';
let backgroundMusicBufferPromise: Promise<AudioBuffer> | null = null;

function loadBackgroundMusicBuffer(ctx: AudioContext): Promise<AudioBuffer> {
  backgroundMusicBufferPromise ??= fetch(BACKGROUND_MUSIC_URL)
    .then((response: Response): Promise<ArrayBuffer> => {
      // iOS Capacitor serves app assets from the capacitor://localhost custom
      // scheme, whose handler returns status 0 (not 200) even on success — so
      // response.ok is false despite valid bytes. Only treat a *real* HTTP
      // error status as a failure; status 0 is an accepted local response.
      if (!response.ok && response.status !== 0) {
        throw new Error(`Failed to load background music: ${response.status}`);
      }
      return response.arrayBuffer();
    })
    .then((data: ArrayBuffer): Promise<AudioBuffer> => ctx.decodeAudioData(data))
    .catch((error: unknown): never => {
      // Clear the memo so a later crossfade can retry rather than being
      // permanently silent after one transient load/decode failure.
      backgroundMusicBufferPromise = null;
      throw error;
    });

  return backgroundMusicBufferPromise;
}

// ---- Small helpers for preset graphs ----

function createNoiseSource(ctx: AudioContext, type: 'white' | 'pink' | 'brown'): AudioBufferSourceNode {
  const sampleRate = ctx.sampleRate;
  // 4-second buffer is plenty — loop=true keeps it seamless.
  const bufferSize = sampleRate * 4;
  const buffer = ctx.createBuffer(1, bufferSize, sampleRate);
  const data = buffer.getChannelData(0);

  if (type === 'white') {
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
  } else if (type === 'pink') {
    // Paul Kellet's refined pink noise approximation.
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    }
  } else {
    // brown / red noise — heavily low-shelved
    let last = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
  }

  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  src.start();
  return src;
}

function scheduleEvery(ms: number, jitter: number, fn: () => void): () => void {
  // Recursive setTimeout gives us jitter without a second timer.
  let cancelled = false;
  const tick = (): void => {
    if (cancelled) return;
    fn();
    const delay = ms + (Math.random() * 2 - 1) * jitter;
    window.setTimeout(tick, Math.max(100, delay));
  };
  window.setTimeout(tick, ms);
  return () => {
    cancelled = true;
  };
}

function oneShotTone(
  ctx: AudioContext,
  dest: AudioNode,
  freq: number,
  type: OscillatorType,
  duration: number,
  gain: number,
): void {
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, now);
  env.gain.linearRampToValueAtTime(gain, now + 0.01);
  env.gain.exponentialRampToValueAtTime(0.001, now + duration);
  osc.connect(env);
  env.connect(dest);
  osc.start(now);
  osc.stop(now + duration);
}

function oneShotNoise(
  ctx: AudioContext,
  dest: AudioNode,
  duration: number,
  gain: number,
  lpfFreq: number,
): void {
  const now = ctx.currentTime;
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * duration);
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filt = ctx.createBiquadFilter();
  filt.type = 'lowpass';
  filt.frequency.value = lpfFreq;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, now);
  env.gain.linearRampToValueAtTime(gain, now + 0.02);
  env.gain.exponentialRampToValueAtTime(0.001, now + duration);
  src.connect(filt);
  filt.connect(env);
  env.connect(dest);
  src.start(now);
  src.stop(now + duration);
}

// ---- Preset builders ----

const buildMorningMarket: PresetBuilder = (ctx) => {
  const out = ctx.createGain();
  out.gain.value = 0.45;

  const bed = ctx.createGain();
  bed.gain.value = 0.15;
  const noise = createNoiseSource(ctx, 'pink');
  const filt = ctx.createBiquadFilter();
  filt.type = 'lowpass';
  filt.frequency.value = 1200;
  noise.connect(filt);
  filt.connect(bed);
  bed.connect(out);

  const cancelBirds = scheduleEvery(2000, 1200, () => {
    // 2-3 quick chirps
    const base = 2500 + Math.random() * 1500;
    const chirps = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < chirps; i++) {
      window.setTimeout(() => {
        oneShotTone(ctx, out, base + i * 150, 'triangle', 0.09, 0.08);
      }, i * 90);
    }
  });

  return {
    outGain: out,
    cleanup: () => {
      cancelBirds();
      noise.stop();
    },
  };
};

const buildTempleGarden: PresetBuilder = (ctx) => {
  const out = ctx.createGain();
  out.gain.value = 0.5;

  const bed = ctx.createGain();
  bed.gain.value = 0.12;
  const noise = createNoiseSource(ctx, 'brown');
  const filt = ctx.createBiquadFilter();
  filt.type = 'lowpass';
  filt.frequency.value = 800;
  noise.connect(filt);
  filt.connect(bed);
  bed.connect(out);

  const cancelChimes = scheduleEvery(5500, 2500, () => {
    // bell: fundamental + 3rd harmonic, long decay
    const fund = 900 + Math.random() * 700;
    oneShotTone(ctx, out, fund, 'sine', 1.6, 0.06);
    oneShotTone(ctx, out, fund * 2.76, 'sine', 1.4, 0.03);
  });

  return {
    outGain: out,
    cleanup: () => {
      cancelChimes();
      noise.stop();
    },
  };
};

const buildRiverBridge: PresetBuilder = (ctx) => {
  const out = ctx.createGain();
  out.gain.value = 0.5;

  // Water bed: brown noise modulated slowly for lapping feel.
  const noise = createNoiseSource(ctx, 'brown');
  const filt = ctx.createBiquadFilter();
  filt.type = 'lowpass';
  filt.frequency.value = 600;
  const bedGain = ctx.createGain();
  bedGain.gain.value = 0.2;

  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.3;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 0.1;
  lfo.connect(lfoGain);
  lfoGain.connect(bedGain.gain);
  lfo.start();

  noise.connect(filt);
  filt.connect(bedGain);
  bedGain.connect(out);

  const cancelMurmur = scheduleEvery(3500, 1500, () => {
    oneShotNoise(ctx, out, 0.35, 0.035, 500);
  });

  return {
    outGain: out,
    cleanup: () => {
      cancelMurmur();
      noise.stop();
      lfo.stop();
    },
  };
};

const buildFestivalGrounds: PresetBuilder = (ctx) => {
  const out = ctx.createGain();
  out.gain.value = 0.4;

  // Crowd bed
  const noise = createNoiseSource(ctx, 'pink');
  const filt = ctx.createBiquadFilter();
  filt.type = 'bandpass';
  filt.frequency.value = 900;
  filt.Q.value = 0.5;
  const bedGain = ctx.createGain();
  bedGain.gain.value = 0.12;
  noise.connect(filt);
  filt.connect(bedGain);
  bedGain.connect(out);

  // Low drone — festive pulse
  const drone = ctx.createOscillator();
  drone.type = 'sine';
  drone.frequency.value = 80;
  const droneGain = ctx.createGain();
  droneGain.gain.value = 0.05;
  drone.connect(droneGain);
  droneGain.connect(out);
  drone.start();

  const cancelDrum = scheduleEvery(900, 250, () => {
    // taiko thump: low sine, short punchy envelope
    const f = 110 + Math.random() * 30;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f * 1.6, now);
    osc.frequency.exponentialRampToValueAtTime(f, now + 0.08);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.18, now);
    env.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc.connect(env);
    env.connect(out);
    osc.start(now);
    osc.stop(now + 0.4);
  });

  return {
    outGain: out,
    cleanup: () => {
      cancelDrum();
      noise.stop();
      drone.stop();
    },
  };
};

const buildNightHarbor: PresetBuilder = (ctx) => {
  const out = ctx.createGain();
  out.gain.value = 0.45;

  // Wave bed — slow-modulated brown noise
  const noise = createNoiseSource(ctx, 'brown');
  const filt = ctx.createBiquadFilter();
  filt.type = 'lowpass';
  filt.frequency.value = 450;
  const bedGain = ctx.createGain();
  bedGain.gain.value = 0.22;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.15;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 0.12;
  lfo.connect(lfoGain);
  lfoGain.connect(bedGain.gain);
  lfo.start();
  noise.connect(filt);
  filt.connect(bedGain);
  bedGain.connect(out);

  const cancelCrickets = scheduleEvery(4000, 2000, () => {
    // chirps: 4-8 rapid high-freq blips
    const n = 4 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      window.setTimeout(() => {
        oneShotTone(ctx, out, 4800 + Math.random() * 600, 'triangle', 0.04, 0.05);
      }, i * 55);
    }
  });

  return {
    outGain: out,
    cleanup: () => {
      cancelCrickets();
      noise.stop();
      lfo.stop();
    },
  };
};

const buildBackgroundMusic: PresetBuilder = (ctx) => {
  const out = ctx.createGain();
  out.gain.value = 0.32;
  let source: AudioBufferSourceNode | null = null;
  let cancelled = false;

  // Wait for the iOS unlock as well as the decode — a buffer source started
  // on a suspended context never produces sound on iOS WKWebView, and this
  // preset is built at scene load, before the first user gesture.
  void Promise.all([loadBackgroundMusicBuffer(ctx), ensureAudioUnlocked()])
    .then(([buffer]: [AudioBuffer, void]): void => {
      if (cancelled) return;
      source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.connect(out);
      source.start();
    })
    .catch((error: unknown): void => {
      console.error('[audio] background music unavailable', error);
    });

  return {
    outGain: out,
    cleanup: () => {
      cancelled = true;
      if (source !== null) {
        source.stop();
        source.disconnect();
      }
    },
  };
};

const BUILDERS: Record<string, PresetBuilder> = {
  background_music: buildBackgroundMusic,
  morning_market: buildMorningMarket,
  temple_garden: buildTempleGarden,
  river_bridge: buildRiverBridge,
  festival_grounds: buildFestivalGrounds,
  night_harbor: buildNightHarbor,
};

registerLifecycleHooks('ambient-manager', {
  onSuspend: (): void => {
    wasActiveBeforeLifecycleSuspend = active !== null;
    if (wasActiveBeforeLifecycleSuspend) stopAmbient();
  },
  onResume: (): void => {
    if (!wasActiveBeforeLifecycleSuspend) return;
    wasActiveBeforeLifecycleSuspend = false;
    void resumeAudioForLifecycle().then((resumed): void => {
      if (!resumed) {
        wasActiveBeforeLifecycleSuspend = true;
        return;
      }
      syncAmbientMusicPreference();
    });
  },
});

/** Map level.name (from level.json) → preset key. */
export function presetForLevel(_levelName: string): string | null {
  return DEFAULT_BACKGROUND_PRESET;
}

function fadeOutActive(ms: number): void {
  if (!active) return;

  const ctx = getAudioContext();
  const now = ctx.currentTime;
  const ramp = ms / 1000;
  const old = active;

  old.outGain.gain.cancelScheduledValues(now);
  old.outGain.gain.setValueAtTime(old.outGain.gain.value, now);
  old.outGain.gain.linearRampToValueAtTime(0, now + ramp);
  window.setTimeout(() => {
    old.cleanup();
    try {
      old.outGain.disconnect();
    } catch {
      // already detached
    }
  }, ms + 50);
  active = null;
}

function applyCrossfade(key: string | null, ms: number): void {
  const ctx = getAudioContext();
  const master = getMusicOutput();
  const now = ctx.currentTime;
  const ramp = ms / 1000;

  // No-op if already on the same preset.
  if (active && active.key === key) return;

  // Fade out and cleanup the old preset.
  fadeOutActive(ms);

  if (!key) return;

  const builder = BUILDERS[key];
  if (!builder) return;

  const { outGain, cleanup } = builder(ctx);
  outGain.connect(master);
  const target = outGain.gain.value;
  outGain.gain.setValueAtTime(0, now);
  outGain.gain.linearRampToValueAtTime(target, now + ramp);
  active = { key, outGain, cleanup };
}

function armAmbientUnlock(): void {
  if (ambientUnlockArmed) return;
  ambientUnlockArmed = true;

  const unlock = (): void => {
    ambientUnlockArmed = false;
    window.removeEventListener('pointerdown', unlock, { capture: true });
    window.removeEventListener('keydown', unlock, { capture: true });
    // This gesture IS the user activation the autoplay gate was waiting for, so
    // start the pending ambient now. Without this the crossfade requested while
    // gated (e.g. home BGM scheduled before the first tap) would stay armed
    // forever and the menu would be silent. Defer past ensureAudioUnlocked() so
    // the AudioContext is actually running before a builder might start a source
    // synchronously (background_music already awaits unlock internally; this keeps the
    // path correct for any future synthesized home preset). desiredPresetKey is
    // re-read at resolve time, so it reflects the most recent requested preset.
    void ensureAudioUnlocked().then((): void => {
      if (gameState.settings.musicOn && desiredPresetKey !== null) {
        applyCrossfade(desiredPresetKey, desiredFadeMs);
      }
    });
  };

  window.addEventListener('pointerdown', unlock, { capture: true, passive: true });
  window.addEventListener('keydown', unlock, { capture: true });
}

/** Crossfade to a new preset (or silence if key is null). 500ms default ramp. */
export function crossfadeTo(key: string | null, ms: number = 500): void {
  desiredPresetKey = key;
  desiredFadeMs = ms;

  if (!gameState.settings.musicOn) {
    fadeOutActive(ms);
    return;
  }

  if (active === null && !hasUserActivated()) {
    armAmbientUnlock();
    return;
  }

  applyCrossfade(key, ms);
}

export function syncAmbientMusicPreference(): void {
  if (gameState.settings.musicOn) {
    if (!desiredPresetKey) return;
    if (active === null && !hasUserActivated()) {
      armAmbientUnlock();
      return;
    }
    applyCrossfade(desiredPresetKey, desiredFadeMs);
    return;
  }

  fadeOutActive(250);
}

/** Hard stop (no fade). Used on app teardown or scene shutdown. */
export function stopAmbient(): void {
  if (!active) return;
  active.cleanup();
  try {
    active.outGain.disconnect();
  } catch {
    // already detached
  }
  active = null;
}

/** Test-only: snapshot the active preset key + current outGain value. */
export function __ambientDebugSnapshot(): { key: string | null; outGain: number; ctxState: string } {
  return {
    key: active ? active.key : null,
    outGain: active ? active.outGain.gain.value : 0,
    ctxState: getAudioContext().state,
  };
}
