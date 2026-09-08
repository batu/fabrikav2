import { describe, expect, it } from 'vitest';
import { createRevealPickupExperiment } from '../../src/data/revealPickupExperiment';
import { sanitizeCanonicalAnalyticsParams } from '../../src/analytics/CanonicalAnalyticsEvents';
import { designEvent, levelProgressionEvent } from '../../src/analytics/GameAnalyticsEvents';

describe('experiment exposure contract', () => {
  it('reports only a matching rendered treatment once per launch and tags return events', async () => {
    localStorage.clear();
    const exp = createRevealPickupExperiment();
    await exp.initialize({ enabled: true, platform: 'ios', durable: true, hadExistingState: false, storage: localStorage,
      initializeHints: () => { localStorage.setItem('ftd_hints', '10'); return true; },
      resolver: { initialize: async (experimentId) => {
        localStorage.setItem(`ftd_cohort_${experimentId}`, JSON.stringify({ experimentId, bucket: 50 }));
        return 50;
      } },
    });
    expect(exp.exposure('classic')).toBeNull();
    const exposure = exp.exposure('restoration');
    expect(exposure).toMatchObject({ experiment_id: 'ftd_ios_reveal_pickup_v1', variant: 'pickup', actual_mode: 'restoration', starting_hints: 10 });
    expect(exp.exposure('restoration')).toBeNull();
    for (const name of ['session_start', 'app_open', 'level_complete', 'experiment_exposure']) {
      expect(sanitizeCanonicalAnalyticsParams(name, exp.params())).toMatchObject({ variant: 'pickup', experiment_id: 'ftd_ios_reveal_pickup_v1' });
    }
    expect(designEvent('experiment:exposure', exposure!).customFields).toMatchObject({ variant: 'pickup', actual_mode: 'restoration' });
    expect(levelProgressionEvent('complete', 'l1', 10, exp.params()).customFields).toMatchObject({ variant: 'pickup' });
  });
});
