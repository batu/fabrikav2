import { gameState } from '../core/GameState';
import { analytics } from '../analytics/AnalyticsService';
import type { AchievementRewardStatus } from '../achievements/AchievementSystem';

/** Text glyphs (never emoji) so each category's medal reads distinctly. */
const ACHIEVEMENT_CATEGORY_GLYPHS: Record<string, string> = {
  completion: '★',
  dogs: '♥',
  mastery: '✦',
  progression: '⚑',
  streak: '◆',
};

function rewardStatusCopy(status: AchievementRewardStatus): string {
  switch (status) {
    case 'locked': return 'Reward locked';
    case 'in-progress': return 'Reward in progress';
    case 'live-reward-settled': return 'Reward collected';
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

export function renderAchievementsPageBody(): string {
  const projection = gameState.achievementReadProjection();
  if (projection.status === 'unavailable') {
    const message = projection.reason === 'settlement-pending'
      ? 'Achievements are updating. Please check again shortly.'
      : 'Achievements are unavailable until your saved progress is ready.';
    return `<section class="achievement-unavailable" role="status"><h3>Collection unavailable</h3><p>${message}</p></section>`;
  }

  const groups = new Map<string, typeof projection.achievements>();
  for (const achievement of projection.achievements) {
    groups.set(achievement.category, [...(groups.get(achievement.category) ?? []), achievement]);
  }
  const body = [...groups].map(([category, achievements]) => `
    <section class="achievement-category" aria-labelledby="achievement-category-${category}">
      <h3 id="achievement-category-${category}">${category}</h3>
      <div class="achievement-list">
        ${achievements.map((achievement) => {
          const completed = achievement.progress >= achievement.threshold;
          // Nothing gates these, so zero progress is "Not started", not "Locked".
          const state = completed ? 'Completed' : achievement.progress > 0 ? 'In progress' : 'Not started';
          const stateClass = completed ? 'completed' : achievement.progress > 0 ? 'in-progress' : 'not-started';
          // The reward line repeats the state chip for locked/in-progress; only
          // render it when it says something the chip does not. The full reward
          // status stays in the card's aria-label either way.
          const rewardCopy = rewardStatusCopy(achievement.rewardStatus);
          const rewardLine = achievement.rewardStatus === 'locked' || achievement.rewardStatus === 'in-progress'
            ? ''
            : `<p class="achievement-reward-status">${rewardCopy}</p>`;
          return `<article class="achievement-card achievement-card--${stateClass}" data-achievement-id="${achievement.id}" aria-label="${achievement.name}: ${state}, ${achievement.progress} of ${achievement.threshold}. ${rewardCopy}">
            <span class="achievement-badge" aria-hidden="true">${ACHIEVEMENT_CATEGORY_GLYPHS[achievement.category] ?? '★'}</span>
            <div class="achievement-card-main">
              <header><h4>${achievement.name}</h4><strong class="achievement-state">${state}</strong></header>
              <p>${achievement.description}</p>
              <progress value="${achievement.progress}" max="${achievement.threshold}" aria-label="${achievement.name} progress: ${achievement.progress} of ${achievement.threshold}">${achievement.progress}/${achievement.threshold}</progress>
              <span class="achievement-progress-text">${achievement.progress}/${achievement.threshold}</span>
              ${rewardLine}
            </div>
          </article>`;
        }).join('')}
      </div>
    </section>`).join('');

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
