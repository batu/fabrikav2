import { gameState } from '../core/GameState';
import { registerLifecycleHooks } from '../platform/gameLifecycle';

let ac: AudioContext | null = null;
let masterGain: GainNode | null = null;
let musicGain: GainNode | null = null;
let soundEffectsGain: GainNode | null = null;
let adMusicPauseDepth = 0;
let lifecycleHookRegistered = false;
let buttonVoiceListenerInstalled = false;
let lastUiTapAt = 0;
let uiVoiceIndex = 0;
// Remember whether the user had audio running before the tab went
// background, so we only resume() on return if we were actually playing
// \u2014 don't auto-start audio on a fresh page load that never had it.
let wasRunningBeforeHide = false;

function createAudioContext(): AudioContext {
  try {
    return new AudioContext({ latencyHint: 'playback' });
  } catch {
    return new AudioContext();
  }
}

function registerAudioLifecycleHook(): void {
  if (lifecycleHookRegistered) return;
  lifecycleHookRegistered = true;
  registerLifecycleHooks('audio-manager', {
    onSuspend: suspendAudioForLifecycle,
    onResume: resumeAudioForLifecycle,
  });
}

export function suspendAudioForLifecycle(): void {
  if (!ac) return;
  wasRunningBeforeHide = ac.state === 'running';
  if (wasRunningBeforeHide) {
    void ac.suspend().catch((err: unknown): void => {
      console.warn('[audio] lifecycle suspend failed', err);
    });
  }
}

export async function resumeAudioForLifecycle(): Promise<boolean> {
  if (!ac || !wasRunningBeforeHide) return true;
  try {
    await ac.resume();
    wasRunningBeforeHide = false;
    return true;
  } catch (err: unknown) {
    console.warn('[audio] lifecycle resume failed', err);
    return false;
  }
}

export function getAudioContext(): AudioContext {
  if (!ac) {
    ac = createAudioContext();
    registerAudioLifecycleHook();
  }
  return ac;
}

export function getMasterOutput(): GainNode {
  const ctx = getAudioContext();
  if (!masterGain) {
    masterGain = ctx.createGain();
    masterGain.connect(ctx.destination);
    masterGain.gain.value = effectiveMasterGain();
  }
  return masterGain;
}

export function getMusicOutput(): GainNode {
  const ctx = getAudioContext();
  if (!musicGain) {
    musicGain = ctx.createGain();
    musicGain.connect(getMasterOutput());
    musicGain.gain.value = effectiveMusicGain();
  }
  return musicGain;
}

export function getSoundEffectsOutput(): GainNode {
  const ctx = getAudioContext();
  if (!soundEffectsGain) {
    soundEffectsGain = ctx.createGain();
    soundEffectsGain.connect(getMasterOutput());
    soundEffectsGain.gain.value = gameState.settings.soundEffectsOn ? 1 : 0;
  }
  return soundEffectsGain;
}

// ---- One-time iOS Web Audio unlock ----
// iOS WKWebView starts the AudioContext suspended and will not play buffer
// sources that were started while suspended — and a buffer source started
// outside the synchronous user-gesture window stays silent even after a later
// resume(). resume() alone is unreliable for buffer playback; the canonical
// unlock is to resume AND start a 1-sample silent buffer synchronously inside
// the first user gesture. Every file-backed sound (background music, bird-found
// samples) awaits ensureAudioUnlocked() before calling source.start(), so it
// never starts on a suspended context. Synthesized SFX don't need this — they
// start synchronously inside their own gesture handlers.
let audioUnlocked = false;
let resolveUnlock: (() => void) | null = null;
let unlockPromise: Promise<void> | null = null;
let unlockListenersInstalled = false;

/** Resolves once the AudioContext has been unlocked by a user gesture.
 *  Resolves immediately if the unlock already happened. */
export function ensureAudioUnlocked(): Promise<void> {
  if (audioUnlocked) return Promise.resolve();
  unlockPromise ??= new Promise<void>((resolve): void => {
    resolveUnlock = resolve;
  });
  return unlockPromise;
}

function unlockAudio(): void {
  if (audioUnlocked) return;
  const ctx = getAudioContext();
  void ctx.resume();
  // Silent 1-sample buffer started in-gesture: the reliable iOS unlock.
  const buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start(0);
  audioUnlocked = true;
  resolveUnlock?.();
  resolveUnlock = null;
}

/** Install one-shot listeners that unlock Web Audio on the first user gesture.
 *  Idempotent; the listeners remove themselves after the first unlock. */
export function installAudioUnlock(): void {
  if (unlockListenersInstalled) return;
  unlockListenersInstalled = true;
  const handler = (): void => {
    unlockAudio();
    document.removeEventListener('pointerdown', handler, true);
    document.removeEventListener('touchend', handler, true);
    document.removeEventListener('keydown', handler, true);
  };
  document.addEventListener('pointerdown', handler, { capture: true, passive: true });
  document.addEventListener('touchend', handler, { capture: true, passive: true });
  document.addEventListener('keydown', handler, { capture: true });
}

// ---- Bird-found samples ----
// Ten short bird chirp/whistle one-shots (chirp, peep, whistle, tweet, warble,
// quick pair, song note, two-note, double). Consume a shuffled bag before
// refilling, with an independent playback rate in [0.8, 1.2] on every pickup.
// Buffers and selection state survive level changes for this app launch.
const BIRD_FOUND_SAMPLE_COUNT = 10;
const BIRD_FOUND_GAIN = 0.125;
const BIRD_FOUND_SAMPLE_URLS: string[] = Array.from(
  { length: BIRD_FOUND_SAMPLE_COUNT },
  (_, i): string => `/audio/bird-found/bird-found-${i + 1}.wav`,
);
let birdFoundBuffersPromise: Promise<AudioBuffer[]> | null = null;
let birdFoundBag: AudioBuffer[] = [];
let lastBirdFoundBuffer: AudioBuffer | undefined;

function nextBirdFoundBuffer(buffers: readonly AudioBuffer[]): AudioBuffer | undefined {
  if (birdFoundBag.length === 0) {
    birdFoundBag = [...buffers];
    for (let i = birdFoundBag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [birdFoundBag[i], birdFoundBag[j]] = [birdFoundBag[j], birdFoundBag[i]];
    }
    const last = birdFoundBag.length - 1;
    if (last > 0 && birdFoundBag[last] === lastBirdFoundBuffer) {
      [birdFoundBag[0], birdFoundBag[last]] = [birdFoundBag[last], birdFoundBag[0]];
    }
  }
  const buffer = birdFoundBag.pop();
  if (buffer) lastBirdFoundBuffer = buffer;
  return buffer;
}

/** Fetch + decode every bird-found sample once. Safe to call repeatedly —
 *  the work is memoized. Kick this off when a level loads so buffers are
 *  ready by the time the player taps a bird. */
export function preloadBirdFoundSounds(): Promise<AudioBuffer[]> {
  const ctx = getAudioContext();
  birdFoundBuffersPromise ??= Promise.allSettled(
    BIRD_FOUND_SAMPLE_URLS.map((url: string): Promise<AudioBuffer> =>
      fetch(url)
        .then((response: Response): Promise<ArrayBuffer> => {
          // iOS Capacitor serves app assets from the capacitor://localhost
          // custom scheme, whose handler returns status 0 (not 200) on success
          // — so response.ok is false despite valid bytes. Only a real HTTP
          // error status counts as a failure; status 0 is an accepted local
          // response. (Android uses https / web uses http, both real 200s.)
          if (!response.ok && response.status !== 0) {
            throw new Error(`Failed to load bird-found sound: ${response.status}`);
          }
          return response.arrayBuffer();
        })
        .then((data: ArrayBuffer): Promise<AudioBuffer> => ctx.decodeAudioData(data)),
    ),
  ).then((results): AudioBuffer[] => {
    const buffers: AudioBuffer[] = [];
    for (const result of results) {
      if (result.status === 'fulfilled') buffers.push(result.value);
      else console.warn('[audio] bird-found sample unavailable', result.reason);
    }
    // Keep usable samples if only some assets fail. If none loaded, allow a
    // later preload/pickup to retry without rejecting a fire-and-forget preload.
    if (buffers.length === 0) birdFoundBuffersPromise = null;
    return buffers;
  });
  return birdFoundBuffersPromise;
}

// ---- Meta-page one-shots (Collection claim, nest-box build, bird placed) ----
// Same rules as the bird-found samples: fetched and decoded once per launch,
// started only after the iOS unlock, status 0 accepted from capacitor://.
const META_SFX = {
  claim: '/audio/meta/collection-claim.wav',
  build: '/audio/meta/house-build.wav',
  place: '/audio/meta/bird-place.wav',
} as const;
type MetaSfx = keyof typeof META_SFX;
const META_SFX_GAIN: Record<MetaSfx, number> = { claim: 0.45, build: 0.5, place: 0.4 };
const metaSfxBuffers = new Map<MetaSfx, Promise<AudioBuffer>>();

function loadMetaSfx(name: MetaSfx): Promise<AudioBuffer> {
  const ctx = getAudioContext();
  let pending = metaSfxBuffers.get(name);
  if (pending === undefined) {
    pending = fetch(META_SFX[name])
      .then((response: Response): Promise<ArrayBuffer> => {
        if (!response.ok && response.status !== 0) {
          throw new Error(`Failed to load ${name} sound: ${response.status}`);
        }
        return response.arrayBuffer();
      })
      .then((data: ArrayBuffer): Promise<AudioBuffer> => ctx.decodeAudioData(data));
    // A failed fetch may retry on the next play rather than staying broken.
    pending.catch((): void => { metaSfxBuffers.delete(name); });
    metaSfxBuffers.set(name, pending);
  }
  return pending;
}

/** Warm the meta one-shots so the first claim or build is not late. */
export function preloadMetaSounds(): void {
  for (const name of Object.keys(META_SFX) as MetaSfx[]) {
    loadMetaSfx(name).catch((error: unknown): void => {
      console.warn('[audio] meta sample unavailable', name, error);
    });
  }
}

function playMetaSfx(name: MetaSfx, rate = 1): void {
  void Promise.all([ensureAudioUnlocked(), loadMetaSfx(name)])
    .then(([, buffer]: [void, AudioBuffer]): void => {
      const ctx = getAudioContext();
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = rate;
      const gain = ctx.createGain();
      gain.gain.value = META_SFX_GAIN[name];
      source.connect(gain);
      gain.connect(getSoundEffectsOutput());
      source.start(ctx.currentTime);
    })
    .catch((error: unknown): void => {
      console.error(`[audio] ${name} playback failed`, error);
    });
}

/** Sparkle chime when a Collection rung is claimed. */
export function playCollectionClaim(): void { playMetaSfx('claim'); }
/** Wooden set-down and ding when the nest box is built or upgraded. */
export function playHouseBuild(): void { playMetaSfx('build'); }
/** Flutter and peep when a bird lands on its perch. */
export function playBirdPlace(): void { playMetaSfx('place', 0.95 + Math.random() * 0.1); }

function playNotes(
  freqs: number[],
  type: OscillatorType,
  noteDuration: number,
  gap: number,
  gain: number = 0.25,
): void {
  const ctx = getAudioContext();
  const now = ctx.currentTime;

  for (let i = 0; i < freqs.length; i++) {
    const startTime = now + i * (noteDuration + gap);
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freqs[i];

    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, startTime);
    env.gain.exponentialRampToValueAtTime(0.001, startTime + noteDuration);

    osc.connect(env);
    env.connect(getSoundEffectsOutput());
    osc.start(startTime);
    osc.stop(startTime + noteDuration);
  }
}

function playNoise(
  duration: number,
  gain: number = 0.15,
  lpfFreq: number = 2000,
): void {
  const ctx = getAudioContext();
  const now = ctx.currentTime;
  const sampleRate = ctx.sampleRate;
  const bufferSize = Math.floor(sampleRate * duration);
  const buffer = ctx.createBuffer(1, bufferSize, sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }

  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const env = ctx.createGain();
  env.gain.setValueAtTime(gain, now);
  env.gain.exponentialRampToValueAtTime(0.001, now + duration);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = lpfFreq;

  source.connect(filter);
  filter.connect(env);
  env.connect(getSoundEffectsOutput());

  source.start(now);
  source.stop(now + duration);
}

function playVoiceBlip(): void {
  const ctx = getAudioContext();
  if (ctx.state === 'suspended') void ctx.resume();

  const now = ctx.currentTime;
  const variants = [
    { start: 420, end: 620, f1: 760, f2: 1320, duration: 0.085 },
    { start: 520, end: 390, f1: 690, f2: 1180, duration: 0.075 },
    { start: 470, end: 720, f1: 830, f2: 1480, duration: 0.09 },
    { start: 590, end: 510, f1: 720, f2: 1600, duration: 0.08 },
  ];
  const voice = variants[uiVoiceIndex % variants.length];
  uiVoiceIndex += 1;

  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(voice.start, now);
  osc.frequency.exponentialRampToValueAtTime(voice.end, now + voice.duration);

  const body = ctx.createGain();
  body.gain.setValueAtTime(0, now);
  body.gain.linearRampToValueAtTime(0.055, now + 0.01);
  body.gain.exponentialRampToValueAtTime(0.001, now + voice.duration);

  const formantA = ctx.createBiquadFilter();
  formantA.type = 'bandpass';
  formantA.frequency.value = voice.f1;
  formantA.Q.value = 5;

  const formantB = ctx.createBiquadFilter();
  formantB.type = 'bandpass';
  formantB.frequency.value = voice.f2;
  formantB.Q.value = 7;

  osc.connect(formantA);
  osc.connect(formantB);
  formantA.connect(body);
  formantB.connect(body);
  body.connect(getSoundEffectsOutput());

  osc.start(now);
  osc.stop(now + voice.duration + 0.02);
}

export function playFind(): void {
  // Play the next shuffled chirp with an independent playback rate in
  // [0.8, 1.2] so repeated pickups vary in pitch. Wait for both the unlock
  // and the decoded buffers before start() — on iOS a buffer source started
  // on a suspended context never produces sound. Both promises resolve
  // instantly in steady state. Surface load/decode failures instead of
  // swallowing them.
  void Promise.all([ensureAudioUnlocked(), preloadBirdFoundSounds()])
    .then(([, buffers]: [void, AudioBuffer[]]): void => {
      const ctx = getAudioContext();
      const buffer = nextBirdFoundBuffer(buffers);
      if (!buffer) return;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = 0.8 + Math.random() * 0.4;
      // Chirps at half level (Batu, 2026-09-16 device review: too loud next
      // to the pickup).
      const chirpGain = ctx.createGain();
      chirpGain.gain.value = BIRD_FOUND_GAIN;
      source.connect(chirpGain);
      chirpGain.connect(getSoundEffectsOutput());
      source.start(ctx.currentTime);
    })
    .catch((error: unknown): void => {
      console.error('[audio] bird-found playback failed', error);
    });
}

export function playWrongTap(): void {
  // Soft descending two-note "nuh-uh" boop — a playful "not there" rather than
  // a punishing thud. Triangle waves at low gain keep it gentle, and the whole
  // cue is shorter and quieter than playFind so a miss feels lighter than a find.
  playNotes([392, 294], 'triangle', 0.1, 0.035, 0.16);
}

export function playLevelComplete(): void {
  playNotes([523, 659, 784, 1047], 'triangle', 0.12, 0.06, 0.3);
}

export function playLevelFail(): void {
  const ctx = getAudioContext();
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(330, now);
  osc.frequency.exponentialRampToValueAtTime(110, now + 0.4);

  const env = ctx.createGain();
  env.gain.setValueAtTime(0.2, now);
  env.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(2000, now);
  filter.frequency.exponentialRampToValueAtTime(200, now + 0.4);

  osc.connect(filter);
  filter.connect(env);
  env.connect(getSoundEffectsOutput());
  osc.start(now);
  osc.stop(now + 0.4);
}

export function playHint(): void {
  playNoise(0.3, 0.15, 3000);
}

export function playUITap(): void {
  const now = performance.now();
  if (now - lastUiTapAt < 45) return;
  lastUiTapAt = now;
  playVoiceBlip();
}

export function installButtonVoiceEffects(): void {
  if (buttonVoiceListenerInstalled) return;
  buttonVoiceListenerInstalled = true;
  document.addEventListener(
    'pointerup',
    (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest('button');
      if (!(button instanceof HTMLButtonElement)) return;
      if (button.disabled || button.getAttribute('aria-disabled') === 'true') return;
      playUITap();
    },
    { capture: true, passive: true },
  );
}

export function mute(): void {
  setMusicEnabled(false);
  setSoundEffectsEnabled(false);
}

export function unmute(): void {
  setMusicEnabled(true);
  setSoundEffectsEnabled(true);
}

function effectiveMusicGain(enabled: boolean = gameState.settings.musicOn): number {
  return enabled && adMusicPauseDepth === 0 ? 1 : 0;
}

function effectiveMasterGain(): number {
  return adMusicPauseDepth === 0 ? 1 : 0;
}

export function setMusicEnabled(enabled: boolean): void {
  if (!enabled && musicGain === null) return;
  getMusicOutput().gain.value = effectiveMusicGain(enabled);
}

/**
 * Silence ALL game audio (master bus) while a full-screen ad is up.
 * Music-only muting wasn't enough: the next level's intro SFX and UI
 * jingles route through the sound-effects bus and were audible over
 * the ad. The depth counter tolerates overlapping ad lifecycles.
 */
export function setMusicPausedForAd(paused: boolean): void {
  adMusicPauseDepth = paused ? adMusicPauseDepth + 1 : Math.max(0, adMusicPauseDepth - 1);
  if (musicGain !== null) {
    musicGain.gain.value = effectiveMusicGain();
  }
  if (masterGain !== null) {
    masterGain.gain.value = effectiveMasterGain();
  }
}

export function setSoundEffectsEnabled(enabled: boolean): void {
  if (!enabled && soundEffectsGain === null) return;
  getSoundEffectsOutput().gain.value = enabled ? 1 : 0;
}
