import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/audio/AudioManager', () => ({
  playUITap: vi.fn(), playHint: vi.fn(), setMusicEnabled: vi.fn(), setSoundEffectsEnabled: vi.fn(),
}));

vi.mock('../../src/ui/EconomyTransfer', () => ({
  animateCoinsToBalance: vi.fn(() => Promise.resolve()),
  animateHintsToBalance: vi.fn(() => Promise.resolve()),
  economyTokenImage: vi.fn((kind: 'coin' | 'hint') => `/ui/menu-icons/icon_${kind === 'coin' ? 'coin' : 'hint_magnifier'}.png`),
}));

import { analytics } from '../../src/analytics/AnalyticsService';
import { gameState } from '../../src/core/GameState';
import { closePage, openPage } from '../../src/ui/HUD';
import { animateCoinsToBalance, animateHintsToBalance } from '../../src/ui/EconomyTransfer';

const wallet = (coins: number, hints: number) => ({
  coins, hints,
  hasNoAdsEntitlement: false,
  hasPremiumEntitlement: false,
  rewardProgressCount: 0,
  processedPurchaseIds: [],
  activeCompletionTransaction: null,
  counters: { coinsGranted: 0, coinsSpent: 0, hintsGranted: 0, hintsSpent: 0, levelCompleteCoinGrants: 0, rewardedHintGrants: 0 },
});

describe('achievement collection page', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="hud-overlay"><button id="opener">Achievements</button><div id="home-shell"></div></div>';
    vi.restoreAllMocks();
  });

  it('renders canonical order, explicit states, progress and reward meanings', () => {
    vi.spyOn(gameState, 'walletSnapshot').mockReturnValue(wallet(125, 7));
    vi.spyOn(gameState, 'achievementReadProjection').mockReturnValue({
      status: 'ready',
      achievements: [
        { id: 'a', name: 'First', description: 'First description', category: 'completion', milestoneKind: 'occurrence-count', threshold: 1, progressSource: 'totalCompletions', order: 1, progress: 0, rewardStatus: 'locked' },
        { id: 'b', name: 'Second', description: 'Second description', category: 'dogs', milestoneKind: 'occurrence-count', threshold: 10, progressSource: 'lifetimeDogs', order: 2, progress: 4, rewardStatus: 'in-progress' },
        { id: 'c', name: 'Third', description: 'Third description', category: 'completion', milestoneKind: 'occurrence-count', threshold: 2, progressSource: 'totalCompletions', order: 3, progress: 2, rewardStatus: 'unlocked-reward-claimable', entitledReward: { coins: 25 } },
      ],
    });
    const allocate = vi.spyOn(gameState, 'allocateAchievementViewEvent').mockReturnValue(null);

    openPage('achievements');

    // ONE card per ladder (2026-08-07): the page shows the tier you can act on,
    // not every tier. 'a' and 'c' are both 'completion'; 'c' is claimable so it
    // is the one that surfaces, and the lower locked tier stays out of the way.
    expect([...document.querySelectorAll('.achievement-card')].map((node) => node.getAttribute('data-achievement-id'))).toEqual(['c', 'b']);
    expect(document.querySelector('[data-achievement-id="a"]')).toBeNull();
    expect(document.body.textContent).toContain('4/10');
    // Locked/in-progress reward lines are chip duplicates and stay visual-only
    // in the aria-label; only differentiated reward copy renders as text.
    expect(document.body.textContent).not.toContain('Reward locked');
    expect(document.body.textContent).not.toContain('Reward in progress');
    expect(document.querySelector('[data-achievement-id="c"] button')?.getAttribute('aria-label')).toBe('Claim 25 coins');
    expect(document.querySelector('[data-achievement-id="c"] button')?.textContent).toContain('Claim');
    expect(document.querySelector('.achievement-header-coin-count')?.textContent).toBe('125');
    expect(document.querySelector('.achievement-header-hint-count')?.textContent).toBe('7');
    expect(document.querySelector('[data-achievement-id="c"] [data-economy-anchor="coin"]')).not.toBeNull();
    // Each surfaced row states which rung of its ladder the player is on.
    expect(document.body.textContent).toMatch(/Tier \d+ of \d+/);
    expect(allocate).toHaveBeenCalled();
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
      status: 'ready', achievements: [{ id: 'a', name: 'First', description: 'Desc', category: 'completion', milestoneKind: 'occurrence-count', threshold: 1, progressSource: 'totalCompletions', order: 1, progress: 1, rewardStatus: 'reward-claimed' }],
    });
    const pageEvent = { eventId: 'page', name: 'achievement_page_viewed', payload: { event_id: 'page' } } as const;
    const itemEvent = { eventId: 'item', name: 'achievement_viewed', payload: { event_id: 'item', achievement_id: 'a', occurrence_id: 'item', category: 'completion' } } as const;
    vi.spyOn(gameState, 'allocateAchievementViewEvent').mockReturnValueOnce(pageEvent).mockReturnValueOnce(itemEvent);
    const dispatch = vi.spyOn(analytics, 'dispatchAchievementEvent').mockImplementation(() => undefined);
    openPage('achievements');
    expect(dispatch.mock.calls).toEqual([[pageEvent], [itemEvent]]);
  });

  it('flies each claimed reward from its icon-bearing button to the visible counters', async () => {
    const projection = {
      status: 'ready' as const,
      achievements: [{ id: 'a', name: 'First', description: 'Desc', category: 'completion' as const, milestoneKind: 'occurrence-count' as const, threshold: 1, progressSource: 'totalCompletions' as const, order: 1, progress: 1, rewardStatus: 'unlocked-reward-claimable' as const, entitledReward: { coins: 25, hints: 2 } }],
    };
    vi.spyOn(gameState, 'achievementReadProjection').mockReturnValue(projection);
    vi.spyOn(gameState, 'walletSnapshot')
      .mockReturnValueOnce(wallet(100, 5))
      .mockReturnValueOnce(wallet(100, 5))
      .mockReturnValue(wallet(125, 7));
    const allocate = vi.spyOn(gameState, 'allocateAchievementViewEvent').mockReturnValue(null);
    vi.spyOn(gameState, 'claimAchievementReward').mockReturnValue({ achievementId: 'a', coins: 25, hints: 2 });
    vi.spyOn(gameState, 'drainAnalyticsOutbox').mockImplementation(() => undefined);

    openPage('achievements');
    const allocationsBeforeClaim = allocate.mock.calls.length;
    expect(allocationsBeforeClaim).toBeGreaterThan(0);
    const button = document.querySelector<HTMLButtonElement>('[data-claim-achievement="a"]')!;
    expect(button.querySelector('[data-economy-anchor="coin"]')).not.toBeNull();
    expect(button.querySelector('[data-economy-anchor="hint"]')).not.toBeNull();
    button.click();
    await vi.waitFor(() => {
      expect(animateCoinsToBalance).toHaveBeenCalledWith(expect.objectContaining({ amount: 25, source: button, target: document.querySelector('.achievement-header-coin-balance'), drainCountElement: button.querySelector('[data-reward-count="coin"]') }));
      expect(animateHintsToBalance).toHaveBeenCalledWith(expect.objectContaining({ amount: 2, source: button, target: document.querySelector('.achievement-header-hint-balance'), drainCountElement: button.querySelector('[data-reward-count="hint"]') }));
    });
    expect(allocate).toHaveBeenCalledTimes(allocationsBeforeClaim);
  });

  it('recovers a settled claim after a checkpoint throw and updates the card without a second grant', async () => {
    vi.spyOn(gameState, 'achievementReadProjection').mockReturnValue({
      status: 'ready',
      achievements: [{ id: 'a', name: 'First', description: 'Desc', category: 'completion', milestoneKind: 'occurrence-count', threshold: 1, progressSource: 'totalCompletions', order: 1, progress: 1, rewardStatus: 'unlocked-reward-claimable', entitledReward: { coins: 25 } }],
    });
    vi.spyOn(gameState, 'walletSnapshot')
      .mockReturnValueOnce(wallet(100, 5))
      .mockReturnValueOnce(wallet(100, 5))
      .mockReturnValue(wallet(125, 5));
    vi.spyOn(gameState, 'allocateAchievementViewEvent').mockReturnValue(null);
    vi.spyOn(gameState, 'drainAnalyticsOutbox').mockImplementation(() => undefined);
    vi.spyOn(gameState, 'claimAchievementReward')
      .mockImplementationOnce(() => { throw new Error('checkpoint'); })
      .mockReturnValueOnce(null);

    openPage('achievements');
    vi.spyOn(gameState, 'achievementReadProjection').mockReturnValue({
      status: 'ready',
      achievements: [{ id: 'a', name: 'First', description: 'Desc', category: 'completion', milestoneKind: 'occurrence-count', threshold: 1, progressSource: 'totalCompletions', order: 1, progress: 1, rewardStatus: 'reward-claimed', entitledReward: { coins: 25 } }],
    });
    document.querySelector<HTMLButtonElement>('[data-claim-achievement="a"]')!.click();

    await vi.waitFor(() => expect(document.querySelector('[data-achievement-id="a"]')?.textContent).toContain('Reward collected'));
    expect(gameState.claimAchievementReward).toHaveBeenCalledTimes(2);
  });

  it('re-enables claim when both persistence attempts fail', async () => {
    vi.spyOn(gameState, 'achievementReadProjection').mockReturnValue({
      status: 'ready',
      achievements: [{ id: 'a', name: 'First', description: 'Desc', category: 'completion', milestoneKind: 'occurrence-count', threshold: 1, progressSource: 'totalCompletions', order: 1, progress: 1, rewardStatus: 'unlocked-reward-claimable', entitledReward: { coins: 25 } }],
    });
    vi.spyOn(gameState, 'walletSnapshot').mockReturnValue(wallet(100, 5));
    vi.spyOn(gameState, 'allocateAchievementViewEvent').mockReturnValue(null);
    vi.spyOn(gameState, 'claimAchievementReward').mockImplementation(() => { throw new Error('storage unavailable'); });

    openPage('achievements');
    const button = document.querySelector<HTMLButtonElement>('[data-claim-achievement="a"]')!;
    button.click();

    await vi.waitFor(() => expect(button.disabled).toBe(false));
    expect(gameState.claimAchievementReward).toHaveBeenCalledTimes(2);
  });
});
