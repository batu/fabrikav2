import type { Feature, Slot } from './funnel-schedule';
import { LEVEL_TOTAL, TEACH_PINS } from './funnel-schedule';
import {
  canonicalDifficultyJson,
  type AuthoredDifficultyInputs,
  type DifficultyDraft,
  type DifficultyMappings,
  type DifficultyRange,
  type LevelOverride,
  type MappingAnchor,
  type SeedProvenance,
} from './difficulty-contract';

export interface ResolvedDifficultyMappings {
  readonly marbleCount: number;
  readonly boardArea: number;
  readonly colorCount: number;
  readonly openingGenerosity: number;
  readonly solverWaveDepth: number;
}

export interface ExpandedDifficultyLevel {
  readonly id: number;
  readonly role: Slot;
  readonly baseCycleSlot: number | null;
  readonly cycle: number | null;
  readonly cycleOffset: number;
  readonly targetRange: DifficultyRange;
  readonly availableMechanics: readonly Feature[];
  readonly spotlightMechanic: Feature | null;
  readonly mappings: DifficultyMappings;
  readonly resolvedMappings: ResolvedDifficultyMappings;
  readonly roleRule: AuthoredDifficultyInputs['roleRules'][number];
  readonly seed: SeedProvenance;
  readonly overrideState: 'inherited' | 'overridden' | 'locked';
  readonly overrideValues: Readonly<Record<string, unknown>>;
}

const FEATURES = Object.keys(TEACH_PINS) as Feature[];

function mechanicPins(draft: DifficultyDraft): Readonly<Record<Feature, number>> {
  const pins = { ...TEACH_PINS };
  for (const feature of FEATURES) {
    const authored = draft.authored.onboarding.find(({ mechanicDebut }) => mechanicDebut === feature);
    if (authored !== undefined) pins[feature] = authored.levelId;
  }
  return pins;
}

function offsetFor(draft: DifficultyDraft, cycle: number, role: Slot, progression: string): number {
  const rule = draft.authored.progression;
  if (progression === 'alternating') return cycle % 2;
  if (progression === 'fixed' || !rule.affectedRoles.includes(role)) return 0;
  return Math.min(rule.maximumOffset, rule.difficultyOffsets[Math.min(cycle, rule.difficultyOffsets.length - 1)] ?? 0);
}

function shifted(range: DifficultyRange, offset: number, ceiling: number): DifficultyRange {
  const halfWidth = (range.max - range.min) / 2;
  const center = Math.min(ceiling, (range.min + range.max) / 2 + offset);
  return { min: Math.max(1, center - halfWidth), max: Math.min(20, center + halfWidth) };
}

function interpolate(anchors: readonly MappingAnchor[], difficulty: number): number {
  if (difficulty <= anchors[0]!.difficulty) return anchors[0]!.value;
  if (difficulty >= anchors.at(-1)!.difficulty) return anchors.at(-1)!.value;
  const upperIndex = anchors.findIndex(({ difficulty: x }) => x >= difficulty);
  const lower = anchors[upperIndex - 1]!;
  const upper = anchors[upperIndex]!;
  const t = (difficulty - lower.difficulty) / (upper.difficulty - lower.difficulty);
  return lower.value + (upper.value - lower.value) * t;
}

function resolveMappings(mappings: DifficultyMappings, range: DifficultyRange): ResolvedDifficultyMappings {
  const difficulty = (range.min + range.max) / 2;
  return {
    marbleCount: interpolate(mappings.marbleCount, difficulty),
    boardArea: interpolate(mappings.boardArea, difficulty),
    colorCount: interpolate(mappings.colorCount, difficulty),
    openingGenerosity: interpolate(mappings.openingGenerosity, difficulty),
    solverWaveDepth: interpolate(mappings.solverWaveDepth, difficulty),
  };
}

function overrideFor(draft: DifficultyDraft, id: number): LevelOverride | undefined {
  return draft.overrides.find(({ levelId }) => levelId === id);
}

export function expandDifficultyDraft(draft: DifficultyDraft): readonly ExpandedDifficultyLevel[] {
  const pins = mechanicPins(draft);
  const locked = new Set(draft.locks.map(({ levelId }) => levelId));
  return draft.levels.map((identity) => {
    const id = identity.id;
    const onboarding = id <= 11 ? draft.authored.onboarding[id - 1]! : undefined;
    const cycle = id <= 11 ? null : Math.floor((id - 12) / 19);
    const authoredSlot = identity.baseCycleSlot === null
      ? (id >= 12 ? draft.authored.progression.firstCycleOpening[id - 12]! : undefined)
      : draft.authored.baseCycle[identity.baseCycleSlot]!;
    const role = onboarding?.role ?? authoredSlot!.role;
    const offset = onboarding === undefined ? offsetFor(draft, cycle!, role, authoredSlot!.progression) : 0;
    const spotlightMechanic = FEATURES.find((feature) => pins[feature] === id) ?? null;
    const spotlightActive = spotlightMechanic !== null && onboarding?.spotlight !== false;
    const inheritedRange = shifted(
      onboarding?.targetRange ?? authoredSlot!.targetRange,
      offset - (spotlightActive ? 1 : 0),
      draft.authored.progression.roleCeilings[role],
    );
    const override = overrideFor(draft, id);
    const targetRange = override?.replaces.includes('targetRange')
      ? override.values.targetRange as DifficultyRange
      : inheritedRange;
    const seed = override?.replaces.includes('seed')
      ? { provenance: 'pinned', seed: override.values.seed as number, source: 'level override', sourceHash: draft.baseline.aggregate } as const
      : identity.seed;
    return {
      id,
      role,
      baseCycleSlot: identity.baseCycleSlot,
      cycle,
      cycleOffset: offset,
      targetRange,
      availableMechanics: FEATURES.filter((feature) => id >= pins[feature]),
      spotlightMechanic: spotlightActive ? spotlightMechanic : null,
      mappings: draft.authored.mappings,
      resolvedMappings: resolveMappings(draft.authored.mappings, targetRange),
      roleRule: draft.authored.roleRules.find((rule) => rule.role === role)!,
      seed,
      overrideState: locked.has(id) ? 'locked' : override === undefined ? 'inherited' : 'overridden',
      overrideValues: override?.values ?? {},
    };
  });
}

function dependencyClosure(ids: Set<number>, expanded: readonly ExpandedDifficultyLevel[], locked: ReadonlySet<number>): void {
  for (const id of [...ids]) {
    if (expanded[id - 1]?.role !== 'spike') continue;
    const cycle = expanded[id - 1]!.cycle;
    const climax = expanded.find((row) => row.cycle === cycle && row.role === 'climax');
    if (climax !== undefined && !locked.has(climax.id)) ids.add(climax.id);
  }
}

/** IDs whose canonical generator input changed, plus required climax evidence dependencies. */
export function affectedLevelIds(before: DifficultyDraft, after: DifficultyDraft): readonly number[] {
  const previous = expandDifficultyDraft(before);
  const next = expandDifficultyDraft(after);
  const locked = new Set(after.locks.map(({ levelId }) => levelId));
  const affected = new Set<number>();
  for (let id = 1; id <= LEVEL_TOTAL; id += 1) {
    if (locked.has(id)) continue;
    const beforeRow = previous[id - 1]!;
    const afterRow = next[id - 1]!;
    if (afterRow.overrideState === 'overridden' && beforeRow.overrideState === 'overridden') {
      const beforeOverride = overrideFor(before, id)!;
      const afterOverride = overrideFor(after, id)!;
      const inheritedOutsideOverride = {
        availableMechanics: afterRow.availableMechanics,
        spotlightMechanic: afterRow.spotlightMechanic,
        mappings: afterRow.mappings,
        roleRule: afterRow.roleRule,
      };
      const previousOutsideOverride = {
        availableMechanics: beforeRow.availableMechanics,
        spotlightMechanic: beforeRow.spotlightMechanic,
        mappings: beforeRow.mappings,
        roleRule: beforeRow.roleRule,
      };
      if (canonicalDifficultyJson(beforeOverride) !== canonicalDifficultyJson(afterOverride)
        || canonicalDifficultyJson(previousOutsideOverride) !== canonicalDifficultyJson(inheritedOutsideOverride)) affected.add(id);
      continue;
    }
    if (canonicalDifficultyJson(beforeRow) !== canonicalDifficultyJson(afterRow)) affected.add(id);
  }
  dependencyClosure(affected, next, locked);
  return [...affected].sort((a, b) => a - b);
}
