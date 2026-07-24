import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const { allocateAchievementViewEvent, dispatchAchievementEvent } = vi.hoisted(() => ({
  allocateAchievementViewEvent: vi.fn(),
  dispatchAchievementEvent: vi.fn(),
}));

vi.mock('../../src/core/GameState', () => ({ gameState: { allocateAchievementViewEvent } }));
vi.mock('../../src/analytics/AnalyticsService', () => ({ analytics: { dispatchAchievementEvent } }));

import {
  resetPresentedAchievementOccurrencesForTests,
  showAchievementUnlockToast,
} from '../../src/ui/AchievementToast';

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

});
