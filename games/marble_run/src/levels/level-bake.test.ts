import { describe, expect, it } from 'vitest';
import { LEVELS } from './levels.generated';
import { LEVEL_MANIFEST } from './levels.manifest.generated';
import {
  HISTORICAL_BAKE_SOURCE,
  bakeCampaign,
  bakeLevel,
  characterizeShippedBaseline,
  difficultyRangeDistance,
} from './level-bake';

describe('pure v2 level bake', () => {
  it('reconstructs all 110 shipped boards and manifest entries exactly', () => {
    const result = bakeCampaign();
    expect(result.complete, JSON.stringify(result.failure)).toBe(true);
    expect(result.levels).toEqual(LEVELS);
    expect(result.manifest).toEqual(LEVEL_MANIFEST);
    expect(result.evidence).toHaveLength(110);
    expect(result.evidence.every(({ seed }) =>
      seed.provenance === 'reconstructed' && seed.sourceHash === HISTORICAL_BAKE_SOURCE.sha256,
    )).toBe(true);
    const report = characterizeShippedBaseline(result);
    expect(report).toMatchObject({
      total: 110,
      attempted: 110,
      exact: 110,
      mismatchCounts: { serialization: 0, engine: 0, missingProvenance: 0 },
    });
  }, 1_800_000);

  it('is byte-deterministic for the same input', () => {
    const first = bakeLevel({ id: 8, shapeKind: 'checker-plugs', priorEvidence: [] });
    const second = bakeLevel({ id: 8, shapeKind: 'checker-plugs', priorEvidence: [] });
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error(first.failure.reason);
    expect(first.level.cells.join('')).toContain('X');
  });

  it.each([
    [8, 'plain'],
    [6, 'plain'],
  ] as const)('allows the shipped mechanic marker at level %i to be moved by an authored draft', (id, shapeKind) => {
    const result = bakeLevel({ id, shapeKind, priorEvidence: [], targetRange: { min: 1, max: 20 }, maxReseeds: 1, requiredShapeMarker: null });
    expect(result).toMatchObject({ ok: true });
  });

  it('fails structurally when the bounded search cannot run', () => {
    const result = bakeLevel({ id: 1, shapeKind: 'plain', priorEvidence: [], maxReseeds: 0 });
    expect(result).toMatchObject({
      ok: false,
      failure: { code: 'reseed-exhausted', levelId: 1, attempts: 0 },
    });
  });

  it('ranks candidates against the authored range rather than the shipped target', () => {
    const range = { min: 14, max: 16 };
    expect(difficultyRangeDistance(15, range)).toBe(0);
    expect(difficultyRangeDistance(13, range)).toBe(1);
    expect(difficultyRangeDistance(8, range)).toBe(6);
  });

  it('requires preceding cycle spike evidence only for climaxes', () => {
    expect(bakeLevel({ id: 30, shapeKind: 'arena', priorEvidence: [] })).toMatchObject({
      ok: false,
      failure: { code: 'missing-climax-dependency', levelId: 30 },
    });
    expect(bakeLevel({ id: 29, shapeKind: 'plain', priorEvidence: [] })).toMatchObject({ ok: true });
  });

  it('reports unattempted boards as missing provenance in a bounded characterization', () => {
    const completed: number[] = [];
    const bounded = bakeCampaign({ maxLevels: 3, onLevel: (id) => completed.push(id) });
    const report = characterizeShippedBaseline(bounded);
    expect(completed).toEqual([1, 2, 3]);
    expect(bounded.complete).toBe(false);
    expect(report).toMatchObject({ total: 110, attempted: 3, exact: 3 });
    expect(report.mismatchCounts.missingProvenance).toBe(107);
  });

  it('stops a diagnostic at the first per-level or campaign ceiling', () => {
    const progress: Array<{ id: number; ok: boolean }> = [];
    const bounded = bakeCampaign({
      perLevelDeadlineMs: 1,
      campaignDeadlineMs: 100,
      onLevel: (id, _elapsed, result) => progress.push({ id, ok: result.ok }),
    });
    expect(bounded.complete).toBe(false);
    expect(bounded.failure?.code).toBe('time-limit');
    expect(progress.at(-1)?.ok).toBe(false);
  });
});
