import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommittedAchievementDelta } from '../../src/achievements/AchievementSystem';

const { allocateAchievementViewEvent, dispatchAchievementEvent } = vi.hoisted(() => ({
  allocateAchievementViewEvent: vi.fn(),
  dispatchAchievementEvent: vi.fn(),
}));

vi.mock('../../src/core/GameState', () => ({ gameState: { allocateAchievementViewEvent } }));
vi.mock('../../src/analytics/AnalyticsService', () => ({ analytics: { dispatchAchievementEvent } }));

import {
  presentAchievementUnlocks,
  resetPresentedAchievementOccurrencesForTests,
} from '../../src/ui/AchievementToast';
import { remoteConfigService } from '../../src/config/RemoteConfigService';

function delta(id = 'occ-1', names = ['First Find']): CommittedAchievementDelta {
  return {
    occurrenceId: id,
    progressChanges: [],
    masteredLevelIdsAdded: [],
    rewards: [],
    newlyUnlocked: names.map((name, order) => ({
      id: `achievement-${order}`,
      name,
      description: 'Description',
      category: 'completion',
      milestoneKind: 'occurrence-count',
      threshold: 1,
      progressSource: 'totalCompletions',
      order,
      entitledReward: { coins: 0, hints: 0 },
    })),
  };
}

describe('presentAchievementUnlocks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
    resetPresentedAchievementOccurrencesForTests();
    remoteConfigService.setValuesForTest({ achievementsEnabled: true });
    allocateAchievementViewEvent.mockImplementation(({ achievementId }) => ({ achievementId }));
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({ matches: false })) });
  });

  it('shows nothing and dispatches nothing while achievementsEnabled is off (the default)', () => {
    remoteConfigService.setValuesForTest({ achievementsEnabled: false });
    presentAchievementUnlocks(delta('occ-off', ['First Find']));
    expect(document.getElementById('achievement-unlock-toast')).toBeNull();
    expect(dispatchAchievementEvent).not.toHaveBeenCalled();
    // The occurrence is not consumed: flipping the flag on later still presents it.
    remoteConfigService.setValuesForTest({ achievementsEnabled: true });
    presentAchievementUnlocks(delta('occ-off', ['First Find']));
    expect(document.getElementById('achievement-unlock-toast')).not.toBeNull();
  });

  it('shows the toast immediately and dispatches a canonical view per unlock', () => {
    presentAchievementUnlocks(delta('occ-many', ['First Find', 'Sharp Eyes', 'Dog Expert']));
    const toast = document.getElementById('achievement-unlock-toast')!;
    expect(toast.textContent).toContain('First Find +2 more unlocked!');
    expect(toast.getAttribute('aria-label')).toContain('First Find, Sharp Eyes, Dog Expert');
    expect(allocateAchievementViewEvent).toHaveBeenCalledTimes(3);
    expect(dispatchAchievementEvent).toHaveBeenCalledTimes(3);
  });

  it('presents each occurrence once and skips empty or missing deltas', () => {
    presentAchievementUnlocks(delta());
    document.getElementById('achievement-unlock-toast')!.remove();
    presentAchievementUnlocks(delta());
    expect(document.getElementById('achievement-unlock-toast')).toBeNull();
    expect(allocateAchievementViewEvent).toHaveBeenCalledTimes(1);

    presentAchievementUnlocks({ ...delta('empty'), newlyUnlocked: [] });
    presentAchievementUnlocks(null);
    presentAchievementUnlocks(undefined);
    expect(document.getElementById('achievement-unlock-toast')).toBeNull();
  });

  it('still shows the toast when a view event cannot be allocated', () => {
    allocateAchievementViewEvent.mockReturnValue(null);
    presentAchievementUnlocks(delta());
    expect(document.getElementById('achievement-unlock-toast')).not.toBeNull();
    expect(dispatchAchievementEvent).not.toHaveBeenCalled();
  });
});
