import { beforeEach, describe, expect, it, vi } from 'vitest';

// The HUD import chain reaches RemoteConfigService, which reads
// window.localStorage at module load — absent in this environment. Install a
// minimal in-memory polyfill before any module import executes.
vi.hoisted(() => {
  const m = new Map<string, string>();
  const storage = {
    getItem: (k: string): string | null => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k: string, v: string): void => void m.set(k, String(v)),
    removeItem: (k: string): void => void m.delete(k),
    clear: (): void => m.clear(),
    key: (i: number): string | null => [...m.keys()][i] ?? null,
    get length(): number {
      return m.size;
    },
  };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'localStorage', { configurable: true, value: storage });
  }
});

vi.mock('../../src/audio/AudioManager', () => ({
  playUITap: vi.fn(), playHint: vi.fn(), setMusicEnabled: vi.fn(), setSoundEffectsEnabled: vi.fn(),
}));

import { analytics } from '../../src/analytics/AnalyticsService';
import { gameState } from '../../src/core/GameState';
import { resetAchievementViewSessionForTest } from '../../src/ui/AchievementsPage';
import { closePage, openPage } from '../../src/ui/HUD';

describe('achievement collection page', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="hud-overlay"><button id="opener">Achievements</button><div id="home-shell"></div></div>';
    vi.restoreAllMocks();
    resetAchievementViewSessionForTest();
  });

  it('renders canonical order, explicit states, progress and reward meanings', () => {
    vi.spyOn(gameState, 'achievementReadProjection').mockReturnValue({
      status: 'ready',
      achievements: [
        { id: 'a', name: 'First', description: 'First description', category: 'completion', milestoneKind: 'occurrence-count', threshold: 1, progressSource: 'totalCompletions', order: 1, progress: 0, rewardStatus: 'locked' },
        { id: 'b', name: 'Second', description: 'Second description', category: 'collection', milestoneKind: 'occurrence-count', threshold: 10, progressSource: 'lifetimeDogs', order: 2, progress: 4, rewardStatus: 'in-progress' },
        { id: 'c', name: 'Third', description: 'Third description', category: 'completion', milestoneKind: 'occurrence-count', threshold: 2, progressSource: 'totalCompletions', order: 3, progress: 2, rewardStatus: 'migration-unlocked-reward-ineligible' },
      ],
    });
    const allocate = vi.spyOn(gameState, 'allocateAchievementViewEvent').mockReturnValue(null);

    openPage('achievements');

    expect([...document.querySelectorAll('.achievement-card')].map((node) => node.getAttribute('data-achievement-id'))).toEqual(['a', 'c', 'b']);
    expect(document.body.textContent).toContain('0/1');
    expect(document.body.textContent).toContain('4/10');
    // Locked/in-progress reward lines are chip duplicates and stay visual-only
    // in the aria-label; only differentiated reward copy renders as text.
    expect(document.body.textContent).not.toContain('Reward locked');
    expect(document.body.textContent).not.toContain('Reward in progress');
    expect(document.querySelector('[data-achievement-id="a"]')?.getAttribute('aria-label')).toContain('Reward locked');
    expect(document.body.textContent).toContain('reward not available');
    expect(document.querySelector('progress')?.getAttribute('aria-label')).toBe('First progress: 0 of 1');
    expect(allocate).toHaveBeenCalledTimes(4);
    closePage();
  });

  it.each([
    ['persistence-unavailable', 'saved progress is ready'],
    ['settlement-pending', 'updating'],
  ] as const)('renders honest %s state without analytics', (reason, copy) => {
    vi.spyOn(gameState, 'achievementReadProjection').mockReturnValue({ status: 'unavailable', reason });
    const allocate = vi.spyOn(gameState, 'allocateAchievementViewEvent');
    openPage('achievements');
    expect(document.querySelector('[role="status"]')?.textContent).toContain(copy);
    expect(allocate).not.toHaveBeenCalled();
    closePage();
  });

  it('dispatches allocated analytics events unchanged', () => {
    vi.spyOn(gameState, 'achievementReadProjection').mockReturnValue({
      status: 'ready', achievements: [{ id: 'a', name: 'First', description: 'Desc', category: 'completion', milestoneKind: 'occurrence-count', threshold: 1, progressSource: 'totalCompletions', order: 1, progress: 1, rewardStatus: 'live-reward-settled' }],
    });
    const pageEvent = { eventId: 'page', name: 'achievement_page_viewed', payload: { event_id: 'page' } } as const;
    const itemEvent = { eventId: 'item', name: 'achievement_viewed', payload: { event_id: 'item', achievement_id: 'a', occurrence_id: 'item', category: 'completion' } } as const;
    vi.spyOn(gameState, 'allocateAchievementViewEvent').mockReturnValueOnce(pageEvent).mockReturnValueOnce(itemEvent);
    const dispatch = vi.spyOn(analytics, 'dispatchAchievementEvent').mockImplementation(() => undefined);
    openPage('achievements');
    expect(dispatch.mock.calls).toEqual([[pageEvent], [itemEvent]]);
    closePage();
  });

  it('re-fires page views per open but dedupes per-achievement views within a session', () => {
    vi.spyOn(gameState, 'achievementReadProjection').mockReturnValue({
      status: 'ready', achievements: [{ id: 'a', name: 'First', description: 'Desc', category: 'completion', milestoneKind: 'occurrence-count', threshold: 1, progressSource: 'totalCompletions', order: 1, progress: 1, rewardStatus: 'live-reward-settled' }],
    });
    const itemEvent = { eventId: 'item', name: 'achievement_viewed', payload: { event_id: 'item', achievement_id: 'a', occurrence_id: 'item', category: 'completion' } } as const;
    const pageEvent = { eventId: 'page', name: 'achievement_page_viewed', payload: { event_id: 'page' } } as const;
    const allocate = vi.spyOn(gameState, 'allocateAchievementViewEvent').mockImplementation((request) =>
      request.name === 'achievement_page_viewed' ? pageEvent : itemEvent,
    );
    vi.spyOn(analytics, 'dispatchAchievementEvent').mockImplementation(() => undefined);

    openPage('achievements');
    closePage();
    document.getElementById('home-page-overlay')?.remove();
    openPage('achievements');

    const requested = allocate.mock.calls.map(([request]) => request.name);
    expect(requested.filter((name) => name === 'achievement_page_viewed')).toHaveLength(2);
    expect(requested.filter((name) => name === 'achievement_viewed')).toHaveLength(1);
    closePage();
  });
});
