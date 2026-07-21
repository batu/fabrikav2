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
}

export function buildSagaNodes(input: SagaInput): LevelMapNode[] {
  const currentIndex = Math.max(0, input.currentIndex);
  const visibleCount = input.levelCount > 0
    ? Math.min(SAGA_WINDOW_SIZE, input.levelCount)
    : SAGA_WINDOW_SIZE;

  // Top→bottom: highest offset (furthest ahead, locked) first; current (offset 0) last.
  const offsets = Array.from({ length: visibleCount }, (_, i) => visibleCount - 1 - i);
  return offsets.map((offset): LevelMapNode => {
    const logicalIndex = currentIndex + offset;
    const state: LevelNodeState = offset === 0 ? 'current' : 'locked';
    const levelNumber = logicalIndex + 1;
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
