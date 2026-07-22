// Data-only achievement catalog for the shell template (ported from Find the
// Dog's card ACH-1, U2 / KTD4). Names/descriptions are template placeholders —
// a new game replaces the copy (and any game-specific ids) while keeping the
// same categories shape.
//
// Grounded ONLY in provable behaviors: completion-count milestones, streak
// milestones, personal-best, lifetime collected finds (from this release
// forward), and distinct LOGICAL-level mastery (forward-only). No accounts/
// cloud/leaderboard/social/battle-pass/daily-mission/new-currency. Rewards are
// modest coins/hints.

import type {
  AchievementCategory,
  EntitledReward,
  MilestoneKind,
  ProgressSource,
} from './AchievementSystem';

export interface Achievement {
  /** Stable string id (never renumbered). Bounded so analytics event ids stay ≤96. */
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: AchievementCategory;
  readonly milestoneKind: MilestoneKind;
  readonly threshold: number;
  readonly progressSource: ProgressSource;
  /** Deterministic display order (unique). */
  readonly order: number;
  readonly entitledReward?: EntitledReward;
}

/**
 * Upper bound on catalog `id` length. `ach:<sequence>:<eventKind>:<achievementId>`
 * must stay ≤96 chars so `compactCustomFields`'s 96-char slice never truncates a
 * live analytics `event_id`. With `ach:` + up to ~15 sequence digits + `:` +
 * `reconciliation`/`unlocked`/`progress`/`reward` + `:`, 48 leaves ample room.
 */
export const MAX_ACHIEVEMENT_ID_LENGTH = 48;

/**
 * The first-release catalog. `order` is the stable display order; `apply()` and
 * `orderedAchievements()` iterate in this order so unlock ordering is deterministic.
 */
export const ACHIEVEMENT_CATALOG: readonly Achievement[] = [
  {
    id: 'first_completion',
    name: 'First Steps',
    description: 'Complete your first level.',
    category: 'completion',
    milestoneKind: 'occurrence-count',
    threshold: 1,
    progressSource: 'totalCompletions',
    order: 10,
    entitledReward: { coins: 25 },
  },
  {
    id: 'completions_10',
    name: 'Getting Started',
    description: 'Complete 10 levels.',
    category: 'completion',
    milestoneKind: 'occurrence-count',
    threshold: 10,
    progressSource: 'totalCompletions',
    order: 20,
    entitledReward: { coins: 50 },
  },
  {
    id: 'completions_25',
    name: 'Seasoned Player',
    description: 'Complete 25 levels.',
    category: 'completion',
    milestoneKind: 'occurrence-count',
    threshold: 25,
    progressSource: 'totalCompletions',
    order: 30,
    entitledReward: { coins: 75 },
  },
  {
    id: 'completions_50',
    name: 'Level Master',
    description: 'Complete 50 levels.',
    category: 'completion',
    milestoneKind: 'occurrence-count',
    threshold: 50,
    progressSource: 'totalCompletions',
    order: 40,
    entitledReward: { coins: 100, hints: 3 },
  },
  {
    id: 'first_best',
    name: 'Personal Best',
    description: 'Set your first personal best time.',
    category: 'progression',
    milestoneKind: 'occurrence-count',
    threshold: 1,
    progressSource: 'personalBests',
    order: 50,
    entitledReward: { coins: 20 },
  },
  {
    id: 'streak_3',
    name: 'On a Roll',
    description: 'Play on 3 consecutive days.',
    category: 'streak',
    milestoneKind: 'temporal',
    threshold: 3,
    progressSource: 'streakDays',
    order: 60,
    entitledReward: { coins: 30 },
  },
  {
    id: 'streak_7',
    name: 'Weeklong Wanderer',
    description: 'Play on 7 consecutive days.',
    category: 'streak',
    milestoneKind: 'temporal',
    threshold: 7,
    progressSource: 'streakDays',
    order: 70,
    entitledReward: { coins: 60, hints: 2 },
  },
  {
    id: 'collection_25',
    name: 'Collector',
    description: 'Find 25 hidden objects.',
    category: 'collection',
    milestoneKind: 'occurrence-count',
    threshold: 25,
    progressSource: 'lifetimeDogs',
    order: 80,
    entitledReward: { coins: 30 },
  },
  {
    id: 'collection_100',
    name: 'Century Collection',
    description: 'Find 100 hidden objects.',
    category: 'collection',
    milestoneKind: 'occurrence-count',
    threshold: 100,
    progressSource: 'lifetimeDogs',
    order: 90,
    entitledReward: { coins: 60 },
  },
  {
    id: 'mastery_5',
    name: 'Explorer',
    description: 'Complete 5 different levels.',
    category: 'mastery',
    milestoneKind: 'logical-progression',
    threshold: 5,
    progressSource: 'masteredLevels',
    order: 100,
    entitledReward: { coins: 30 },
  },
  {
    id: 'mastery_15',
    name: 'Cartographer',
    description: 'Complete 15 different levels.',
    category: 'mastery',
    milestoneKind: 'logical-progression',
    threshold: 15,
    progressSource: 'masteredLevels',
    order: 110,
    entitledReward: { coins: 75, hints: 2 },
  },
] as const;

let cachedOrdered: readonly Achievement[] | null = null;

/** Catalog in deterministic display order (by `order`). Stable across calls. */
export function orderedAchievements(): readonly Achievement[] {
  if (cachedOrdered === null) {
    cachedOrdered = [...ACHIEVEMENT_CATALOG].sort((a, b) => a.order - b.order);
  }
  return cachedOrdered;
}

/**
 * Reward-budget total (AC6). Documented so a future catalog edit that inflates the
 * economy is caught by the U2 upper-bound test.
 *   coins: 25+50+75+100+20+30+60+30+60+30+75 = 555
 *   hints: 3+2+2 = 7
 */
export function catalogRewardTotals(): { coins: number; hints: number } {
  let coins = 0;
  let hints = 0;
  for (const achievement of ACHIEVEMENT_CATALOG) {
    coins += achievement.entitledReward?.coins ?? 0;
    hints += achievement.entitledReward?.hints ?? 0;
  }
  return { coins, hints };
}
