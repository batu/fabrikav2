import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { CommittedAchievementDelta } from '../../src/achievements/AchievementSystem';

const { allocateAchievementViewEvent, dispatchAchievementEvent, hapticFound, playUITap } = vi.hoisted(() => ({
  allocateAchievementViewEvent: vi.fn(),
  dispatchAchievementEvent: vi.fn(),
  hapticFound: vi.fn(),
  playUITap: vi.fn(),
}));

vi.mock('../../src/core/GameState', () => ({ gameState: { allocateAchievementViewEvent } }));
vi.mock('../../src/analytics/AnalyticsService', () => ({ analytics: { dispatchAchievementEvent } }));
vi.mock('../../src/haptics/HapticsManager', () => ({ hapticFound }));
vi.mock('../../src/audio/AudioManager', () => ({ playLevelComplete: vi.fn(), playUITap }));
vi.mock('../../src/core/ScaffoldEvents', () => ({ scaffoldEvents: { emit: vi.fn() } }));
vi.mock('../../src/ui/RatePrompt', () => ({ showRatePromptWithHandle: vi.fn() }));
vi.mock('../../src/ui/EconomyTransfer', () => ({ animateCoinsToBalance: vi.fn() }));
vi.mock('../../src/ui/SceneTransitionCover', () => ({ showSceneTransitionCover: vi.fn() }));

import {
  attachAchievementUnlockCallout,
  resetPresentedAchievementOccurrencesForTests,
} from '../../src/ui/LevelCompleteOverlay';
import { showAchievementUnlockToast } from '../../src/ui/AchievementToast';

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

function fixture(): { root: HTMLElement; abort: AbortController } {
  document.body.innerHTML = '<div id="level-complete-overlay" data-reward-reveal="pending"><section class="fab-complete-card"><div class="fab-complete-actions"></div></section></div>';
  return {
    root: document.getElementById('level-complete-overlay')!,
    abort: new AbortController(),
  };
}

describe('achievement unlock toast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    resetPresentedAchievementOccurrencesForTests();
    allocateAchievementViewEvent.mockImplementation(({ achievementId }) => ({ achievementId }));
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({ matches: false })) });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('announces a single unlock as a non-interactive status toast', () => {
    showAchievementUnlockToast([{ name: 'First Find' }]);
    const toast = document.getElementById('achievement-unlock-toast')!;
    expect(toast.getAttribute('role')).toBe('status');
    expect(toast.textContent).toContain('First Find unlocked!');
    expect(toast.querySelector('button, a')).toBeNull();
  });

  it('collapses multiple unlocks and exposes every name to assistive tech', () => {
    showAchievementUnlockToast([{ name: 'First Find' }, { name: 'Sharp Eyes' }]);
    const toast = document.getElementById('achievement-unlock-toast')!;
    expect(toast.textContent).toContain('First Find +1 more unlocked!');
    expect(toast.getAttribute('aria-label')).toContain('Sharp Eyes');
  });

  it('auto-dismisses after its visible window', () => {
    showAchievementUnlockToast([{ name: 'First Find' }]);
    expect(document.getElementById('achievement-unlock-toast')).not.toBeNull();
    vi.advanceTimersByTime(6000);
    expect(document.getElementById('achievement-unlock-toast')).toBeNull();
  });

  it('shows nothing for an empty unlock set', () => {
    showAchievementUnlockToast([]);
    expect(document.getElementById('achievement-unlock-toast')).toBeNull();
  });

  it('fires on completion-overlay dismissal, not alongside the callout, and never replays', async () => {
    const { root, abort } = fixture();
    attachAchievementUnlockCallout(root, delta(), abort.signal);
    root.dataset.rewardReveal = 'complete';
    await Promise.resolve();
    // While the in-card callout is visible there is no simultaneous toast.
    expect(root.querySelector('.achievement-unlock-callout')).not.toBeNull();
    expect(document.getElementById('achievement-unlock-toast')).toBeNull();

    abort.abort();
    expect(document.getElementById('achievement-unlock-toast')).not.toBeNull();

    vi.advanceTimersByTime(6000);
    expect(document.getElementById('achievement-unlock-toast')).toBeNull();

    const again = fixture();
    attachAchievementUnlockCallout(again.root, delta(), again.abort.signal);
    again.root.dataset.rewardReveal = 'complete';
    await Promise.resolve();
    again.abort.abort();
    expect(document.getElementById('achievement-unlock-toast')).toBeNull();
  });
});
