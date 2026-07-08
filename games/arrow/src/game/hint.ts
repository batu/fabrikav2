/**
 * Hint — returns the head coord of one currently-exitable path on
 * the board, or null if none exists. Caller draws the glow at that
 * cell via the viewport transform.
 *
 * "Exitable" = slitherOutcome is exit (see slither.ts). Multiple
 * arrows may be exitable at once; we return the lowest id for
 * deterministic behavior.
 */

import type { PathGrid } from "./path.js";
import { canExit } from "./slither.js";

export function findLegalArrow(grid: PathGrid): { x: number; y: number } | null {
  // Iterate by id order for determinism.
  const ids = [...grid.arrows.keys()].sort((a, b) => a - b);
  for (const id of ids) {
    const p = grid.arrows.get(id)!;
    if (canExit(grid, p)) {
      const head = p.cells[p.cells.length - 1]!;
      return { x: head.x, y: head.y };
    }
  }
  return null;
}
