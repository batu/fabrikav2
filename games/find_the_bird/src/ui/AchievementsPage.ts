import { gameState } from '../core/GameState';
import { analytics } from '../analytics/AnalyticsService';
import type { AchievementRewardStatus } from '../achievements/AchievementSystem';
import { animateCoinsToBalance, animateHintsToBalance, economyTokenImage } from './EconomyTransfer';
import { refreshHomeWalletBalances } from './WalletBalances';

type RewardKind = 'coin' | 'hint';

interface RewardItem {
  kind: RewardKind;
  amount: number;
  label: string;
}

/** Cozy Garden medallions remain image assets while card copy stays semantic. */
const ACHIEVEMENT_CATEGORY_BADGES: Record<string, string> = {
  completion: '/ui/achievements/achievement-completion.png',
  dogs: '/ui/achievements/achievement-birds.png',
  mastery: '/ui/achievements/achievement-mastery.png',
  progression: '/ui/achievements/achievement-progression.png',
  streak: '/ui/achievements/achievement-streak.png',
};

function rewardStatusCopy(status: AchievementRewardStatus): string {
  switch (status) {
    case 'locked': return 'Reward locked';
    case 'in-progress': return 'Reward in progress';
    case 'unlocked-reward-claimable': return 'Reward ready to claim';
    case 'reward-claimed': return 'Reward collected';
    case 'migration-unlocked-reward-ineligible': return 'Unlocked from earlier play; reward not available';
    case 'legacy-unlocked-reward-provenance-unknown': return 'Unlocked from earlier play; reward history unavailable';
  }
}

// "Viewed" means the card was shown to the player at least once this session —
// not re-counted on every page open. Without this, each open of the collection
// re-fires achievement_viewed for the whole catalog and inflates per-
// achievement view metrics. page_viewed intentionally stays per-open (product
// wants open counts). Session-scoped: resets on relaunch by design, mirroring
// presentedAchievementOccurrences in LevelCompleteOverlay.
const viewedThisSession = new Set<string>();

/** Test seam: reset the session view dedupe between unit tests. */
export function resetAchievementViewSessionForTest(): void {
  viewedThisSession.clear();
}

export function renderAchievementHeaderBalances(): string {
  const wallet = gameState.walletSnapshot();
  return `
    <div class="achievement-header-balances" aria-label="Achievement reward balances">
      <div class="achievement-header-balance achievement-header-coin-balance" data-economy-target="coins" aria-label="Coin balance">
        <img src="${economyTokenImage('coin')}" alt="" aria-hidden="true" data-economy-anchor="coin">
        <span class="achievement-header-coin-count">${wallet.coins}</span>
      </div>
      <div class="achievement-header-balance achievement-header-hint-balance" data-economy-target="hints" aria-label="Hint balance">
        <img src="${economyTokenImage('hint')}" alt="" aria-hidden="true" data-economy-anchor="hint">
        <span class="achievement-header-hint-count">${wallet.hints}</span>
      </div>
    </div>
  `;
}

export function renderAchievementsPageBody(): string {
  const projection = gameState.achievementReadProjection();
  if (projection.status === 'unavailable') {
    const message = projection.reason === 'settlement-pending'
      ? 'Achievements are updating. Please check again shortly.'
      : 'Achievements are unavailable until your saved progress is ready.';
    return `<section class="achievement-unavailable" role="status"><h3>Collection unavailable</h3><p>${message}</p></section>`;
  }

  // ONE ROW PER LADDER (2026-08-07). The catalog is three progressions
  // (completions / birds found / daily streak) and listing all twelve tiers at
  // once buried the one that matters. Each row shows the lowest tier that is
  // still open; claiming it reveals the next. The 12 catalog entries stay as
  // data — their ids are persisted in saves and used as analytics event ids,
  // so collapsing them into three records would orphan both.
  const CATEGORY_ROWS: ReadonlyArray<{ category: string; title: string }> = [
    { category: 'completion', title: 'Levels completed' },
    { category: 'dogs', title: 'Birds found' },
    { category: 'streak', title: 'Daily streak' },
  ];

  const groups = new Map<string, typeof projection.achievements>();
  for (const achievement of projection.achievements) {
    groups.set(achievement.category, [...(groups.get(achievement.category) ?? []), achievement]);
  }

  const body = CATEGORY_ROWS.map(({ category, title }) => {
    const tiers = [...(groups.get(category) ?? [])].sort((a, b) => a.threshold - b.threshold);
    if (tiers.length === 0) return '';
    // "Open" = not yet collected. A claimable tier outranks an unclaimed one so
    // a player who jumped several thresholds at once collects them in order,
    // one tap each, instead of the row skipping rewards they earned.
    const active = tiers.find((t) => t.rewardStatus === 'unlocked-reward-claimable')
      ?? tiers.find((t) => t.rewardStatus !== 'reward-claimed')
      ?? null;
    const claimedCount = tiers.filter((t) => t.rewardStatus === 'reward-claimed').length;
    const ladder = `<p class="achievement-row-ladder">Tier ${Math.min(claimedCount + 1, tiers.length)} of ${tiers.length}</p>`;

    if (active === null) {
      // Row finished: keep it visible rather than hiding the accomplishment.
      const last = tiers[tiers.length - 1];
      return `<section class="achievement-category achievement-category--complete" aria-labelledby="achievement-category-${category}">
        <header class="achievement-row-head"><h3 id="achievement-category-${category}">${title}</h3>${ladder}</header>
        <div class="achievement-list">
          <article class="achievement-card achievement-card--completed" data-achievement-id="${last.id}" aria-label="${title}: all ${tiers.length} tiers complete">
            <span class="achievement-badge" aria-hidden="true"><img src="${ACHIEVEMENT_CATEGORY_BADGES[last.category] ?? ACHIEVEMENT_CATEGORY_BADGES.completion}" alt=""></span>
            <div class="achievement-card-main">
              <header><h4>${last.name}</h4><strong class="achievement-state">All tiers complete</strong></header>
              <p>Every ${title.toLowerCase()} reward collected.</p>
            </div>
          </article>
        </div>
      </section>`;
    }

    const achievement = active;
    const completed = achievement.progress >= achievement.threshold;
    const state = completed ? 'Completed' : achievement.progress > 0 ? 'In progress' : 'Not started';
    const stateClass = completed ? 'completed' : achievement.progress > 0 ? 'in-progress' : 'not-started';
    const rewardCopy = rewardStatusCopy(achievement.rewardStatus);
    const rewardLine = achievement.rewardStatus === 'locked' || achievement.rewardStatus === 'in-progress'
      ? ''
      : achievement.rewardStatus === 'unlocked-reward-claimable'
        ? `<button class="achievement-claim-btn" type="button" data-claim-achievement="${achievement.id}" aria-label="Claim ${rewardLabel(achievement.entitledReward)}">
            <span>Claim</span>
            ${rewardButtonItems(achievement.entitledReward)}
          </button>`
        : `<p class="achievement-reward-status">${rewardCopy}</p>`;
    return `<section class="achievement-category" aria-labelledby="achievement-category-${category}">
      <header class="achievement-row-head"><h3 id="achievement-category-${category}">${title}</h3>${ladder}</header>
      <div class="achievement-list">
        <article class="achievement-card achievement-card--${stateClass}" data-achievement-id="${achievement.id}" aria-label="${achievement.name}: ${state}, ${achievement.progress} of ${achievement.threshold}. ${rewardCopy}">
          <span class="achievement-badge" aria-hidden="true"><img src="${ACHIEVEMENT_CATEGORY_BADGES[achievement.category] ?? ACHIEVEMENT_CATEGORY_BADGES.completion}" alt=""></span>
          <div class="achievement-card-main">
            <header><h4>${achievement.name}</h4><strong class="achievement-state">${state}</strong></header>
            <p>${achievement.description}</p>
            <progress value="${achievement.progress}" max="${achievement.threshold}" aria-label="${achievement.name} progress: ${achievement.progress} of ${achievement.threshold}">${achievement.progress}/${achievement.threshold}</progress>
            <span class="achievement-progress-text">${achievement.progress}/${achievement.threshold}</span>
            ${rewardLine}
          </div>
        </article>
      </div>
    </section>`;
  }).join('');

  const pageEvent = gameState.allocateAchievementViewEvent({ name: 'achievement_page_viewed' });
  if (pageEvent) analytics.dispatchAchievementEvent(pageEvent);
  for (const achievement of projection.achievements) {
    if (viewedThisSession.has(achievement.id)) continue;
    const event = gameState.allocateAchievementViewEvent({ name: 'achievement_viewed', achievementId: achievement.id });
    if (event) {
      viewedThisSession.add(achievement.id);
      analytics.dispatchAchievementEvent(event);
    }
  }
  return body || '<section class="achievement-unavailable" role="status"><h3>No achievements yet</h3><p>Your collection is ready.</p></section>';
}

function rewardLabel(reward: { coins?: number; hints?: number } | undefined): string {
  return rewardItems(reward).map((item) => item.label).join(' + ') || 'reward';
}

function rewardButtonItems(reward: { coins?: number; hints?: number } | undefined): string {
  return rewardItems(reward).map((item) => `<span class="achievement-claim-reward"><img src="${economyTokenImage(item.kind)}" alt="" aria-hidden="true" data-economy-anchor="${item.kind}"><span><span data-reward-count="${item.kind}">${item.amount}</span> ${item.kind === 'coin' ? 'coins' : item.amount === 1 ? 'hint' : 'hints'}</span></span>`)
    .join('<span class="achievement-claim-plus" aria-hidden="true">+</span>');
}

function rewardItems(reward: { coins?: number; hints?: number } | undefined): RewardItem[] {
  const items: RewardItem[] = [];
  const coins = reward?.coins ?? 0;
  const hints = reward?.hints ?? 0;
  if (coins > 0) items.push({ kind: 'coin', amount: coins, label: `${coins} coins` });
  if (hints > 0) items.push({ kind: 'hint', amount: hints, label: `${hints} ${hints === 1 ? 'hint' : 'hints'}` });
  return items;
}

function refreshAchievementHeaderBalances(page: ParentNode): void {
  const wallet = gameState.walletSnapshot();
  const coin = page.querySelector<HTMLElement>('.achievement-header-coin-count');
  const hint = page.querySelector<HTMLElement>('.achievement-header-hint-count');
  if (coin) coin.textContent = String(wallet.coins);
  if (hint) hint.textContent = String(wallet.hints);
}

export function wireAchievementClaimButtons(page: HTMLElement): void {
  for (const button of page.querySelectorAll<HTMLButtonElement>('[data-claim-achievement]')) {
    button.addEventListener('click', async () => {
      if (button.disabled) return;
      button.disabled = true;
      const achievementId = button.dataset.claimAchievement;
      if (!achievementId) {
        button.disabled = false;
        return;
      }
      const before = gameState.walletSnapshot();
      if (!claimAchievementRewardWithRetry(achievementId)) {
        button.disabled = false;
        return;
      }
      gameState.drainAnalyticsOutbox();
      const after = gameState.walletSnapshot();
      const coinsGranted = Math.max(0, after.coins - before.coins);
      const hintsGranted = Math.max(0, after.hints - before.hints);
      const animations: Promise<void>[] = [];
      if (coinsGranted > 0) {
        animations.push(animateCoinsToBalance({
          amount: coinsGranted,
          source: button,
          target: page.querySelector<HTMLElement>('.achievement-header-coin-balance'),
          owner: page,
          drainCountElement: button.querySelector<HTMLElement>('[data-reward-count="coin"]'),
          countElement: page.querySelector<HTMLElement>('.achievement-header-coin-count'),
          fromValue: before.coins,
          toValue: after.coins,
        }));
      }
      if (hintsGranted > 0) {
        animations.push(animateHintsToBalance({
          amount: hintsGranted,
          source: button,
          target: page.querySelector<HTMLElement>('.achievement-header-hint-balance'),
          owner: page,
          drainCountElement: button.querySelector<HTMLElement>('[data-reward-count="hint"]'),
          countElement: page.querySelector<HTMLElement>('.achievement-header-hint-count'),
          fromValue: before.hints,
          toValue: after.hints,
        }));
      }
      await Promise.all(animations);
      refreshAchievementHeaderBalances(page);
      const status = document.createElement('p');
      status.className = 'achievement-reward-status';
      status.textContent = 'Reward collected';
      button.replaceWith(status);
      refreshHomeWalletBalances();
    });
  }
}

function claimAchievementRewardWithRetry(achievementId: string): boolean {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      if (gameState.claimAchievementReward(achievementId) !== null) return true;
      return achievementRewardIsClaimed(achievementId);
    } catch {
      // A checkpoint may have landed before persistence failed. One retry
      // finalizes or safely performs the still-unclaimed settlement.
    }
  }
  return achievementRewardIsClaimed(achievementId);
}

function achievementRewardIsClaimed(achievementId: string): boolean {
  const projection = gameState.achievementReadProjection();
  return projection.status === 'ready'
    && projection.achievements.some((achievement) => achievement.id === achievementId && achievement.rewardStatus === 'reward-claimed');
}
