import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRevealPickupExperiment } from '../../src/data/revealPickupExperiment';
import { createCohortResolver } from '../../src/v1core/assets';
import { GameState } from '../../src/core/GameState';

function options(bucket = 0) {
  return { enabled: true, platform: 'ios', durable: true, hadExistingState: false,
    storage: localStorage, initializeHints: () => new GameState().initializeExperimentHints(),
    resolver: { initialize: vi.fn(async (experimentId: string) => {
      localStorage.setItem(`ftd_cohort_${experimentId}`, JSON.stringify({ experimentId, bucket }));
      return bucket;
    }) },
  };
}
describe('reveal pickup experiment', () => {
  beforeEach(() => localStorage.clear());
  it('assigns with the existing resolver and the actual wallet', async () => {
    const state = new GameState();
    const experiment = createRevealPickupExperiment();
    const assignment = await experiment.initialize({ ...options(), resolver: createCohortResolver(),
      initializeHints: () => state.initializeExperimentHints() });
    expect(assignment?.variant).toMatch(/^(reveal|pickup)$/);
    expect(state.hintsRemaining).toBe(10);
    expect(experiment.mode('classic')).toBe(assignment?.variant === 'pickup' ? 'restoration' : 'classic');
  });
  it.each(['garbage', '{}', '{"variant":"pickup"}'])('fails closed on corrupt enrollment %s', async (raw) => {
    localStorage.setItem('ftd_reveal_pickup_v1', raw);
    const exp = createRevealPickupExperiment();
    expect(await exp.initialize(options())).toBeNull();
    expect(exp.mode('classic')).toBe('classic');
  });
  it.each([-1, 100, 0.5, NaN])('rejects invalid resolver bucket %s before wallet mutation', async (bucket) => {
    expect(await createRevealPickupExperiment().initialize(options(bucket))).toBeNull();
    expect(localStorage.getItem('ftd_hints')).toBeNull();
  });
  it('does not trust a bucket that failed persistence', async () => {
    const opts = options();
    opts.resolver.initialize = vi.fn(async () => 0);
    expect(await createRevealPickupExperiment().initialize(opts)).toBeNull();
    expect(localStorage.getItem('ftd_hints')).toBeNull();
  });
  it.each([[0, 'reveal'], [49, 'reveal'], [50, 'pickup'], [99, 'pickup']] as const)(
    'splits bucket %s to %s and preserves it offline without a second grant', async (bucket, variant) => {
      const opts = options(bucket);
      const first = createRevealPickupExperiment();
      const assigned = await first.initialize(opts);
      expect(assigned?.variant).toBe(variant);
      localStorage.setItem('ftd_hints', '7');
      const relaunch = createRevealPickupExperiment();
      const grant = vi.fn(() => false);
      expect(await relaunch.initialize({ ...options(99 - bucket), enabled: false, hadExistingState: true, initializeHints: grant })).toEqual(assigned);
      expect(grant).not.toHaveBeenCalled();
      expect(localStorage.getItem('ftd_hints')).toBe('7');
      expect(await first.initialize({ ...opts, killed: true })).toEqual(assigned);
    },
  );
  it('fails closed on missing returning enrollment even when the old cohort key survives', async () => {
    const opts = options();
    await createRevealPickupExperiment().initialize(opts);
    localStorage.removeItem('ftd_reveal_pickup_v1');
    localStorage.setItem('ftd_hints', '4');
    expect(await createRevealPickupExperiment().initialize({ ...opts, hadExistingState: true })).toBeNull();
    expect(localStorage.getItem('ftd_hints')).toBe('4');
  });
  it('fails closed on a silent persistence failure and never grants', async () => {
    const opts = options();
    const initializeHints = vi.fn(() => true);
    expect(await createRevealPickupExperiment().initialize({ ...opts, initializeHints,
      storage: { getItem: () => null, setItem: () => undefined },
    })).toBeNull();
    expect(initializeHints).not.toHaveBeenCalled();
  });
  it.each(['throws', 'drops'] as const)('never re-enrolls or regrants when the final enrollment write %s after the real grant', async (failure) => {
    const recordKey = 'ftd_reveal_pickup_v1';
    const cohortKey = 'ftd_cohort_ftd_ios_reveal_pickup_v1';
    const opts = options(50);
    const wallet = new GameState();
    const initializeHints = vi.fn(() => wallet.initializeExperimentHints());
    const writes: string[] = [];
    const commitSnapshots: unknown[] = [];
    const storage = {
      getItem: (key: string) => localStorage.getItem(key),
      setItem: (key: string, value: string) => {
        writes.push(value);
        if (key === recordKey && value !== 'pending') {
          // Fault only the commit: both preparation records and the real grant survived.
          // Assert outside the callback: initialize intentionally catches errors.
          commitSnapshots.push({
            record: localStorage.getItem(recordKey),
            cohort: localStorage.getItem(cohortKey),
            balance: wallet.hintsRemaining,
            persistedBalance: localStorage.getItem('ftd_hints'),
          });
          if (failure === 'throws') throw new Error('enrollment commit failed');
          return;
        }
        localStorage.setItem(key, value);
      },
    };
    const first = createRevealPickupExperiment();
    expect(await first.initialize({ ...opts, storage, initializeHints })).toBeNull();
    expect(commitSnapshots).toEqual([{
      record: 'pending',
      cohort: JSON.stringify({ experimentId: 'ftd_ios_reveal_pickup_v1', bucket: 50 }),
      balance: 10, persistedBalance: '10',
    }]);
    expect(writes).toHaveLength(2);
    expect(JSON.parse(writes[1]!)).toMatchObject({ variant: 'pickup', bucket: 50 });
    expect(initializeHints).toHaveBeenCalledTimes(1);
    expect(initializeHints).toHaveReturnedWith(true);
    expect(opts.resolver.initialize).toHaveBeenCalledTimes(1);
    expect(first.assignment()).toBeNull();
    expect(first.exposure('restoration')).toBeNull();
    expect(localStorage.getItem(recordKey)).toBe('pending');
    const cohort = localStorage.getItem(cohortKey);
    expect(new GameState().hintsRemaining).toBe(10);
    expect(wallet.spendHint('gameplayHint')).toBe(true);
    const survivor = new GameState();
    expect(survivor.hintsRemaining).toBe(9);
    const retry = options(0);
    const retryGrant = vi.fn(() => survivor.initializeExperimentHints());
    const relaunch = createRevealPickupExperiment();
    // Even stale fresh-install evidence must not replay a partial enrollment.
    expect(await relaunch.initialize({ ...retry, initializeHints: retryGrant })).toBeNull();
    expect(retry.resolver.initialize).not.toHaveBeenCalled();
    expect(retryGrant).not.toHaveBeenCalled();
    expect(relaunch.assignment()).toBeNull();
    expect(relaunch.params()).toEqual({});
    expect(relaunch.exposure('restoration')).toBeNull();
    expect(relaunch.mode('classic')).toBe('classic');
    expect(localStorage.getItem(recordKey)).toBe('pending');
    expect(localStorage.getItem(cohortKey)).toBe(cohort);
    expect(localStorage.getItem('ftd_hints')).toBe('9');
    expect(new GameState().hintsRemaining).toBe(9);
  });
  it('fails closed on relaunch with pending and cohort surviving before the real wallet grant', async () => {
    const opts = options(50);
    const allocate = opts.resolver.initialize;
    opts.resolver.initialize = vi.fn(async (experimentId: string) => {
      await allocate(experimentId);
      throw new Error('interrupted after durable cohort, before wallet grant');
    });
    const wallet = new GameState();
    const grant = vi.fn(() => wallet.initializeExperimentHints());
    expect(await createRevealPickupExperiment().initialize({ ...opts, initializeHints: grant })).toBeNull();
    expect(allocate).toHaveBeenCalledTimes(1);
    expect(grant).not.toHaveBeenCalled();
    expect(localStorage.getItem('ftd_reveal_pickup_v1')).toBe('pending');
    const cohort = localStorage.getItem('ftd_cohort_ftd_ios_reveal_pickup_v1');
    expect(JSON.parse(cohort!)).toMatchObject({ bucket: 50 });
    expect(localStorage.getItem('ftd_hints')).toBeNull();
    const retry = options(0);
    const survivor = new GameState();
    const retryGrant = vi.fn(() => survivor.initializeExperimentHints());
    const relaunch = createRevealPickupExperiment();
    expect(await relaunch.initialize({ ...retry, initializeHints: retryGrant })).toBeNull();
    expect(retry.resolver.initialize).not.toHaveBeenCalled();
    expect(retryGrant).not.toHaveBeenCalled();
    expect(relaunch.assignment()).toBeNull();
    expect(relaunch.params()).toEqual({});
    expect(relaunch.exposure('restoration')).toBeNull();
    expect(localStorage.getItem('ftd_reveal_pickup_v1')).toBe('pending');
    expect(localStorage.getItem('ftd_cohort_ftd_ios_reveal_pickup_v1')).toBe(cohort);
    expect(localStorage.getItem('ftd_hints')).toBeNull();
    expect(survivor.hintsRemaining).toBe(wallet.hintsRemaining);
  });
  it('kills on the next launch, remains killed offline, and preserves the wallet', async () => {
    await createRevealPickupExperiment().initialize(options());
    localStorage.setItem('ftd_hints', '6');
    expect(await createRevealPickupExperiment().initialize({ ...options(), killed: true })).toBeNull();
    expect(await createRevealPickupExperiment().initialize({ ...options(), enabled: false })).toBeNull();
    expect(localStorage.getItem('ftd_hints')).toBe('6');
  });
  it('shares concurrent initialization and grants once', async () => {
    const opts = options();
    const exp = createRevealPickupExperiment();
    const [first, second] = await Promise.all([exp.initialize(opts), exp.initialize(opts)]);
    expect(first).toBe(second);
    expect(opts.resolver.initialize).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('ftd_hints')).toBe('10');
  });
  it('keeps QA out of production cohorts even on the same release binary', async () => {
    localStorage.setItem('ftd_reveal_pickup_qa', '1');
    const exp = createRevealPickupExperiment();
    await exp.initialize(options());
    expect(exp.params().experiment_population).toBe('qa');
    localStorage.removeItem('ftd_reveal_pickup_qa');
    const relaunch = createRevealPickupExperiment();
    await relaunch.initialize({ ...options(), hadExistingState: true });
    expect(relaunch.params().experiment_population).toBe('qa');
  });
  it.each([{ enabled: false }, { platform: 'android' }, { platform: 'web' }, { durable: false }, { hadExistingState: true }, { killed: true }])(
    'does not enroll excluded installs %j', async (override) => {
      const opts = { ...options(), ...override };
      expect(await createRevealPickupExperiment().initialize(opts)).toBeNull();
      expect(opts.resolver.initialize).not.toHaveBeenCalled();
      expect(localStorage.getItem('ftd_hints')).toBeNull();
    },
  );
});
