import type { LevelDef, Side } from '../marble-board/types';
import {
  LEVEL_TOTAL,
  TEACH_PINS,
  lastWavePreferenceFor,
  openerSpreadFor,
  slotFor,
  targetFor,
  type Feature,
  type Slot,
} from './funnel-schedule';

export const DIFFICULTY_CONTRACT_VERSION = 1 as const;
export const EXPORT_CANDIDATE_VERSION = 1 as const;

export interface ContentFingerprint {
  readonly algorithm: 'sha256';
  readonly schedule: string;
  readonly levels: string;
  readonly manifest: string;
  readonly aggregate: string;
}

/** Fingerprints of the exact committed TypeScript bytes, never derived measurements. */
export const SHIPPED_BASELINE: ContentFingerprint = Object.freeze({
  algorithm: 'sha256',
  schedule: 'df8ba7e43ede52b6bb7107a3f60b82bd435e09a26ec10186c97e81978aa0afff',
  levels: 'ca5e42f77c5c4fa22ca84291cde2ac620083f48a82443a4e56a1e18263c300e4',
  manifest: '2a20cc4893468230651eb72efae5dec81ffb7f80de763f895b0d76e17a475a0d',
  aggregate: 'fd5dfd596334ec3efbdb616873beaec0321c1256f6a1f8662be6dbfdb2cca035',
});

export interface DifficultyRange { readonly min: number; readonly max: number }
export interface MappingAnchor { readonly difficulty: number; readonly value: number }
export interface DifficultyMappings {
  readonly marbleCount: readonly MappingAnchor[];
  readonly boardArea: readonly MappingAnchor[];
  readonly colorCount: readonly MappingAnchor[];
  readonly openingGenerosity: readonly MappingAnchor[];
  readonly solverWaveDepth: readonly MappingAnchor[];
}

export interface OnboardingEntry {
  readonly levelId: number;
  readonly targetRange: DifficultyRange;
  readonly role: 'onboarding';
  readonly mechanicDebut: Feature | null;
  readonly spotlight: boolean;
}

export interface BaseCycleSlot {
  readonly index: number;
  readonly role: Exclude<Slot, 'onboarding'>;
  readonly targetRange: DifficultyRange;
  readonly progression: 'fixed' | 'creeping' | 'alternating';
}

export interface CycleProgression {
  readonly difficultyOffsets: readonly number[];
  readonly maximumOffset: number;
  readonly affectedRoles: readonly Slot[];
  /** The shipped first cycle replaces the later cycles' ramp opening. */
  readonly firstCycleOpening: readonly BaseCycleSlot[];
}

export interface RoleRule {
  readonly role: Slot;
  readonly spreadOpeningRoutes: boolean;
  readonly finish: 'cascade' | 'thin';
}

export interface AuthoredDifficultyInputs {
  readonly onboarding: readonly OnboardingEntry[];
  readonly baseCycle: readonly BaseCycleSlot[];
  readonly progression: CycleProgression;
  readonly mappings: DifficultyMappings;
  readonly roleRules: readonly RoleRule[];
}

export type SeedProvenance =
  | { readonly provenance: 'unknown' }
  | { readonly provenance: 'pinned'; readonly seed: number; readonly source: string; readonly sourceHash: string }
  | { readonly provenance: 'reconstructed'; readonly seed: number; readonly method: string; readonly sourceHash: string };

export interface ExpandedLevelIdentity {
  readonly id: number;
  readonly baseCycleSlot: number | null;
  readonly seed: SeedProvenance;
}

export interface LevelLock { readonly levelId: number; readonly reason: string }
export type OverrideField = 'targetRange' | 'dimensions' | 'gatePlacement' | 'caps' | 'symmetryMode' | 'seed';
export interface LevelOverride {
  readonly levelId: number;
  readonly replaces: readonly OverrideField[];
  readonly values: Readonly<Record<string, unknown>>;
}

/** Measurements are explicitly a recomputable projection, not shipped-byte authority. */
export interface GeneratedEvidence {
  readonly levelId: number;
  readonly source: 'derived';
  readonly solvable: boolean;
  readonly targetRange: DifficultyRange;
  readonly measuredDifficulty: number;
  readonly marbleCount: number;
  readonly solverWaves: number;
  readonly initiallyMovableShare: number;
  readonly seed: SeedProvenance;
  readonly overrideState: 'inherited' | 'overridden' | 'locked';
}

export interface DifficultyDraft {
  readonly version: typeof DIFFICULTY_CONTRACT_VERSION;
  readonly baseline: ContentFingerprint;
  readonly authored: AuthoredDifficultyInputs;
  readonly levels: readonly ExpandedLevelIdentity[];
  readonly locks: readonly LevelLock[];
  readonly overrides: readonly LevelOverride[];
  readonly derivedEvidence: readonly Partial<GeneratedEvidence>[];
}

export interface ExportCandidate {
  readonly version: typeof EXPORT_CANDIDATE_VERSION;
  /** Fingerprint of the exact draft reviewed immediately before confirmation. */
  readonly reviewedDraftFingerprint: string;
  readonly baseline: ContentFingerprint;
  readonly authored: AuthoredDifficultyInputs;
  readonly levels: readonly ExpandedLevelIdentity[];
  readonly boards: readonly LevelDef[];
  readonly evidence: readonly GeneratedEvidence[];
  readonly locks: readonly LevelLock[];
  readonly overrides: readonly LevelOverride[];
  readonly validation: { readonly valid: boolean; readonly issues: readonly string[] };
  readonly changedLevelIds: readonly number[];
}

const DIFFICULTY_ANCHORS = [1, 3, 5, 7, 10, 13, 15, 17, 20] as const;
const MARBLE_VALUES = [6, 9, 12, 16, 25, 40, 54, 64, 80] as const;

function mapping(values: readonly number[]): readonly MappingAnchor[] {
  return DIFFICULTY_ANCHORS.map((difficulty, index) => ({ difficulty, value: values[index]! }));
}

function debutAt(levelId: number): Feature | null {
  return (Object.entries(TEACH_PINS).find(([, id]) => id === levelId)?.[0] as Feature | undefined) ?? null;
}

function exactRange(value: number): DifficultyRange { return { min: value, max: value }; }

function cycleSlot(levelId: number, index: number): BaseCycleSlot {
  const role = slotFor(levelId) as Exclude<Slot, 'onboarding'>;
  return {
    index,
    role,
    targetRange: exactRange(targetFor(levelId)),
    progression: role === 'band' || role === 'spike' ? 'creeping' : role === 'climax' ? 'alternating' : 'fixed',
  };
}

export function createDefaultDifficultyDraft(): DifficultyDraft {
  const onboarding = Array.from({ length: 11 }, (_, index): OnboardingEntry => {
    const levelId = index + 1;
    const mechanicDebut = debutAt(levelId);
    return { levelId, targetRange: exactRange(targetFor(levelId)), role: 'onboarding', mechanicDebut, spotlight: mechanicDebut !== null };
  });
  // Level 31 begins the first unmodified repetition of the canonical cycle.
  const baseCycle = Array.from({ length: 19 }, (_, index) => cycleSlot(31 + index, index));
  const firstCycleOpening = Array.from({ length: 3 }, (_, index) => cycleSlot(12 + index, index));
  const roleOrder: readonly Slot[] = ['onboarding', 'ramp', 'band', 'spike', 'recover', 'relax', 'climax'];
  const authored: AuthoredDifficultyInputs = {
    onboarding,
    baseCycle,
    progression: { difficultyOffsets: [0, 1, 2, 3, 3], maximumOffset: 3, affectedRoles: ['band', 'spike'], firstCycleOpening },
    mappings: {
      marbleCount: mapping(MARBLE_VALUES),
      boardArea: mapping([16, 20, 36, 40, 56, 80, 108, 130, 143]),
      colorCount: mapping([2, 2, 3, 4, 4, 5, 6, 6, 6]),
      openingGenerosity: mapping([0.5, 0.42, 0.34, 0.27, 0.2, 0.14, 0.1, 0.07, 0.05]),
      solverWaveDepth: mapping([1, 2, 2, 3, 4, 5, 6, 7, 8]),
    },
    roleRules: roleOrder.map((role) => ({
      role,
      spreadOpeningRoutes: role !== 'onboarding' && openerSpreadFor(role === 'ramp' ? 31 : role === 'recover' ? 36 : role === 'relax' ? 14 : 34),
      finish: lastWavePreferenceFor(role === 'spike' ? 35 : role === 'climax' ? 49 : 31),
    })),
  };
  const levels = Array.from({ length: LEVEL_TOTAL }, (_, index): ExpandedLevelIdentity => {
    const id = index + 1;
    const cyclePosition = id < 12 ? null : (id - 12) % 19;
    const baseCycleSlot = id <= 14 ? null : cyclePosition;
    return { id, baseCycleSlot, seed: { provenance: 'unknown' } };
  });
  return { version: DIFFICULTY_CONTRACT_VERSION, baseline: SHIPPED_BASELINE, authored, levels, locks: [], overrides: [], derivedEvidence: [] };
}

export function inheritedLevelIdsForBaseSlot(draft: DifficultyDraft, slotIndex: number): readonly number[] {
  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= 19) throw new RangeError('Base Cycle slot must be an integer from 0 to 18.');
  const locked = new Set(draft.locks.map(({ levelId }) => levelId));
  const detached = new Set(draft.overrides.map(({ levelId }) => levelId));
  return draft.levels
    .filter((level) => level.baseCycleSlot === slotIndex && !locked.has(level.id) && !detached.has(level.id))
    .map(({ id }) => id);
}

export function parseDifficultyDraft(input: unknown): DifficultyDraft {
  assertPlainRecord(input, '$');
  if (input.version !== DIFFICULTY_CONTRACT_VERSION) throw new TypeError('Unsupported difficulty contract version.');
  assertFingerprint(input.baseline, '$.baseline');
  assertPlainRecord(input.authored, '$.authored');
  assertArrayLength(input.authored.onboarding, 11, '$.authored.onboarding');
  input.authored.onboarding.forEach((entry, index) => {
    assertPlainRecord(entry, `$.authored.onboarding[${index}]`);
    if (entry.levelId !== index + 1) throw new TypeError('Onboarding level identities must be sequential.');
    assertRange(entry.targetRange, `$.authored.onboarding[${index}].targetRange`);
  });
  assertArrayLength(input.authored.baseCycle, 19, '$.authored.baseCycle');
  input.authored.baseCycle.forEach((entry, index) => {
    assertPlainRecord(entry, `$.authored.baseCycle[${index}]`);
    if (entry.index !== index) throw new TypeError('Base Cycle slot identities must be sequential.');
    assertRange(entry.targetRange, `$.authored.baseCycle[${index}].targetRange`);
  });
  assertPlainRecord(input.authored.mappings, '$.authored.mappings');
  for (const name of ['marbleCount', 'boardArea', 'colorCount', 'openingGenerosity', 'solverWaveDepth']) {
    assertMapping(input.authored.mappings[name], `$.authored.mappings.${name}`);
  }
  assertArrayLength(input.levels, LEVEL_TOTAL, '$.levels');
  const identities = new Set<number>();
  input.levels.forEach((level, index) => {
    assertPlainRecord(level, `$.levels[${index}]`);
    assertIntegerInRange(level.id, 1, LEVEL_TOTAL, `$.levels[${index}].id`);
    identities.add(level.id as number);
    assertSeed(level.seed, `$.levels[${index}].seed`);
  });
  if (identities.size !== LEVEL_TOTAL || [...identities].some((id, index) => id !== index + 1)) throw new TypeError('Level identities must contain exactly 1 through 110 once each.');
  assertArray(input.locks, '$.locks');
  input.locks.forEach((lock, index) => {
    assertPlainRecord(lock, `$.locks[${index}]`);
    assertIntegerInRange(lock.levelId, 1, LEVEL_TOTAL, `$.locks[${index}].levelId`);
  });
  assertArray(input.overrides, '$.overrides');
  input.overrides.forEach((override, index) => {
    assertPlainRecord(override, `$.overrides[${index}]`);
    assertIntegerInRange(override.levelId, 1, LEVEL_TOTAL, `$.overrides[${index}].levelId`);
    assertArray(override.replaces, `$.overrides[${index}].replaces`);
    if (override.replaces.length === 0 || override.replaces.some((field) => !OVERRIDE_FIELDS.has(field as OverrideField))) throw new TypeError('Override must reference supported inherited fields.');
    assertPlainRecord(override.values, `$.overrides[${index}].values`);
    if (override.replaces.includes('targetRange')) assertRange(override.values.targetRange, `$.overrides[${index}].values.targetRange`);
    validateOverrideBounds(override.values, `$.overrides[${index}].values`);
  });
  canonicalDifficultyJson(input);
  return input as unknown as DifficultyDraft;
}

const OVERRIDE_FIELDS = new Set<OverrideField>(['targetRange', 'dimensions', 'gatePlacement', 'caps', 'symmetryMode', 'seed']);

function validateOverrideBounds(values: Record<string, unknown>, path: string): void {
  if (values.dimensions !== undefined) {
    assertPlainRecord(values.dimensions, `${path}.dimensions`);
    assertIntegerInRange(values.dimensions.cols, 4, 20, `${path}.dimensions.cols`);
    assertIntegerInRange(values.dimensions.rows, 4, 20, `${path}.dimensions.rows`);
  }
  if (values.gatePlacement !== undefined) {
    assertArray(values.gatePlacement, `${path}.gatePlacement`);
    const sides = new Set<Side>(['top', 'bottom', 'left', 'right']);
    for (const gate of values.gatePlacement) {
      assertPlainRecord(gate, `${path}.gatePlacement[]`);
      if (!sides.has(gate.side as Side)) throw new TypeError(`${path}.gatePlacement has an invalid side.`);
      assertIntegerInRange(gate.index, 0, 19, `${path}.gatePlacement[].index`);
    }
  }
  if (values.symmetryMode !== undefined && values.symmetryMode !== 'mirror' && values.symmetryMode !== 'asymmetric') throw new TypeError(`${path}.symmetryMode is invalid.`);
  if (values.seed !== undefined && (!Number.isSafeInteger(values.seed) || (values.seed as number) < 0)) throw new TypeError(`${path}.seed must be a non-negative safe integer.`);
}

function assertFingerprint(value: unknown, path: string): asserts value is Record<string, unknown> {
  assertPlainRecord(value, path);
  if (value.algorithm !== 'sha256') throw new TypeError(`${path}.algorithm must be sha256.`);
  for (const field of ['schedule', 'levels', 'manifest', 'aggregate']) if (typeof value[field] !== 'string' || !/^[a-f0-9]{64}$/.test(value[field] as string)) throw new TypeError(`${path}.${field} must be a SHA-256 hex digest.`);
}

function assertSeed(value: unknown, path: string): void {
  assertPlainRecord(value, path);
  if (value.provenance === 'unknown') return;
  if (value.provenance !== 'pinned' && value.provenance !== 'reconstructed') throw new TypeError(`${path} has invalid seed provenance.`);
  if (!Number.isSafeInteger(value.seed)) throw new TypeError(`${path}.seed must be a safe integer.`);
  if (typeof value.sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.sourceHash)) throw new TypeError(`${path}.sourceHash must be a SHA-256 hex digest.`);
}

function assertMapping(value: unknown, path: string): void {
  assertArray(value, path);
  if (value.length === 0) throw new TypeError(`${path} must contain anchors.`);
  let previous = 0;
  value.forEach((anchor, index) => {
    assertPlainRecord(anchor, `${path}[${index}]`);
    assertFiniteInRange(anchor.difficulty, 1, 20, `${path}[${index}].difficulty`);
    if ((anchor.difficulty as number) <= previous) throw new TypeError(`${path} anchors must use strictly increasing difficulty.`);
    previous = anchor.difficulty as number;
    if (typeof anchor.value !== 'number' || !Number.isFinite(anchor.value)) throw new TypeError(`${path}[${index}].value must be finite.`);
  });
}

function assertRange(value: unknown, path: string): void {
  assertPlainRecord(value, path);
  assertFiniteInRange(value.min, 1, 20, `${path}.min`);
  assertFiniteInRange(value.max, 1, 20, `${path}.max`);
  if ((value.min as number) > (value.max as number)) throw new TypeError(`${path}.min must not exceed max.`);
}

function assertFiniteInRange(value: unknown, min: number, max: number, path: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new TypeError(`${path} must be finite and between ${min} and ${max}.`);
}
function assertIntegerInRange(value: unknown, min: number, max: number, path: string): void {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) throw new TypeError(`${path} must be an integer between ${min} and ${max}.`);
}
function assertArray(value: unknown, path: string): asserts value is unknown[] { if (!Array.isArray(value)) throw new TypeError(`${path} must be an array.`); }
function assertArrayLength(value: unknown, length: number, path: string): asserts value is unknown[] { assertArray(value, path); if (value.length !== length) throw new TypeError(`${path} must contain ${length} entries.`); }
function assertPlainRecord(value: unknown, path: string): asserts value is Record<string, unknown> { if (value === null || typeof value !== 'object' || Array.isArray(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) throw new TypeError(`${path} must be a plain object.`); }

type CanonicalValue = null | boolean | number | string | CanonicalValue[] | { [key: string]: CanonicalValue };
function canonicalValue(value: unknown, path: string, seen: WeakSet<object>): CanonicalValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${path} must contain only finite numbers.`);
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== 'object') throw new TypeError(`${path} contains a non-JSON value.`);
  if (seen.has(value)) throw new TypeError(`${path} contains a cycle.`);
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map((entry, index) => canonicalValue(entry, `${path}[${index}]`, seen));
    assertPlainRecord(value, path);
    const result: { [key: string]: CanonicalValue } = Object.create(null);
    for (const key of Object.keys(value).sort()) result[key] = canonicalValue(value[key], `${path}.${key}`, seen);
    return result;
  } finally { seen.delete(value); }
}

export function canonicalDifficultyJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value, '$', new WeakSet<object>()));
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('SHA-256 requires the standard Web Crypto API.');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function fingerprintCanonicalDifficultyJson(value: unknown): Promise<string> {
  return sha256Hex(new TextEncoder().encode(canonicalDifficultyJson(value)));
}

export async function fingerprintShippedBytes(bytes: { readonly schedule: string; readonly levels: string; readonly manifest: string }): Promise<ContentFingerprint> {
  const encoder = new TextEncoder();
  const entries = [
    ['funnel-schedule.ts', bytes.schedule],
    ['levels.generated.ts', bytes.levels],
    ['levels.manifest.generated.ts', bytes.manifest],
  ] as const;
  const encoded = entries.map(([name, content]) => [name, encoder.encode(content)] as const);
  const framed = encoded.flatMap(([name, content]) => [encoder.encode(name), new Uint8Array([0]), encoder.encode(String(content.byteLength)), new Uint8Array([0]), content]);
  const aggregateLength = framed.reduce((total, part) => total + part.byteLength, 0);
  const aggregate = new Uint8Array(aggregateLength);
  let offset = 0;
  for (const part of framed) { aggregate.set(part, offset); offset += part.byteLength; }
  return {
    algorithm: 'sha256',
    schedule: await sha256Hex(encoded[0]![1]),
    levels: await sha256Hex(encoded[1]![1]),
    manifest: await sha256Hex(encoded[2]![1]),
    aggregate: await sha256Hex(aggregate),
  };
}
