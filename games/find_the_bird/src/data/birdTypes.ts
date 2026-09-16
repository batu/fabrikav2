/**
 * Bird type tags: which species each level bird is, for the Collection counter.
 *
 * The tags are a build-time artifact (`public/levels/bird-types.json`, produced
 * by `tools/birdtypes/classify.py` through agy image classification) rather than
 * a runtime model call — the mapping is fixed once the level art is fixed.
 *
 * Absent entries are NOT an error: a level or bird missing from the file reads
 * as `null` ("unknown"), which counts as "not a sparrow". The file can therefore
 * ship partially classified and only under-counts; it never throws and never
 * mis-attributes a pickup.
 */

export type BirdType = string;

export interface BirdTypeIndex {
  readonly version: number;
  readonly levels: Readonly<Record<string, Readonly<Record<string, BirdType>>>>;
}

const EMPTY_INDEX: BirdTypeIndex = { version: 0, levels: {} };

let indexPromise: Promise<BirdTypeIndex> | null = null;
let indexSnapshot: BirdTypeIndex | null = null;

function parseIndex(raw: unknown): BirdTypeIndex {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return EMPTY_INDEX;
  const record = raw as Record<string, unknown>;
  const version = typeof record.version === 'number' && Number.isSafeInteger(record.version)
    ? record.version
    : 0;
  const levelsRaw = record.levels;
  if (levelsRaw === null || typeof levelsRaw !== 'object' || Array.isArray(levelsRaw)) {
    return { version, levels: {} };
  }
  const levels: Record<string, Record<string, BirdType>> = {};
  for (const [levelId, dogsRaw] of Object.entries(levelsRaw as Record<string, unknown>)) {
    if (dogsRaw === null || typeof dogsRaw !== 'object' || Array.isArray(dogsRaw)) continue;
    const dogs: Record<string, BirdType> = {};
    for (const [dogId, type] of Object.entries(dogsRaw as Record<string, unknown>)) {
      if (typeof type === 'string' && type.length > 0) dogs[dogId] = type;
    }
    levels[levelId] = dogs;
  }
  return { version, levels };
}

/**
 * Load and cache the tag index. A failed fetch resolves to the empty index
 * instead of rejecting: missing tags degrade the Collection counter, they must
 * never break level loading or the find loop.
 */
export async function loadBirdTypes(): Promise<BirdTypeIndex> {
  if (indexPromise !== null) return indexPromise;
  const pending = (async (): Promise<BirdTypeIndex> => {
    try {
      const response = await fetch('levels/bird-types.json');
      if (!response.ok) return EMPTY_INDEX;
      return parseIndex(await response.json());
    } catch {
      return EMPTY_INDEX;
    }
  })();
  pending.then((index) => { indexSnapshot = index; }).catch(() => { indexSnapshot = EMPTY_INDEX; });
  indexPromise = pending;
  return pending;
}

/** Synchronous view of whatever `loadBirdTypes` last resolved. Null before it does. */
export function birdTypeSnapshot(): BirdTypeIndex | null {
  return indexSnapshot;
}

/** The tagged type for one bird, or null when the level or bird is untagged. */
export function birdType(
  index: BirdTypeIndex | null,
  levelId: string,
  dogId: string,
): BirdType | null {
  return index?.levels[levelId]?.[dogId] ?? null;
}

/** True only for a bird explicitly tagged as a house sparrow. */
export function isSparrow(
  index: BirdTypeIndex | null,
  levelId: string,
  dogId: string,
): boolean {
  return birdType(index, levelId, dogId) === 'sparrow';
}

/** Test seam: drop the cached index between unit tests. */
export function resetBirdTypesForTest(): void {
  indexPromise = null;
  indexSnapshot = null;
}

/** Test seam: install an index without a fetch. */
export function setBirdTypesForTest(index: BirdTypeIndex): void {
  indexSnapshot = index;
  indexPromise = Promise.resolve(index);
}
