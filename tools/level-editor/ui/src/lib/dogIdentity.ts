/**
 * Stable per-dog identity helpers (plan -001 B2, spec -004 §6).
 *
 * The stable `id` is carried BY VALUE on each dog and its hitbox and is NEVER
 * re-derived from array position — re-derivation recreates the deletion-shift
 * bug B2 fixes (move/remove dog 7 must never change dog 8). `dog_index` and
 * array position remain only a legacy join/folder key; identity is `id`.
 *
 * A1 stamps `id` additively on `session.json` (backfilled or minted at
 * placement); legacy un-backfilled sessions have id-less records — callers
 * MUST handle `null` and degrade VISIBLY (spec §6.5), never silently re-index.
 */

/** Any record that may carry a stable id (a `DogState` or a `Hitbox`). */
type Identified = { id?: string | null };

/** The stable id of a dog/hitbox record, or `null` when absent (legacy
 * un-backfilled session). Callers branch on `null` for the visible-degrade
 * path (§6.5) — it is NOT interchangeable with "new id-less dog" (§6.4). */
export function dogIdOf(record: Identified | null | undefined): string | null {
  return record?.id ?? null;
}

/**
 * Mint a fresh stable id at placement so a newly-placed dog has identity from
 * gesture-zero (§6.4). The id survives the save round-trip unchanged; the
 * server's reconcile-by-id preserves a client-supplied id and mints only for
 * genuinely id-less legacy rows. `crypto.randomUUID` is available in the
 * editor's secure context (localhost + the https tunnel).
 */
export function newDogId(): string {
  return crypto.randomUUID();
}

/**
 * Resolve a record to `{ id, index }`: the id carried BY VALUE when present,
 * the live array `index` as the legacy fallback join key. The drag path reads
 * this ONCE at mousedown and carries the result; it never re-derives the id
 * from the (possibly-shifted) current position thereafter (§6.6, §8).
 */
export function resolveByIdOrIndex(
  record: Identified | null | undefined,
  index: number,
): { id: string | null; index: number } {
  return { id: dogIdOf(record), index };
}

/**
 * The stable, never-renumbering visible label (§6.7): the last 4 hex chars of
 * the stable id. A delete leaves every survivor's label unchanged — unlike a
 * dense 1..N ordinal, where deleting #7 makes old-#8 render as 7 and undercuts
 * the "dog 8 unchanged" guarantee even when the bytes are safe. Legacy id-less
 * records fall back to the array index (the surface shows a legacy banner,
 * §6.5, so the fallback is visibly distinguished, not silent).
 */
export function shortLabel(id: string | null | undefined, fallbackIndex: number): string {
  if (!id) return String(fallbackIndex);
  return id.replace(/-/g, '').slice(-4);
}
