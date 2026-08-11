import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  DIFFICULTY_CONTRACT_VERSION,
  SHIPPED_BASELINE,
  canonicalDifficultyJson,
  createDefaultDifficultyDraft,
  fingerprintCanonicalDifficultyJson,
  fingerprintShippedBytes,
  inheritedLevelIdsForBaseSlot,
  parseDifficultyDraft,
  type DifficultyDraft,
} from './difficulty-contract';

const INVALID_DRAFT_CASES: readonly [string, (draft: DifficultyDraft) => unknown][] = [
  ['unsupported version', (draft) => ({ ...draft, version: 99 })],
  ['duplicate identity', (draft) => ({ ...draft, levels: [...draft.levels.slice(0, -1), draft.levels[0]] })],
  ['missing identity', (draft) => ({ ...draft, levels: draft.levels.slice(0, -1) })],
  ['non-finite value', (draft) => ({ ...draft, authored: { ...draft.authored, mappings: { ...draft.authored.mappings, marbleCount: [{ difficulty: 1, value: NaN }] } } })],
  ['out-of-range difficulty', (draft) => ({ ...draft, authored: { ...draft.authored, onboarding: [{ ...draft.authored.onboarding[0], targetRange: { min: 0, max: 1 } }, ...draft.authored.onboarding.slice(1)] } })],
  ['malformed mapping', (draft) => ({ ...draft, authored: { ...draft.authored, mappings: { ...draft.authored.mappings, marbleCount: [{ difficulty: 2, value: 7 }, { difficulty: 1, value: 6 }] } } })],
  ['invalid override reference', (draft) => ({ ...draft, overrides: [{ levelId: 111, replaces: ['targetRange'], values: { targetRange: { min: 1, max: 2 } } }] })],
  ['invalid role ceiling', (draft) => ({ ...draft, authored: { ...draft.authored, progression: { ...draft.authored.progression, roleCeilings: { ...draft.authored.progression.roleCeilings, spike: 0 } } } })],
];

describe('difficulty contract', () => {
  it('describes the current 11-level onboarding, 19-slot cycle, and 110 identities', () => {
    const draft = createDefaultDifficultyDraft();
    expect(draft.version).toBe(DIFFICULTY_CONTRACT_VERSION);
    expect(draft.authored.onboarding).toHaveLength(11);
    expect(draft.authored.baseCycle).toHaveLength(19);
    expect(draft.levels.map(({ id }) => id)).toEqual(
      Array.from({ length: 110 }, (_, index) => index + 1),
    );
    expect(draft.locks).toEqual([]);
    expect(draft.overrides).toEqual([]);
    expect(draft.levels.every(({ seed }) => seed.provenance === 'unknown')).toBe(true);
    expect(draft.authored.onboarding[0]!.targetRange).toEqual({ min: 1, max: 2.5 });
    expect(draft.authored.baseCycle[0]!.targetRange).toEqual({ min: 3.5, max: 6.5 });
    expect(draft.authored.baseCycle[3]!.targetRange).toEqual({ min: 9.5, max: 12.5 });
    expect(draft.authored.baseCycle[18]!.targetRange).toEqual({ min: 17, max: 20 });
  });

  it('fingerprints exact shipped source bytes independently of derived evidence', async () => {
    const here = `${process.cwd()}/src/levels`;
    const bytes = await Promise.all([
      'funnel-schedule.ts',
      'levels.generated.ts',
      'levels.manifest.generated.ts',
    ].map((name) => readFile(`${here}/${name}`, 'utf8')));
    const fingerprint = await fingerprintShippedBytes({
      schedule: bytes[0]!,
      levels: bytes[1]!,
      manifest: bytes[2]!,
    });
    expect(fingerprint).toEqual(SHIPPED_BASELINE);

    const draft = createDefaultDifficultyDraft();
    const changedDerivedEvidence = { ...draft, derivedEvidence: [{ levelId: 1, measuredDifficulty: 20 }] };
    expect(changedDerivedEvidence.baseline).toEqual(draft.baseline);
  });

  it('serializes semantic JSON canonically and fingerprints it stably', async () => {
    const left = { z: [{ b: 2, a: 1 }], a: -0 };
    const right = { a: 0, z: [{ a: 1, b: 2 }] };
    expect(canonicalDifficultyJson(left)).toBe(canonicalDifficultyJson(right));
    await expect(fingerprintCanonicalDifficultyJson(left)).resolves.toBe(
      await fingerprintCanonicalDifficultyJson(right),
    );
    expect(() => canonicalDifficultyJson({ invalid: Number.POSITIVE_INFINITY })).toThrow(/finite/);
  });

  it('excludes detached and locked occurrences from inherited cycle replacement', () => {
    const draft = createDefaultDifficultyDraft();
    const all = inheritedLevelIdsForBaseSlot(draft, 0);
    expect(all).toEqual([31, 50, 69, 88, 107]);
    const protectedDraft = {
      ...draft,
      locks: [{ levelId: 50, reason: 'accepted board' }],
      overrides: [{ levelId: 69, replaces: ['targetRange'] as const, values: { targetRange: { min: 9, max: 10 } } }],
    };
    expect(inheritedLevelIdsForBaseSlot(protectedDraft, 0)).toEqual([31, 88, 107]);
  });

  it.each(INVALID_DRAFT_CASES)('rejects %s', (_label, mutate) => {
    expect(() => parseDifficultyDraft(mutate(createDefaultDifficultyDraft()))).toThrow();
  });
});
