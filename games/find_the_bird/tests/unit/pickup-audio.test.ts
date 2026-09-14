import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/core/GameState', () => ({ gameState: { settings: { musicOn: true, soundEffectsOn: true } } }));
vi.mock('../../src/platform/gameLifecycle', () => ({ registerLifecycleHooks: vi.fn() }));

const sources: { buffer: unknown; playbackRate: { value: number }; start: ReturnType<typeof vi.fn>; connect: ReturnType<typeof vi.fn> }[] = [];
const gainNodes: { gain: { value: number }; connect: ReturnType<typeof vi.fn> }[] = [];
const buffers = Array.from({ length: 10 }, (_, id) => ({ id }));
let failedSamples = new Set<number>();

class TestAudioContext {
  state = 'running';
  sampleRate = 44100;
  currentTime = 1;
  destination = {};
  resume = vi.fn(async () => { this.state = 'running'; });
  suspend = vi.fn(async () => { this.state = 'suspended'; });
  createBuffer = vi.fn(() => ({ unlock: true }));
  decodeAudioData = vi.fn(async (data: ArrayBuffer) => buffers[new Uint8Array(data)[0]]);
  createBufferSource() {
    const source = { buffer: null as unknown, playbackRate: { value: 1 }, start: vi.fn(), connect: vi.fn() };
    sources.push(source);
    return source;
  }
  createGain() {
    const node = { gain: { value: 1 }, connect: vi.fn() };
    gainNodes.push(node);
    return node;
  }
}

async function setup() {
  const audio = await import('../../src/audio/AudioManager');
  audio.installAudioUnlock();
  document.dispatchEvent(new Event('pointerdown'));
  await audio.preloadBirdFoundSounds();
  sources.length = 0; // Exclude the synchronous silent unlock buffer.
  return audio;
}

async function pickup(audio: Awaited<ReturnType<typeof setup>>) {
  audio.playFind();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('actual pickup audio path', () => {
  beforeEach(() => {
    vi.resetModules();
    sources.length = 0;
    gainNodes.length = 0;
    failedSamples = new Set();
    vi.stubGlobal('AudioContext', TestAudioContext);
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const id = Number(url.match(/bird-found-(\d+)/)![1]) - 1;
      if (failedSamples.has(id)) throw new Error('sample unavailable');
      return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([id]).buffer };
    }));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('uses every sample once per bag and never repeats across a boundary', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const audio = await setup();
    for (let i = 0; i < 30; i++) await pickup(audio);
    const picked = sources.map((source) => source.buffer);
    for (let i = 0; i < 30; i += 10) expect(new Set(picked.slice(i, i + 10)).size).toBe(10);
    for (let i = 1; i < picked.length; i++) expect(picked[i]).not.toBe(picked[i - 1]);
  });

  it('keeps the bag across subsequent level preloads', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const audio = await setup();
    for (let i = 0; i < 5; i++) await pickup(audio);
    await audio.preloadBirdFoundSounds();
    for (let i = 0; i < 5; i++) await pickup(audio);
    expect(new Set(sources.map((source) => source.buffer)).size).toBe(10);
    expect(fetch).toHaveBeenCalledTimes(10);
  });

  it('draws a new independent rate for each playback, including equal draws', async () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const audio = await setup();
    await pickup(audio); // Refill the bag; subsequent draws only select a rate.
    for (const draw of [0, 0.999999, 0.25, 0.25]) {
      random.mockReturnValue(draw);
      const before = random.mock.calls.length;
      await pickup(audio);
      expect(random.mock.calls.length - before).toBe(1);
      expect(sources.at(-1)!.playbackRate.value).toBeCloseTo(0.8 + draw * 0.4);
    }
  });

  it('plays surviving samples when others fail, including a one-sample bag', async () => {
    failedSamples = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    const audio = await setup();
    await pickup(audio);
    await pickup(audio);
    expect(sources.map((source) => source.buffer)).toEqual([buffers[9], buffers[9]]);
  });

  it('handles no available sounds and retries a later preload', async () => {
    failedSamples = new Set(buffers.map((_, id) => id));
    const audio = await setup();
    await pickup(audio);
    expect(sources).toHaveLength(0);
    failedSamples.clear();
    await audio.preloadBirdFoundSounds();
    await pickup(audio);
    expect(sources).toHaveLength(1);
  });

  it('keeps pickup routing through effects and master mute during nested ads', async () => {
    const audio = await setup();
    await pickup(audio);
    const effects = audio.getSoundEffectsOutput();
    const master = audio.getMasterOutput();
    audio.setSoundEffectsEnabled(false);
    audio.setMusicPausedForAd(true);
    audio.setMusicPausedForAd(true);
    await pickup(audio);
    expect(effects.gain.value).toBe(0);
    expect(master.gain.value).toBe(0);
    expect(sources.at(-1)!.connect).toHaveBeenCalledWith(effects);
    audio.setMusicPausedForAd(false);
    expect(master.gain.value).toBe(0);
    audio.setMusicPausedForAd(false);
    expect(master.gain.value).toBe(1);
    expect(effects.gain.value).toBe(0);
    audio.setSoundEffectsEnabled(true);
    expect(effects.gain.value).toBe(1);
  });
});
