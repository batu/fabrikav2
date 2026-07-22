import { beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('achievement unlock completion callout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPresentedAchievementOccurrencesForTests();
    allocateAchievementViewEvent.mockImplementation(({ achievementId }) => ({ achievementId }));
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({ matches: false })) });
  });

  it('waits for the canonical reward reveal and adds no interactive control', async () => {
    const { root, abort } = fixture();
    attachAchievementUnlockCallout(root, delta(), abort.signal);
    expect(root.querySelector('.achievement-unlock-callout')).toBeNull();

    root.dataset.rewardReveal = 'complete';
    await Promise.resolve();
    const callout = root.querySelector('.achievement-unlock-callout');
    expect(callout?.textContent).toContain('First Find');
    expect(callout?.querySelector('button, a')).toBeNull();
    expect(hapticFound).toHaveBeenCalledTimes(1);
    expect(playUITap).toHaveBeenCalledTimes(1);
  });

  it('collapses multiple unlocks, announces every name, and dispatches canonical views', async () => {
    const { root, abort } = fixture();
    attachAchievementUnlockCallout(root, delta('occ-many', ['First Find', 'Sharp Eyes', 'Level Expert']), abort.signal);
    root.dataset.rewardReveal = 'complete';
    await Promise.resolve();
    const callout = root.querySelector<HTMLElement>('.achievement-unlock-callout')!;
    expect(callout.textContent).toContain('First Find and 2 more');
    expect(callout.getAttribute('aria-label')).toContain('First Find, Sharp Eyes, Level Expert');
    expect(allocateAchievementViewEvent).toHaveBeenCalledTimes(3);
    expect(dispatchAchievementEvent).toHaveBeenCalledTimes(3);
  });

  it('presents a live occurrence once across competing observers and skips empty deltas', async () => {
    const first = fixture();
    attachAchievementUnlockCallout(first.root, delta(), first.abort.signal);
    attachAchievementUnlockCallout(first.root, delta(), first.abort.signal);
    first.root.dataset.rewardReveal = 'complete';
    await Promise.resolve();
    expect(first.root.querySelectorAll('.achievement-unlock-callout')).toHaveLength(1);

    const second = fixture();
    attachAchievementUnlockCallout(second.root, delta(), second.abort.signal);
    second.root.dataset.rewardReveal = 'complete';
    await Promise.resolve();
    expect(second.root.querySelector('.achievement-unlock-callout')).toBeNull();
    expect(attachAchievementUnlockCallout(second.root, { ...delta('empty'), newlyUnlocked: [] }, second.abort.signal)).toBeNull();
  });

  it('disconnects on dismissal without consuming a pending occurrence', async () => {
    const first = fixture();
    attachAchievementUnlockCallout(first.root, delta(), first.abort.signal);
    first.abort.abort();
    first.root.dataset.rewardReveal = 'complete';
    await Promise.resolve();
    expect(first.root.querySelector('.achievement-unlock-callout')).toBeNull();

    const second = fixture();
    attachAchievementUnlockCallout(second.root, delta(), second.abort.signal);
    second.root.dataset.rewardReveal = 'complete';
    await Promise.resolve();
    expect(second.root.querySelector('.achievement-unlock-callout')).not.toBeNull();
  });

  it('keeps reduced-motion content while suppressing decorative animation', async () => {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({ matches: true })) });
    const { root, abort } = fixture();
    attachAchievementUnlockCallout(root, delta(), abort.signal);
    root.dataset.rewardReveal = 'complete';
    await Promise.resolve();
    expect(root.querySelector<HTMLElement>('.achievement-unlock-callout')?.dataset.motion).toBe('reduced');
  });
});
