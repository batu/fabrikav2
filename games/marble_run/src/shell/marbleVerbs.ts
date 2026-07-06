/**
 * Pure selection logic for the marble_run game verbs (`tapUnlockedMarble`,
 * `tapBlockedMarble`). Kept side-effect-free and DOM-free so it is unit-testable
 * without a live engine, and — critically — so a verb's `run` (state-drive) and
 * `clientPoint` (input-drive) flavours compute the IDENTICAL target for the same
 * `roll`. The `GameVerbHandler` contract (`@fabrikav2/testkit/harness`) requires
 * the two flavours never diverge; making selection a pure function of
 * `(pool, roll)` guarantees it (brainstorm §4.2 resolution: roll-driven, not
 * internally-random, so a seeded chaos run is reproducible).
 */

/** Anything with a stable identity + board cell — the shape both marble pools
 *  (movable / blocked) share. */
export interface CellHolder {
  readonly id: number;
  readonly cell: { readonly x: number; readonly y: number };
}

/**
 * Deterministically pick one element of `pool` from a roll in `[0, 1)`. Returns
 * `null` for an empty pool (no legal target — the caller treats it as a no-op).
 * A roll of exactly `1` (or out of range) is clamped into the last slot rather
 * than overflowing, so any RNG output selects a valid element.
 */
export function pickByRoll<T>(pool: readonly T[], roll: number): T | null {
  if (pool.length === 0) return null;
  const safe = Number.isFinite(roll) ? roll : 0;
  const clamped = safe < 0 ? 0 : safe >= 1 ? 1 - Number.EPSILON : safe;
  return pool[Math.floor(clamped * pool.length)] ?? null;
}

/**
 * The blocked (non-movable) marbles = every marble minus the movable set. There
 * is no stored blocked flag on the engine (`MarbleState = {id,color,cell}`);
 * movability is computed, so the adversarial verb derives its pool by exclusion.
 */
export function blockedMarbles<T extends CellHolder>(
  all: readonly T[],
  movable: readonly T[],
): T[] {
  const movableIds = new Set(movable.map((m) => m.id));
  return all.filter((m) => !movableIds.has(m.id));
}
