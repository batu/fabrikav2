/**
 * Saga read model: derive the level-map rail's node list from persisted progress.
 * Pure — no DOM, no SaveState singleton, no Three.js. The game owns windowing
 * policy; @fabrika/core/ui's `mountLevelMap` only draws the nodes it is handed.
 *
 * Window geometry is FORWARD-FADE: the current node sits at/near the bottom with
 * the locked-ahead levels stacked above it. The component only fades nodes AHEAD
 * of current (distance = currentPos - i; `.far` at >= 3, `.distant` at >= 4), so a
 * "completed-below" layout would never fade and the rail would read flat. See
 * docs/plans/2026-06-29-001-marble-run-saga-component-adoption-plan.md
 * (ledger R-adv-2 / R-feas-fade).
 */
import type { LevelMapNode } from '@fabrikav2/ui';
import { LEVEL_COUNT } from '../core/Constants';

export interface SagaWindowOptions {
  /** Levels shown ahead of (above) the current node. */
  ahead?: number;
  /** Levels shown behind (below) the current node. */
  behind?: number;
  /** Total level count (clamp ceiling). */
  levelCount?: number;
}

const DEFAULT_AHEAD = 4;
const DEFAULT_BEHIND = 1;
export const MENU_SAGA_WINDOW: Required<Pick<SagaWindowOptions, 'ahead' | 'behind'>> = {
  ahead: 4,
  behind: 0,
};

/**
 * Build the windowed node list (ordered top→bottom) for the saga rail.
 *
 * - Exactly one `current` node (the clamped `unlocked` level).
 * - Levels below `current` (n < unlocked) are `completed`; above are `locked`.
 * - The window is clamped to [1, levelCount]; when one side is short near an edge
 *   the shortfall is redistributed to the side that still has room, so the window
 *   size stays stable and no invalid ids (level 0 / level N+1) are emitted.
 *
 * Note on the end-state: once `unlocked` saturates at `levelCount`, level N stays
 * `current` (it never becomes `completed` — that needs the deferred SaveData v:3
 * "beaten" bit). The all-done state is owned by the finale screen, not the saga.
 */
export function buildSagaNodes(unlocked: number, options: SagaWindowOptions = {}): LevelMapNode[] {
  const levelCount = options.levelCount ?? LEVEL_COUNT;
  const ahead = options.ahead ?? DEFAULT_AHEAD;
  const behind = options.behind ?? DEFAULT_BEHIND;
  const current = clamp(unlocked, 1, levelCount);

  let aheadAvail = Math.min(ahead, levelCount - current);
  let behindAvail = Math.min(behind, current - 1);

  // Redistribute the shortfall from a short side to the side that still has room,
  // so the visible window stays a stable size near the first/last level.
  let deficit = ahead - aheadAvail + (behind - behindAvail);
  let behindRoom = current - 1 - behindAvail;
  let aheadRoom = levelCount - current - aheadAvail;
  while (deficit > 0 && (behindRoom > 0 || aheadRoom > 0)) {
    if (behindRoom > 0) {
      behindAvail += 1;
      behindRoom -= 1;
    } else {
      aheadAvail += 1;
      aheadRoom -= 1;
    }
    deficit -= 1;
  }

  const nodes: LevelMapNode[] = [];
  // Top→bottom = descending level number: furthest-ahead (most faded) at the top,
  // current near the bottom, completed below it.
  for (let n = current + aheadAvail; n >= current - behindAvail; n -= 1) {
    nodes.push({
      id: n,
      label: String(n),
      name: `Level ${n}`,
      state: n < current ? 'completed' : n === current ? 'current' : 'locked',
    });
  }
  return nodes;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
