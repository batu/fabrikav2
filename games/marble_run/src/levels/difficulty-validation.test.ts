import { describe, expect, it } from 'vitest';
import { LEVELS } from './levels.generated';
import { createDefaultDifficultyDraft, fingerprintCanonicalDifficultyJson, SHIPPED_BASELINE, type ExportCandidate, type GeneratedEvidence } from './difficulty-contract';
import { canonicalizeExportCandidate, validateExportCandidate } from './difficulty-validation';
import { scoreLevel } from '../marble-board/score';
import { analyzeDifficulty } from '../marble-board/solver';
import { expandDifficultyDraft } from './difficulty-expand';

function candidate(): ExportCandidate {
  const draft = createDefaultDifficultyDraft();
  const authored = {
    ...draft.authored,
    onboarding: draft.authored.onboarding.map((entry) => ({ ...entry, targetRange: { min: 1, max: 20 } })),
    baseCycle: draft.authored.baseCycle.map((slot) => ({ ...slot, targetRange: { min: 1, max: 20 } })),
    progression: { ...draft.authored.progression, difficultyOffsets: [0, 0, 0, 0, 0], maximumOffset: 0, firstCycleOpening: draft.authored.progression.firstCycleOpening.map((slot) => ({ ...slot, targetRange: { min: 1, max: 20 } })) },
  };
  const expanded = expandDifficultyDraft({ ...draft, authored });
  const evidence: GeneratedEvidence[] = LEVELS.map((level) => {
    const report = analyzeDifficulty(level);
    const measuredDifficulty = scoreLevel(level);
    return { levelId: level.id, source: 'derived', solvable: true, targetRange: expanded[level.id - 1]!.targetRange, measuredDifficulty, marbleCount: report.marbles, solverWaves: report.waves, initiallyMovableShare: report.initialMovableFraction, seed: { provenance: 'unknown' }, overrideState: 'inherited' };
  });
  return { version: 1, reviewedDraftFingerprint: 'a'.repeat(64), baseline: SHIPPED_BASELINE, authored, levels: draft.levels, boards: LEVELS, evidence, locks: [], overrides: [], validation: { valid: true, issues: [] }, changedLevelIds: [] };
}

describe('Export Candidate validation', () => {
  it('round-trips a complete candidate canonically with a matching fingerprint', async () => {
    const value = candidate();
    const result = await validateExportCandidate(value);
    expect(result).toEqual({ valid: true, issues: [] });
    const serialized = await canonicalizeExportCandidate(value);
    expect(await fingerprintCanonicalDifficultyJson(JSON.parse(serialized.json))).toBe(serialized.fingerprint);
    expect(JSON.parse(serialized.json)).toEqual(value);
  });

  it.each([
    ['missing', (value: ExportCandidate) => ({ ...value, boards: value.boards.filter(({ id }) => id !== 7) })],
    ['duplicate', (value: ExportCandidate) => ({ ...value, boards: [...value.boards.slice(0, -1), value.boards[6]!] })],
    ['unsolvable', (value: ExportCandidate) => ({ ...value, evidence: value.evidence.map((row) => row.levelId === 7 ? { ...row, solvable: false } : row) })],
    ['out of range', (value: ExportCandidate) => ({ ...value, evidence: value.evidence.map((row) => row.levelId === 7 ? { ...row, targetRange: { min: 1, max: 1 } } : row) })],
    ['inconsistent', (value: ExportCandidate) => ({ ...value, evidence: value.evidence.map((row) => row.levelId === 7 ? { ...row, marbleCount: row.marbleCount + 1 } : row) })],
  ])('blocks a %s result with a level-specific reason', async (_name, mutate) => {
    const result = await validateExportCandidate(mutate(candidate()));
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => /level 7|level identity 1/i.test(issue))).toBe(true);
  });

  it('rejects stale reviewed fingerprints and incorrect changed inventory', async () => {
    const value = { ...candidate(), changedLevelIds: [7] };
    const draftFingerprint = await fingerprintCanonicalDifficultyJson({ authored: value.authored, levels: value.levels, locks: value.locks, overrides: value.overrides });
    expect((await validateExportCandidate(value, { baselineCandidate: candidate(), currentDraftFingerprint: draftFingerprint })).issues).toEqual(expect.arrayContaining([expect.stringMatching(/stale/i), expect.stringMatching(/changed-level inventory/i)]));
  });

  it('requires an intrinsic lowercase SHA-256 reviewed-draft fingerprint', async () => {
    const value = { ...candidate(), reviewedDraftFingerprint: 'A'.repeat(64) };
    expect((await validateExportCandidate(value)).issues).toEqual(expect.arrayContaining([expect.stringMatching(/lowercase SHA-256/i)]));
  });

  it('rejects a stale shipped or supplied baseline fingerprint', async () => {
    const value = candidate();
    const stale = { ...value, baseline: { ...value.baseline, aggregate: '0'.repeat(64) } };
    expect((await validateExportCandidate(stale)).issues).toEqual(expect.arrayContaining([expect.stringMatching(/shipped baseline/i)]));
    const otherBaseline = { ...candidate(), baseline: { ...value.baseline, aggregate: '1'.repeat(64) } };
    expect((await validateExportCandidate(value, { baselineCandidate: otherBaseline })).issues).toEqual(expect.arrayContaining([expect.stringMatching(/loaded baseline/i)]));
  });

  it('preserves a locked board and its accepted evidence across inherited journey changes', async () => {
    const baseline = candidate();
    const lockedId = 34;
    const lockedEvidence = baseline.evidence.map((row) => row.levelId === lockedId ? { ...row, overrideState: 'locked' as const } : row);
    const accepted = { ...baseline, locks: [{ levelId: lockedId, reason: 'accepted' }], evidence: lockedEvidence };
    const current = {
      ...structuredClone(accepted),
      authored: { ...accepted.authored, baseCycle: accepted.authored.baseCycle.map((slot, index) => index === 3 ? { ...slot, targetRange: { min: 1, max: 19 } } : slot) },
      evidence: [...accepted.evidence],
      changedLevelIds: [] as number[],
    };
    const linked = current.levels.filter((row) => row.baseCycleSlot === 3 && row.id !== lockedId).map(({ id }) => id);
    current.evidence = current.evidence.map((row) => linked.includes(row.levelId) ? { ...row, targetRange: { min: 1, max: 19 } } : row);
    current.changedLevelIds = linked;
    await expect(validateExportCandidate(current, { baselineCandidate: accepted })).resolves.toEqual({ valid: true, issues: [] });
  });

  it('returns a blocking issue instead of throwing for malformed external JSON', async () => {
    await expect(validateExportCandidate({ version: 1 })).resolves.toEqual({
      valid: false,
      issues: [expect.stringMatching(/malformed/i)],
    });
  });
});
