import { describe, expect, it } from 'vitest';

import { analyzeDifficulty } from '../../../../../games/marble_run/src/marble-board/solver.ts';
import { scoreLevel } from '../../../../../games/marble_run/src/marble-board/score.ts';
import { createDefaultDifficultyDraft, type DifficultyDraft } from '../../../../../games/marble_run/src/levels/difficulty-contract.ts';
import { expandDifficultyDraft } from '../../../../../games/marble_run/src/levels/difficulty-expand.ts';
import { LEVELS } from '../../../../../games/marble_run/src/levels/levels.generated.ts';
import type { AcceptedLevel } from '../../generation/protocol.ts';
import { canonicalizeExportCandidate, validateExportCandidate } from '../../../../../games/marble_run/src/levels/difficulty-validation.ts';
import { createExportReview, prepareCandidateDownload, reviewIsCurrent } from './exportCandidate.ts';

function fixture(): { readonly draft: DifficultyDraft; readonly accepted: Readonly<Record<number, AcceptedLevel>> } {
  const source = createDefaultDifficultyDraft();
  const draft: DifficultyDraft = {
    ...source,
    authored: {
      ...source.authored,
      onboarding: source.authored.onboarding.map((entry) => ({ ...entry, targetRange: { min: 1, max: 20 } })),
      baseCycle: source.authored.baseCycle.map((entry) => ({ ...entry, targetRange: { min: 1, max: 20 } })),
      progression: { ...source.authored.progression, difficultyOffsets: [0, 0, 0, 0, 0], maximumOffset: 0, firstCycleOpening: source.authored.progression.firstCycleOpening.map((entry) => ({ ...entry, targetRange: { min: 1, max: 20 } })) },
    },
  };
  const expanded = expandDifficultyDraft(draft);
  const accepted = Object.fromEntries(LEVELS.map((level): [number, AcceptedLevel] => {
    const report = analyzeDifficulty(level);
    const effective = expanded[level.id - 1]!;
    return [level.id, {
      level,
      evidence: { levelId: level.id, slot: effective.role, source: 'derived', solvable: true, targetRange: effective.targetRange, measuredDifficulty: scoreLevel(level), marbleCount: report.marbles, solverWaves: report.waves, initiallyMovableShare: report.initialMovableFraction, seed: { provenance: 'unknown' }, overrideState: 'inherited', shapeKind: 'plain', reseeds: 0, mirrorDistance: 0 },
      seed: 0,
      effectiveInputFingerprint: '',
    }];
  }));
  return { draft, accepted };
}

describe('export candidate review', () => {
  it('builds, displays, and downloads the same validated canonical bytes', async () => {
    const input = fixture();
    const frozen = structuredClone(input);
    const review = await createExportReview(input);
    expect(review.canExport).toBe(true);
    expect(review.summary.changedLevelIds).toEqual(review.candidate.changedLevelIds);
    expect(review.summary.validatedLevelIds).toHaveLength(110);
    const download = await prepareCandidateDownload(review, input);
    expect(new TextDecoder().decode(download.bytes)).toBe(review.json);
    expect(download.fingerprint).toBe(review.candidateFingerprint);
    expect(await canonicalizeExportCandidate(JSON.parse(review.json))).toEqual({ json: review.json, fingerprint: review.candidateFingerprint });
    expect((await validateExportCandidate(JSON.parse(review.json), { currentDraftFingerprint: review.reviewedDraftFingerprint })).valid).toBe(true);
    expect(input).toEqual(frozen);
  }, 20_000);

  it('blocks incomplete, Needs attention, and stale reviews', async () => {
    const input = fixture();
    const incomplete = { ...input, accepted: Object.fromEntries(Object.entries(input.accepted).filter(([id]) => id !== '7')) };
    const incompleteReview = await createExportReview(incomplete);
    expect(incompleteReview.issues).toEqual(expect.arrayContaining([expect.stringMatching(/Level 7.*missing/i)]));
    expect(incompleteReview.summary.validatedLevelIds).not.toContain(7);
    const failedReview = await createExportReview({ ...input, failures: { 8: 'solver exhausted' } });
    expect(failedReview.issues).toEqual(expect.arrayContaining([expect.stringMatching(/Level 8.*solver exhausted/i)]));
    expect(failedReview.summary.validatedLevelIds).not.toContain(8);
    const review = await createExportReview(input);
    const edited = { ...input.draft, authored: { ...input.draft.authored, onboarding: input.draft.authored.onboarding.map((entry, index) => index === 0 ? { ...entry, targetRange: { min: 1, max: 2 } } : entry) } };
    const editedInput = { ...input, draft: edited };
    await expect(reviewIsCurrent(review, editedInput)).resolves.toBe(false);
    await expect(prepareCandidateDownload(review, editedInput)).rejects.toThrow(/stale/i);
  }, 20_000);

  it('blocks out-of-range evidence and reports overrides and locks exactly', async () => {
    const input = fixture();
    const accepted = { ...input.accepted, 7: { ...input.accepted[7]!, evidence: { ...input.accepted[7]!.evidence, targetRange: { min: 1, max: 1 } } } };
    const draft = { ...input.draft, locks: [{ levelId: 4, reason: 'accepted' }], overrides: [{ levelId: 9, replaces: ['targetRange' as const], values: { targetRange: { min: 1, max: 20 } } }] };
    const review = await createExportReview({ draft, accepted });
    expect(review.canExport).toBe(false);
    expect(review.summary.lockedLevelIds).toEqual([4]);
    expect(review.summary.overriddenLevelIds).toEqual([9]);
    expect(review.issues).toEqual(expect.arrayContaining([expect.stringMatching(/Level 7.*target range/i)]));
  });
});
