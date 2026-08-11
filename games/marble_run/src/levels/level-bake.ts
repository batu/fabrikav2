/** Pure, deterministic composition for the v2 Marble Run generator. */
import { generateLevel, gateColorsCovered, mirrorDistance, type GenerateParams } from '../marble-board/generate';
import { scoreLevel } from '../marble-board/score';
import { analyzeDifficulty } from '../marble-board/solver';
import {
  ALL_SHAPE_KINDS,
  buildShape,
  landmarkShapes,
  validGateIndices,
  type ShapeKind,
} from '../marble-board/shapes';
import type { GateDef, LevelDef, MarbleColor, Side } from '../marble-board/types';
import { canonicalDifficultyJson, type GeneratedEvidence, type SeedProvenance } from './difficulty-contract';
import {
  LEVEL_TOTAL,
  TEACH_PINS,
  allowsPlugs,
  allowsVoids,
  boardSizeFor,
  effectiveTargetFor,
  lastWavePreferenceFor,
  marbleCapFor,
  minOpenersFor,
  openerSpreadFor,
  paletteFor,
  sculptsAt,
  slotFor,
  symmetryModeFor,
  targetFor,
  type Slot,
} from './funnel-schedule';
import { LEVELS } from './levels.generated';
import { LEVEL_MANIFEST, type LevelManifestEntry } from './levels.manifest.generated';

export const HISTORICAL_BAKE_SOURCE = Object.freeze({
  repositoryRevision: 'b3c3ae91bdfa8ca4f10e70da4823101f29d8dd92',
  path: 'games/marble_run/sugar3d/scripts/generate-levels.ts',
  sha256: 'd62a1a7756548989f4265a72e9085bb86e23b72d272348b785af830d47b64f20',
});

export const DEFAULT_MAX_RESEEDS = 80;
export const ACCEPT_WINDOW = 1.5;
const RESEED_STRIDE = 10007;
const SEED_OFFSET = 40000;
const SIDES: readonly Side[] = ['top', 'bottom', 'left', 'right'];
const VOID_KINDS = new Set<ShapeKind>([
  'corners', 'diamond', 'ring', 'cross', 'hourglass', 'frame-notch', 'twin-holes', 'arena',
]);
const PLUG_KINDS = new Set<ShapeKind>(['pillars', 'checker-plugs']);

export interface PriorBakeEvidence {
  readonly levelId: number;
  readonly slot: Slot;
  readonly measuredDifficulty: number;
}

export interface BakeLevelInput {
  readonly id: number;
  readonly shapeKind: ShapeKind;
  readonly priorEvidence: readonly PriorBakeEvidence[];
  readonly maxReseeds?: number;
  /** Wall-clock diagnostic ceiling, checked at reseed boundaries. Omitted for the exact oracle. */
  readonly deadlineMs?: number;
  readonly targetRange?: { readonly min: number; readonly max: number };
  readonly seed?: number;
  readonly overrideState?: GeneratedEvidence['overrideState'];
  readonly params?: Partial<Omit<GenerateParams, 'id' | 'seed'>>;
  /** Editor-authored mechanic spotlight. Null explicitly disables the shipped debut marker invariant. */
  readonly requiredShapeMarker?: 'X' | '#' | null;
}

export interface BakeEvidence extends GeneratedEvidence, PriorBakeEvidence {
  readonly shapeKind: ShapeKind;
  readonly reseeds: number;
  readonly mirrorDistance: number;
}

export type BakeFailureCode =
  | 'invalid-input'
  | 'missing-climax-dependency'
  | 'reseed-exhausted'
  | 'time-limit'
  | 'hard-invariant';

export interface BakeFailure {
  readonly code: BakeFailureCode;
  readonly levelId: number;
  readonly attempts: number;
  readonly reason: string;
  readonly bestMeasuredDifficulty?: number;
}

export type BakeLevelResult =
  | { readonly ok: true; readonly level: LevelDef; readonly evidence: BakeEvidence; readonly manifest: LevelManifestEntry }
  | { readonly ok: false; readonly failure: BakeFailure };

function candidateKinds(id: number): readonly ShapeKind[] {
  const unlocked = ALL_SHAPE_KINDS.filter((kind) => {
    if (kind === 'plain') return true;
    if (kind === 'butterfly') return allowsVoids(id) && allowsPlugs(id);
    if (VOID_KINDS.has(kind)) return allowsVoids(id);
    if (PLUG_KINDS.has(kind)) return allowsPlugs(id);
    return false;
  });
  if (id === TEACH_PINS.plugs) return unlocked.filter((kind) => PLUG_KINDS.has(kind) || kind === 'butterfly');
  if (id === TEACH_PINS.voids) return unlocked.filter((kind) => VOID_KINDS.has(kind) || kind === 'butterfly');
  const wantsLandmark = slotFor(id) === 'spike' || slotFor(id) === 'climax';
  let pool = unlocked.filter((kind) => wantsLandmark ? landmarkShapes.includes(kind) : !landmarkShapes.includes(kind));
  if (slotFor(id) === 'climax') pool = pool.filter((kind) => kind !== 'diamond' && kind !== 'butterfly');
  return pool.length > 0 ? pool : unlocked;
}

export function pickShapeKind(id: number, previous: ShapeKind | null): ShapeKind {
  const { cols, rows } = boardSizeFor(id);
  if (!sculptsAt(cols, rows)) return 'plain';
  const pool = candidateKinds(id);
  const start = id % pool.length;
  for (let offset = 0; offset < pool.length; offset += 1) {
    const kind = pool[(start + offset) % pool.length]!;
    if (kind !== previous) return kind;
  }
  return pool[start]!;
}

export function buildBakeGates(
  shape: readonly string[],
  colors: readonly MarbleColor[],
  target: number,
): GateDef[] {
  const gates: GateDef[] = [];
  const used = new Set<string>();
  const place = (color: MarbleColor, nth: number): void => {
    for (let sideOffset = 0; sideOffset < SIDES.length; sideOffset += 1) {
      const side = SIDES[(nth + sideOffset) % SIDES.length]!;
      const valid = validGateIndices(shape, side);
      for (let offset = 0; offset < valid.length; offset += 1) {
        const index = valid[Math.floor(((offset + nth) * valid.length) / (valid.length + 1)) % valid.length]!;
        const key = `${side}:${index}`;
        if (used.has(key)) continue;
        used.add(key);
        gates.push({ side, index, color });
        return;
      }
    }
    throw new Error(`no free gate slot for ${color} (${nth})`);
  };
  colors.forEach(place);
  const extras = Math.max(0, Math.min(3, Math.floor((target - 10) / 4)));
  for (let extra = 0; extra < extras; extra += 1) place(colors[extra % colors.length]!, colors.length + extra);
  return gates;
}

export function resolveBakeSymmetry(
  id: number,
  shape: readonly string[],
  marbleTarget: number,
  colorCount: number,
): 'mirror' | 'asymmetric' {
  if (symmetryModeFor(id) === 'asymmetric') return 'asymmetric';
  if (mirrorDistance(shape, shape[0]!.length) !== 0) return 'asymmetric';
  if (marbleTarget < colorCount * 2) return 'asymmetric';
  return 'mirror';
}

export function bakeParamsFor(id: number, kind: ShapeKind): Omit<GenerateParams, 'seed'> {
  const { cols, rows, marbleTarget } = boardSizeFor(id);
  const shape = buildShape(kind, cols, rows);
  const colors = paletteFor(id);
  return {
    id,
    cols,
    rows,
    shape,
    gates: buildBakeGates(shape, colors, effectiveTargetFor(id)),
    colors,
    marbleTarget,
    marbleCap: marbleCapFor(id),
    minOpeners: minOpenersFor(id),
    symmetryMode: resolveBakeSymmetry(id, shape, marbleTarget, colors.length),
    lastWavePreference: lastWavePreferenceFor(id),
    openerSpread: openerSpreadFor(id),
  };
}

function reconstructedSeed(seed: number): SeedProvenance {
  return {
    provenance: 'reconstructed',
    seed,
    method: 'historical deterministic seed formula',
    sourceHash: HISTORICAL_BAKE_SOURCE.sha256,
  };
}

function failure(code: BakeFailureCode, id: number, attempts: number, reason: string, best?: number): BakeLevelResult {
  return { ok: false, failure: { code, levelId: id, attempts, reason, ...(best === undefined ? {} : { bestMeasuredDifficulty: best }) } };
}

export function difficultyRangeDistance(value: number, range: { readonly min: number; readonly max: number }): number {
  return value < range.min ? range.min - value : value > range.max ? value - range.max : 0;
}

export function bakeLevel(input: BakeLevelInput): BakeLevelResult {
  const started = performance.now();
  const maxReseeds = input.maxReseeds ?? DEFAULT_MAX_RESEEDS;
  if (!Number.isInteger(input.id) || input.id < 1 || input.id > LEVEL_TOTAL || !Number.isInteger(maxReseeds) || maxReseeds < 0) {
    return failure('invalid-input', input.id, 0, 'level id or reseed bound is outside the supported campaign contract');
  }
  const base = { ...bakeParamsFor(input.id, input.shapeKind), ...input.params };
  const target = effectiveTargetFor(input.id);
  const targetRange = input.targetRange ?? { min: target - ACCEPT_WINDOW, max: target + ACCEPT_WINDOW };
  const cycleSpikes = input.priorEvidence.filter((row) =>
    row.levelId >= input.id - 18 && row.levelId < input.id && row.slot === 'spike',
  );
  const isClimax = slotFor(input.id) === 'climax';
  if (isClimax && cycleSpikes.length === 0) {
    return failure('missing-climax-dependency', input.id, 0, 'climax requires preceding spike evidence from its cycle');
  }
  const climaxFloor = isClimax ? Math.max(...cycleSpikes.map((row) => row.measuredDifficulty)) + 0.3 : null;
  const baseSeed = input.seed ?? SEED_OFFSET + input.id * 1013;
  let best: { level: LevelDef; measured: number; reseeds: number; seed: number } | null = null;
  for (let reseed = 0; reseed < maxReseeds; reseed += 1) {
    if (input.deadlineMs !== undefined && performance.now() - started >= input.deadlineMs) {
      return failure('time-limit', input.id, reseed, `per-level diagnostic ceiling of ${input.deadlineMs}ms exceeded`, best?.measured);
    }
    const seed = baseSeed + reseed * RESEED_STRIDE;
    let level: LevelDef;
    try {
      level = generateLevel({ ...base, seed });
    } catch {
      continue;
    }
    if (input.deadlineMs !== undefined && performance.now() - started >= input.deadlineMs) {
      return failure('time-limit', input.id, reseed + 1, `per-level diagnostic ceiling of ${input.deadlineMs}ms exceeded`, best?.measured);
    }
    const measured = scoreLevel(level);
    const accepted = measured >= targetRange.min && measured <= targetRange.max && (climaxFloor === null || measured >= climaxFloor);
    if (accepted) {
      best = { level, measured, reseeds: reseed, seed };
      break;
    }
    if (best === null || difficultyRangeDistance(measured, targetRange) < difficultyRangeDistance(best.measured, targetRange)) {
      best = { level, measured, reseeds: reseed, seed };
    }
  }
  if (best === null || best.measured < targetRange.min || best.measured > targetRange.max || (climaxFloor !== null && best.measured < climaxFloor)) {
    return failure('reseed-exhausted', input.id, maxReseeds, `no candidate satisfied target and dependency invariants`, best?.measured);
  }
  if (!gateColorsCovered(best.level)) return failure('hard-invariant', input.id, best.reseeds + 1, 'orphan gate survived generator acceptance');
  const board = best.level.cells.join('');
  const requiredShapeMarker = input.requiredShapeMarker === undefined
    ? input.id === TEACH_PINS.plugs ? 'X' : input.id === TEACH_PINS.voids ? '#' : null
    : input.requiredShapeMarker;
  if (requiredShapeMarker !== null && !board.includes(requiredShapeMarker)) {
    return failure('hard-invariant', input.id, best.reseeds + 1, `${requiredShapeMarker === 'X' ? 'plugs' : 'voids'} debut has no visible marker`);
  }
  const report = analyzeDifficulty(best.level);
  const distance = mirrorDistance(best.level.cells, best.level.cols);
  const evidence: BakeEvidence = {
    levelId: input.id,
    slot: slotFor(input.id),
    source: 'derived',
    solvable: true,
    targetRange,
    measuredDifficulty: best.measured,
    marbleCount: report.marbles,
    solverWaves: report.waves,
    initiallyMovableShare: report.initialMovableFraction,
    seed: reconstructedSeed(best.seed),
    overrideState: input.overrideState ?? 'inherited',
    shapeKind: input.shapeKind,
    reseeds: best.reseeds,
    mirrorDistance: distance,
  };
  return {
    ok: true,
    level: best.level,
    evidence,
    manifest: { id: input.id, slot: slotFor(input.id), target: targetFor(input.id), shapeKind: input.shapeKind, symmetric: distance === 0 },
  };
}

export interface CampaignBakeResult {
  readonly levels: readonly LevelDef[];
  readonly manifest: readonly LevelManifestEntry[];
  readonly evidence: readonly BakeEvidence[];
  readonly complete: boolean;
  readonly failure?: BakeFailure;
  readonly timings: { readonly perBoardMs: readonly number[]; readonly fullCampaignMs: number };
}

export interface BakeCampaignOptions {
  /** Defaults to LEVEL_TOTAL. A lower value exists for bounded characterization, never for export. */
  readonly maxLevels?: number;
  readonly perLevelDeadlineMs?: number;
  readonly campaignDeadlineMs?: number;
  /** Observational only; useful for progress evidence without logging in the bake module. */
  readonly onLevel?: (levelId: number, elapsedMs: number, result: BakeLevelResult) => void;
  /** Checked between boards. A cancelled result is explicitly incomplete. */
  readonly shouldCancel?: () => boolean;
}

export function bakeCampaign(options: BakeCampaignOptions = {}): CampaignBakeResult {
  const started = performance.now();
  const levels: LevelDef[] = [];
  const manifest: LevelManifestEntry[] = [];
  const evidence: BakeEvidence[] = [];
  const perBoardMs: number[] = [];
  let previous: ShapeKind | null = null;
  const maxLevels = Math.min(LEVEL_TOTAL, Math.max(0, options.maxLevels ?? LEVEL_TOTAL));
  for (let id = 1; id <= maxLevels; id += 1) {
    if (options.shouldCancel?.()) break;
    if (options.campaignDeadlineMs !== undefined && performance.now() - started >= options.campaignDeadlineMs) {
      const result = failure('time-limit', id, 0, `campaign diagnostic ceiling of ${options.campaignDeadlineMs}ms exceeded`);
      if (!result.ok) {
        options.onLevel?.(id, 0, result);
        return { levels, manifest, evidence, complete: false, failure: result.failure, timings: { perBoardMs, fullCampaignMs: performance.now() - started } };
      }
    }
    const boardStarted = performance.now();
    const shapeKind = pickShapeKind(id, previous);
    const result = bakeLevel({ id, shapeKind, priorEvidence: evidence, deadlineMs: options.perLevelDeadlineMs });
    const elapsedMs = performance.now() - boardStarted;
    options.onLevel?.(id, elapsedMs, result);
    if (!result.ok) {
      return { levels, manifest, evidence, complete: false, failure: result.failure, timings: { perBoardMs, fullCampaignMs: performance.now() - started } };
    }
    levels.push(result.level);
    manifest.push(result.manifest);
    evidence.push(result.evidence);
    previous = shapeKind;
    perBoardMs.push(elapsedMs);
  }
  return {
    levels,
    manifest,
    evidence,
    complete: levels.length === LEVEL_TOTAL,
    timings: { perBoardMs, fullCampaignMs: performance.now() - started },
  };
}

export type BaselineMismatchCategory = 'serialization' | 'engine' | 'missing-provenance';
export interface BaselineMismatch {
  readonly levelId: number;
  readonly category: BaselineMismatchCategory;
  readonly component: 'level' | 'manifest' | 'seed';
  readonly reason: string;
}
export interface BaselineCharacterizationReport {
  readonly total: number;
  readonly attempted: number;
  readonly exact: number;
  readonly mismatches: readonly BaselineMismatch[];
  readonly mismatchCounts: { readonly serialization: number; readonly engine: number; readonly missingProvenance: number };
  readonly timings: { readonly perBoardMs: { readonly p50: number; readonly p95: number; readonly max: number }; readonly fullCampaignMs: number };
}

function percentile(sorted: readonly number[], quantile: number): number {
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)] ?? 0;
}

export function characterizeShippedBaseline(baked: CampaignBakeResult = bakeCampaign()): BaselineCharacterizationReport {
  const mismatches: BaselineMismatch[] = [];
  for (let index = 0; index < LEVEL_TOTAL; index += 1) {
    const generated = baked.levels[index];
    const shipped = LEVELS[index]!;
    if (generated === undefined) {
      mismatches.push({ levelId: index + 1, category: 'missing-provenance', component: 'seed', reason: 'board was not attempted by bounded characterization' });
      continue;
    }
    if (JSON.stringify(generated) !== JSON.stringify(shipped)) {
      const structurallyEqual = canonicalDifficultyJson(generated) === canonicalDifficultyJson(shipped);
      mismatches.push({ levelId: index + 1, category: structurallyEqual ? 'serialization' : 'engine', component: 'level', reason: structurallyEqual ? 'property serialization differs' : 'generated board differs' });
    }
    if (JSON.stringify(baked.manifest[index]) !== JSON.stringify(LEVEL_MANIFEST[index])) {
      mismatches.push({ levelId: index + 1, category: 'engine', component: 'manifest', reason: 'generated manifest differs' });
    }
    if (baked.evidence[index]!.seed.provenance !== 'reconstructed') {
      mismatches.push({ levelId: index + 1, category: 'missing-provenance', component: 'seed', reason: 'historical seed was not reconstructed' });
    }
  }
  const times = [...baked.timings.perBoardMs].sort((a, b) => a - b);
  return {
    total: LEVEL_TOTAL,
    attempted: baked.levels.length,
    exact: LEVEL_TOTAL - new Set(mismatches.map(({ levelId }) => levelId)).size,
    mismatches,
    mismatchCounts: {
      serialization: mismatches.filter(({ category }) => category === 'serialization').length,
      engine: mismatches.filter(({ category }) => category === 'engine').length,
      missingProvenance: mismatches.filter(({ category }) => category === 'missing-provenance').length,
    },
    timings: { perBoardMs: { p50: percentile(times, 0.5), p95: percentile(times, 0.95), max: times.at(-1) ?? 0 }, fullCampaignMs: baked.timings.fullCampaignMs },
  };
}
