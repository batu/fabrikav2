import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const rc = vi.hoisted(() => ({
  enabled: false, killed: false, platform: 'ios',
  initAndWait: vi.fn(async (): Promise<void> => undefined),
}));
vi.mock('../../src/sdk/SdkContext', () => ({ getSdkContext: vi.fn() }));
vi.mock('../../src/config/RemoteConfigService', () => ({ remoteConfigService: {
  initAndWait: rc.initAndWait,
  value: (key: string) => key === 'revealPickupExperimentEnabled' ? rc.enabled : rc.killed,
} }));
vi.mock('@capacitor/core', async (importOriginal) => ({
  ...await importOriginal<typeof import('@capacitor/core')>(),
  Capacitor: { isNativePlatform: () => rc.platform !== 'web', getPlatform: () => rc.platform },
}));

describe('production experiment preparation', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    rc.enabled = false;
    rc.killed = false;
    rc.platform = 'ios';
    rc.initAndWait.mockReset().mockResolvedValue(undefined);
  });
  it.each(['android', 'web'])('does not add an iOS experiment config wait to %s startup', async (platform) => {
    rc.platform = platform;
    const { initializeGameplayExperiment } = await import('../../src/data/initializeGameplayExperiment');
    await initializeGameplayExperiment(false, 'durable');
    expect(rc.initAndWait).not.toHaveBeenCalled();
    expect((await import('../../src/data/revealPickupExperiment')).revealPickupExperiment.assignment()).toBeNull();
  });
  it('awaits remote config, initializes the real wallet, and forces shared home/game policy', async () => {
    let release!: () => void;
    rc.initAndWait.mockImplementation(() => new Promise<void>((resolve) => { release = resolve; }));
    const { initializeGameplayExperiment } = await import('../../src/data/initializeGameplayExperiment');
    const { revealPickupExperiment } = await import('../../src/data/revealPickupExperiment');
    const { gameState } = await import('../../src/core/GameState');
    const pending = initializeGameplayExperiment(false, 'durable');
    expect(revealPickupExperiment.assignment()).toBeNull();
    expect(gameState.hintsRemaining).toBe(3);
    rc.enabled = true;
    release();
    await pending;
    expect(gameState.hintsRemaining).toBe(10);
    const { resolveGameplayMode } = await import('../../src/config/gameplayModePolicy');
    const expectedMode = revealPickupExperiment.assignment()?.variant === 'pickup' ? 'restoration' : 'classic';
    expect(resolveGameplayMode('classic', 'classic')).toBe(expectedMode);
    expect(resolveGameplayMode('restoration', 'restoration')).toBe(expectedMode);
    rc.enabled = false;
    rc.killed = true;
    expect(resolveGameplayMode('player', 'classic')).toBe(expectedMode);
  });
  afterEach(() => vi.useRealTimers());

  it.each(['resolve', 'reject'] as const)('bounds hung config startup at 5000ms without enrollment on late %s', async (settlement) => {
    vi.useFakeTimers();
    let release!: () => void;
    rc.enabled = true; // Even a cached enable cannot enroll on a timed-out startup.
    rc.initAndWait.mockImplementation(() => new Promise<void>((resolve, reject) => {
      release = () => settlement === 'resolve' ? resolve() : reject(new Error('late config failure'));
    }));
    const { initializeGameplayExperiment } = await import('../../src/data/initializeGameplayExperiment');
    const { revealPickupExperiment } = await import('../../src/data/revealPickupExperiment');
    const { gameState } = await import('../../src/core/GameState');
    let finished = false;
    const pending = initializeGameplayExperiment(false, 'durable').then(() => { finished = true; });
    await vi.advanceTimersByTimeAsync(4999);
    expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(finished).toBe(true);
    await pending;
    expect(revealPickupExperiment.assignment()).toBeNull();
    expect(localStorage.getItem('ftd_reveal_pickup_v1')).toBeNull();
    expect(gameState.hintsRemaining).toBe(3);
    expect(vi.getTimerCount()).toBe(0);

    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(revealPickupExperiment.assignment()).toBeNull();
    expect(localStorage.getItem('ftd_reveal_pickup_v1')).toBeNull();
    expect(gameState.hintsRemaining).toBe(3);
  });

  it.each(['reject', 'throw'] as const)('continues without enrollment when config startup fails by %s', async (failure) => {
    vi.useFakeTimers();
    rc.enabled = true;
    rc.initAndWait.mockImplementation(() => {
      if (failure === 'throw') throw new Error('config startup failed');
      return Promise.reject(new Error('config startup failed'));
    });
    const { initializeGameplayExperiment } = await import('../../src/data/initializeGameplayExperiment');
    await expect(initializeGameplayExperiment(false, 'durable')).resolves.toBeUndefined();
    expect((await import('../../src/data/revealPickupExperiment')).revealPickupExperiment.assignment()).toBeNull();
    expect((await import('../../src/core/GameState')).gameState.hintsRemaining).toBe(3);
    expect(localStorage.getItem('ftd_reveal_pickup_v1')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ['timeout', 'assignment'], ['timeout', 'cached-kill'], ['timeout', 'durable-kill'],
    ['reject', 'assignment'], ['reject', 'cached-kill'], ['reject', 'durable-kill'],
  ] as const)('uses safe launch state after config %s with %s', async (failure, state) => {
    vi.useFakeTimers();
    const assignment = {
      experimentId: 'ftd_ios_reveal_pickup_v1', variant: 'pickup', bucket: 75,
      enrolledDay: '2026-09-01', population: 'production',
    };
    const record = state === 'durable-kill' ? 'killed' : JSON.stringify(assignment);
    localStorage.setItem('ftd_reveal_pickup_v1', record);
    localStorage.setItem('ftd_hints', '7');
    rc.enabled = true;
    let release!: () => void;
    rc.initAndWait.mockImplementation(() => failure === 'reject'
      ? Promise.reject(new Error('config unavailable'))
      : new Promise<void>((resolve) => { release = resolve; }));
    const { initializeGameplayExperiment } = await import('../../src/data/initializeGameplayExperiment');
    const { revealPickupExperiment } = await import('../../src/data/revealPickupExperiment');
    const { gameState } = await import('../../src/core/GameState');
    let outcome = 'pending';
    const pending = initializeGameplayExperiment(true, 'durable').then(
      () => { outcome = 'resolved'; }, () => { outcome = 'rejected'; },
    );
    // A kill that becomes available during startup must win at the deadline.
    rc.killed = state === 'cached-kill';
    await vi.advanceTimersByTimeAsync(failure === 'timeout' ? 5000 : 0);
    expect(outcome).toBe('resolved');
    await pending;
    const expected = state === 'assignment' ? assignment : null;
    expect(revealPickupExperiment.assignment()).toEqual(expected);
    expect(localStorage.getItem('ftd_reveal_pickup_v1')).toBe(state === 'assignment' ? record : 'killed');
    expect(gameState.hintsRemaining).toBe(7);
    expect(vi.getTimerCount()).toBe(0);

    // Late fresh config cannot kill restored participation or resurrect a kill.
    rc.killed = state === 'assignment';
    rc.enabled = true;
    if (failure === 'timeout') release();
    await vi.advanceTimersByTimeAsync(0);
    expect(revealPickupExperiment.assignment()).toEqual(expected);
    expect(revealPickupExperiment.mode('classic')).toBe(state === 'assignment' ? 'restoration' : 'classic');
    expect(localStorage.getItem('ftd_reveal_pickup_v1')).toBe(state === 'assignment' ? record : 'killed');
    expect(gameState.hintsRemaining).toBe(7);
  });

  it('clears the startup deadline after timely config success', async () => {
    vi.useFakeTimers();
    const { initializeGameplayExperiment } = await import('../../src/data/initializeGameplayExperiment');
    await initializeGameplayExperiment(false, 'durable');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ships default-off without granting hints or enrolling', async () => {
    const { initializeGameplayExperiment } = await import('../../src/data/initializeGameplayExperiment');
    await initializeGameplayExperiment(false, 'durable');
    expect((await import('../../src/data/revealPickupExperiment')).revealPickupExperiment.assignment()).toBeNull();
    expect((await import('../../src/core/GameState')).gameState.hintsRemaining).toBe(3);
  });
});
