import type { LevelMapNode, LevelNodeState } from '@fabrikav2/ui';

/**
 * Saga windowing ported from v1 marble_run sugar3d buildSagaNodes: a MENU
 * window of {ahead: 4, behind: 0} — the current level anchored at the bottom
 * with up to 3 locked levels ahead of it, top→bottom display order. Pure and
 * decoupled from gameState so it is unit-testable (SagaMap gates locked taps).
 */

/** Total visible nodes (current + ahead), matching v1's forward-only MENU window. */
export const SAGA_WINDOW_SIZE = 4;

export interface SagaInput {
  /** Zero-based logical index of the current (playable) level. */
  currentIndex: number;
  /** Number of content levels available; clamps the window near the sequence end. */
  levelCount: number;
  /** Resolve a display name for a logical level index; falls back to `Level N`. */
  nameFor?: (logicalIndex: number) => string | undefined;
  /** Map a logical progress index to the 1-based level number to display.
   *  Injected (not imported) to keep this module pure and unit-testable; the
   *  shell passes `contentLevelNumber` so a wrapped replay shows its real level
   *  number rather than an ever-climbing progress count. */
  levelNumberFor?: (logicalIndex: number) => number;
}

export function buildSagaNodes(input: SagaInput): LevelMapNode[] {
  const currentIndex = Math.max(0, input.currentIndex);
  const visibleCount = input.levelCount > 0
    ? Math.min(SAGA_WINDOW_SIZE, input.levelCount)
    : SAGA_WINDOW_SIZE;

  // Forward-only window: the current level anchored at the bottom with locked
  // levels above it. Progression is endless (see levels/progression.ts — after
  // the final level the sequence loops back to level 20), so there is ALWAYS a
  // level ahead and the window never runs out of forward content.
  //
  // There is deliberately no end-of-sequence branch. An earlier port reproduced
  // v1's last-level presentation (window slides behind the current, showing four
  // COMPLETED green nodes and no gold sun). That is dropped by product decision
  // (2026-07-27): the map must always read current-gold-sun + locked-wood, so a
  // completed node can never appear. Keep it that way — the state a node can
  // carry here is `current` or `locked`, never `completed`.
  const ahead = visibleCount - 1;
  const windowEnd = currentIndex + ahead;
  const windowStart = currentIndex;

  // Top→bottom: highest index (furthest ahead) first; current/last-completed last.
  const indices = Array.from(
    { length: windowEnd - windowStart + 1 },
    (_, i) => windowEnd - i,
  );
  return indices.map((logicalIndex): LevelMapNode => {
    const state: LevelNodeState = logicalIndex === currentIndex ? 'current' : 'locked';
    const levelNumber = input.levelNumberFor?.(logicalIndex) ?? logicalIndex + 1;
    const name = input.nameFor?.(logicalIndex);
    return {
      id: logicalIndex,
      label: String(levelNumber),
      name: name !== undefined && name.length > 0
        ? `Level ${levelNumber}: ${name} ${state}`
        : `Level ${levelNumber} ${state}`,
      state,
    };
  });
}
