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

  // Forward-only window: current + up to 3 locked-ahead levels. Near the end of
  // the sequence there are no ahead levels, so the window slides back to reveal
  // the COMPLETED levels behind the current — v1 level-map parity, where the
  // last completed nodes (green candy) sit above the current (device-parity
  // MRV2-9 U2b/U4; ref refs/level-map.png). `maxIndex` clamps the forward reach.
  const maxIndex = input.levelCount > 0
    ? input.levelCount - 1
    : currentIndex + (SAGA_WINDOW_SIZE - 1);
  const ahead = Math.max(0, Math.min(visibleCount - 1, maxIndex - currentIndex));

  // End-of-content parity (device-parity MRV2-10 U3, ref refs/level-map.png):
  // when the current level is the LAST level there are no locked-ahead nodes and
  // v1 does NOT render the current gold-sun in the chain — the LEVEL button below
  // stands in for it. Instead the window shows only the prior COMPLETED nodes
  // (e.g. current=110 → completed 106-109, no sun). Detect that case (no ahead
  // levels but there IS history behind) and slide the whole window behind the
  // current so no node equals currentIndex.
  const behindOnly = ahead === 0 && currentIndex > 0;
  const windowEnd = behindOnly ? currentIndex - 1 : currentIndex + ahead;
  const windowStart = Math.max(0, windowEnd - (visibleCount - 1));

  // Top→bottom: highest index (furthest ahead) first; current/last-completed last.
  const indices = Array.from(
    { length: windowEnd - windowStart + 1 },
    (_, i) => windowEnd - i,
  );
  return indices.map((logicalIndex): LevelMapNode => {
    const state: LevelNodeState = logicalIndex < currentIndex
      ? 'completed'
      : logicalIndex === currentIndex
        ? 'current'
        : 'locked';
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
