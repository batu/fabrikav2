import { describe, expect, it, vi } from 'vitest';
import {
  createAudioBus,
  TEST_SYNTH_ID,
  type AudioSource,
} from './bus.ts';

/**
 * Minimal Web Audio stub — Node/vitest has no `AudioContext`, so the bus is
 * exercised over these fakes (the gain math itself is proven in mixer.test).
 * Every created node records enough to assert wiring and applied gains.
 */
interface FakeParam {
  value: number;
  setValueAtTime: ReturnType<typeof vi.fn>;
  linearRampToValueAtTime: ReturnType<typeof vi.fn>;
  cancelScheduledValues: ReturnType<typeof vi.fn>;
}

function fakeParam(value = 1): FakeParam {
  return {
    value,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
  };
}

interface FakeNode {
  gain?: FakeParam;
  connect: ReturnType<typeof vi.fn>;
  connectedTo: unknown[];
}

function makeFakeContext() {
  const gainNodes: FakeNode[] = [];
  const oscillators: FakeNode[] = [];
  const bufferSources: FakeNode[] = [];

  const node = (extra: Record<string, unknown> = {}): FakeNode => {
    const connectedTo: unknown[] = [];
    return {
      connectedTo,
      connect: vi.fn((target: unknown) => connectedTo.push(target)),
      ...extra,
    } as FakeNode;
  };

  const ctx = {
    destination: { id: 'destination' },
    currentTime: 0,
    state: 'suspended' as AudioContextState,
    createGain: vi.fn(() => {
      const g = node({ gain: fakeParam() });
      gainNodes.push(g);
      return g;
    }),
    createOscillator: vi.fn(() => {
      const o = node({ frequency: { value: 0 }, start: vi.fn(), stop: vi.fn() });
      oscillators.push(o);
      return o;
    }),
    createBufferSource: vi.fn(() => {
      const s = node({
        buffer: null,
        loop: false,
        playbackRate: { value: 1 },
        start: vi.fn(),
        stop: vi.fn(),
      });
      bufferSources.push(s);
      return s;
    }),
    suspend: vi.fn(async () => {
      ctx.state = 'suspended';
    }),
    resume: vi.fn(async () => {
      ctx.state = 'running';
    }),
  };

  return { ctx, gainNodes, oscillators, bufferSources };
}

function busOverFake() {
  const fake = makeFakeContext();
  const bus = createAudioBus({ context: fake.ctx as unknown as AudioContext });
  // createGain call order: master(0), music(1), sfx(2).
  const master = fake.gainNodes[0];
  const music = fake.gainNodes[1];
  const sfx = fake.gainNodes[2];
  return { bus, fake, master, music, sfx };
}

describe('createAudioBus — graph wiring', () => {
  it('routes channels through master into destination', () => {
    const { bus, fake, master, music, sfx } = busOverFake();
    expect(bus.master).toBe(master);
    expect(master.connectedTo).toContain(fake.ctx.destination);
    expect(music.connectedTo).toContain(master);
    expect(sfx.connectedTo).toContain(master);
  });

  it('seeds channel gain nodes to their initial effective gain (1)', () => {
    const { music, sfx } = busOverFake();
    expect(music.gain?.value).toBe(1);
    expect(sfx.gain?.value).toBe(1);
  });
});

describe('createAudioBus — state applied to gain nodes', () => {
  it('setVolume without ms writes the effective gain immediately', () => {
    const { bus, music } = busOverFake();
    bus.setVolume('music', 0.5);
    expect(bus.effectiveGain('music')).toBe(0.5);
    expect(music.gain?.value).toBe(0.5);
  });

  it('setMuted forces the node to 0 and back', () => {
    const { bus, sfx } = busOverFake();
    bus.setVolume('sfx', 0.8);
    bus.setMuted('sfx', true);
    expect(sfx.gain?.value).toBe(0);
    expect(bus.isMuted('sfx')).toBe(true);
    bus.setMuted('sfx', false);
    expect(sfx.gain?.value).toBe(0.8);
  });

  it('duck/unduck are depth-counted at the node level', () => {
    const { bus, music } = busOverFake();
    bus.duck('music', 0);
    bus.duck('music', 0);
    expect(music.gain?.value).toBe(0);
    bus.unduck('music');
    expect(music.gain?.value).toBe(0); // still ducked (depth 1)
    bus.unduck('music');
    expect(music.gain?.value).toBe(1); // restored
  });

  it('setVolume with ms schedules a linear ramp instead of a jump', () => {
    const { bus, music } = busOverFake();
    bus.setVolume('music', 0.25, 200);
    expect(music.gain?.linearRampToValueAtTime).toHaveBeenCalledWith(0.25, 0.2);
    expect(music.gain?.cancelScheduledValues).toHaveBeenCalled();
  });
});

describe('createAudioBus — playback', () => {
  it('throws on an unregistered id', () => {
    const { bus } = busOverFake();
    expect(() => bus.play('nope')).toThrow(/unknown source id/);
  });

  it('plays a registered voice, routing it to the requested channel node', () => {
    const { bus, fake, music } = busOverFake();
    const stop = vi.fn();
    const render = vi.fn(() => ({ stop }));
    const voice: AudioSource = { kind: 'voice', render };
    bus.register('cue', voice);

    const handle = bus.play('cue', { channel: 'music' });
    expect(render).toHaveBeenCalledWith(fake.ctx, music);
    handle.stop();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('plays a clip with pitch + loop into the sfx channel by default', () => {
    const { bus, fake, sfx } = busOverFake();
    const buffer = { id: 'buf' } as unknown as AudioBuffer;
    bus.register('pop', { kind: 'clip', buffer });

    bus.play('pop', { pitch: 1.5, loop: true });
    const src = fake.bufferSources[0];
    expect(src.connectedTo).toContain(sfx);
    expect((src as unknown as { buffer: unknown }).buffer).toBe(buffer);
    expect((src as unknown as { loop: boolean }).loop).toBe(true);
    expect((src as unknown as { playbackRate: { value: number } }).playbackRate.value).toBe(1.5);
    expect((src as unknown as { start: ReturnType<typeof vi.fn> }).start).toHaveBeenCalled();
  });

  it('ships exactly one built-in test synth, playable in isolation', () => {
    const { bus, fake } = busOverFake();
    const handle = bus.play(TEST_SYNTH_ID);
    expect(fake.oscillators.length).toBe(1);
    expect((fake.oscillators[0] as unknown as { start: ReturnType<typeof vi.fn> }).start).toHaveBeenCalled();
    handle.stop();
    expect((fake.oscillators[0] as unknown as { stop: ReturnType<typeof vi.fn> }).stop).toHaveBeenCalled();
  });
});

describe('createAudioBus — context lifecycle', () => {
  it('unlock resumes a suspended context and is idempotent', async () => {
    const { bus, fake } = busOverFake();
    expect(fake.ctx.state).toBe('suspended');
    await bus.unlock();
    expect(fake.ctx.resume).toHaveBeenCalledTimes(1);
    expect(fake.ctx.state).toBe('running');
    await bus.unlock(); // already running → no second resume
    expect(fake.ctx.resume).toHaveBeenCalledTimes(1);
  });

  it('suspend is best-effort and never throws at the call site', () => {
    const { bus, fake } = busOverFake();
    fake.ctx.suspend.mockRejectedValueOnce(new Error('lifecycle'));
    expect(() => bus.suspend()).not.toThrow();
  });
});
