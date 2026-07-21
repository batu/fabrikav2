import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/audio/AudioManager', () => ({
  playUITap: vi.fn(), playHint: vi.fn(), setMusicEnabled: vi.fn(), setSoundEffectsEnabled: vi.fn(),
}));

import { analytics } from '../../src/analytics/AnalyticsService';
import { gameState } from '../../src/core/GameState';
import { closePage, openPage } from '../../src/ui/HUD';

describe('achievement collection page', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="hud-overlay"><button id="opener">Achievements</button><div id="home-shell"></div></div>';
    vi.restoreAllMocks();
  });

  it('renders canonical order, explicit states, progress and reward meanings', () => {
    vi.spyOn(gameState, 'achievementReadProjection').mockReturnValue({
      status: 'ready',
      achievements: [
        { id: 'a', name: 'First', description: 'First description', category: 'completion', milestoneKind: 'occurrence-count', threshold: 1, progressSource: 'totalCompletions', order: 1, progress: 0, rewardStatus: 'locked' },
        { id: 'b', name: 'Second', description: 'Second description', category: 'dogs', milestoneKind: 'occurrence-count', threshold: 10, progressSource: 'lifetimeDogs', order: 2, progress: 4, rewardStatus: 'in-progress' },
        { id: 'c', name: 'Third', description: 'Third description', category: 'completion', milestoneKind: 'occurrence-count', threshold: 2, progressSource: 'totalCompletions', order: 3, progress: 2, rewardStatus: 'migration-unlocked-reward-ineligible' },
      ],
    });
    const allocate = vi.spyOn(gameState, 'allocateAchievementViewEvent').mockReturnValue(null);

    openPage('achievements');

    expect([...document.querySelectorAll('.achievement-card')].map((node) => node.getAttribute('data-achievement-id'))).toEqual(['a', 'c', 'b']);
    expect(document.body.textContent).toContain('0/1');
    expect(document.body.textContent).toContain('4/10');
    expect(document.body.textContent).toContain('Reward locked');
    expect(document.body.textContent).toContain('Reward in progress');
    expect(document.body.textContent).toContain('reward not available');
    expect(document.querySelector('progress')?.getAttribute('aria-label')).toBe('First progress: 0 of 1');
    expect(allocate).toHaveBeenCalledTimes(4);
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
  });

  it('isolates the Home shell, handles Escape and restores focus without leaking listeners', () => {
    vi.spyOn(gameState, 'achievementReadProjection').mockReturnValue({ status: 'ready', achievements: [] });
    vi.spyOn(gameState, 'allocateAchievementViewEvent').mockReturnValue(null);
    const opener = document.querySelector<HTMLButtonElement>('#opener')!;
    opener.focus();
    openPage('achievements');
    expect(document.querySelector('#home-shell')?.hasAttribute('inert')).toBe(true);
    expect(document.activeElement?.id).toBe('home-page-overlay');
    const back = document.querySelector<HTMLButtonElement>('#home-page-back')!;
    back.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(back);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(opener).toBe(document.activeElement);
    expect(document.querySelector('#home-shell')?.hasAttribute('inert')).toBe(false);
    closePage();
  });

  it('contains Shift+Tab from the initially focused title inside the modal', () => {
    vi.spyOn(gameState, 'achievementReadProjection').mockReturnValue({ status: 'ready', achievements: [] });
    vi.spyOn(gameState, 'allocateAchievementViewEvent').mockReturnValue(null);
    openPage('achievements');
    expect(document.activeElement?.id).toBe('home-page-overlay');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));

    const page = document.querySelector('#home-page-overlay')!;
    expect(page.contains(document.activeElement)).toBe(true);
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
  });
});
