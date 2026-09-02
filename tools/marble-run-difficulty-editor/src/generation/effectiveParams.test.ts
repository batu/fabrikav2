import { describe, expect, it } from 'vitest';

import { createDefaultDifficultyDraft } from '../../../../games/marble_run/src/levels/difficulty-contract.ts';
import { expandDifficultyDraft } from '../../../../games/marble_run/src/levels/difficulty-expand.ts';
import { bakeParamsFor, pickShapeKind } from '../../../../games/marble_run/src/levels/level-bake.ts';

import { effectiveGenerationInput } from './effectiveParams.ts';

describe('effective generator inputs', () => {
  it('preserves the shipped generator parameters for the default draft', () => {
    const baseline = expandDifficultyDraft(createDefaultDifficultyDraft());
    for (const level of baseline) {
      const previous = level.id === 1 ? null : pickShapeKind(level.id - 1, null);
      const result = effectiveGenerationInput(level, level, previous);
      expect(JSON.parse(JSON.stringify({ ...bakeParamsFor(level.id, result.shapeKind), ...result.params }))).toEqual(JSON.parse(JSON.stringify(bakeParamsFor(level.id, result.shapeKind))));
    }
  });

  it('maps authored levers and advanced overrides into concrete generator parameters', () => {
    const draft = createDefaultDifficultyDraft();
    const baseline = expandDifficultyDraft(draft)[33]!;
    const changed = {
      ...baseline,
      resolvedMappings: { marbleCount: 42, boardArea: 90, colorCount: 5, openingGenerosity: 0.3, solverWaveDepth: 6 },
      roleRule: { ...baseline.roleRule, spreadOpeningRoutes: !baseline.roleRule.spreadOpeningRoutes, finish: baseline.roleRule.finish === 'cascade' ? 'thin' as const : 'cascade' as const },
      overrideValues: { dimensions: { cols: 9, rows: 10 }, caps: { marbles: 40, colors: 4 }, symmetryMode: 'asymmetric' },
    };
    const result = effectiveGenerationInput(changed, baseline, null);
    expect(result.params).toMatchObject({ cols: 9, rows: 10, marbleTarget: 42, marbleCap: 40, minOpeners: 0.3, minWaves: 6, openerSpread: changed.roleRule.spreadOpeningRoutes, lastWavePreference: changed.roleRule.finish, symmetryMode: 'asymmetric' });
    expect(result.params.colors).toHaveLength(4);
    expect(result.params.shape).toHaveLength(10);
  });

  it.each([
    ['plugs', 'X'],
    ['voids', '#'],
  ] as const)('makes a moved %s debut visible in the generated shape', (mechanic, marker) => {
    const draft = createDefaultDifficultyDraft();
    const baseline = expandDifficultyDraft(draft)[33]!;
    const changed = { ...baseline, availableMechanics: [...baseline.availableMechanics, mechanic], spotlightMechanic: mechanic };
    const result = effectiveGenerationInput(changed, baseline, null);
    expect(result.params.shape?.join('')).toContain(marker);
  });

  it.each([
    ['plugs', 9, 'X'],
    ['voids', 7, '#'],
  ] as const)('makes a later moved %s debut visible at level %i', (mechanic, levelId, marker) => {
    const draft = createDefaultDifficultyDraft();
    const edited = {
      ...draft,
      authored: {
        ...draft.authored,
        onboarding: draft.authored.onboarding.map((row) => row.mechanicDebut === mechanic
          ? { ...row, mechanicDebut: null }
          : row.levelId === levelId ? { ...row, mechanicDebut: mechanic, spotlight: true } : row),
      },
    };
    const baseline = expandDifficultyDraft(draft)[levelId - 1]!;
    const changed = expandDifficultyDraft(edited)[levelId - 1]!;
    expect(effectiveGenerationInput(changed, baseline, null).params.shape?.join('')).toContain(marker);
  });

  it.each(['green', 'yellow', 'purple', 'orange'] as const)('forces a moved %s debut into a small spotlight palette', (mechanic) => {
    const draft = createDefaultDifficultyDraft();
    const baseline = expandDifficultyDraft(draft)[0]!;
    const changed = { ...baseline, availableMechanics: [mechanic], spotlightMechanic: mechanic, resolvedMappings: { ...baseline.resolvedMappings, colorCount: 2 } };
    expect(effectiveGenerationInput(changed, baseline, null).params.colors).toContain(mechanic);
  });

  it('passes complete colored gate overrides to the generator', () => {
    const baseline = expandDifficultyDraft(createDefaultDifficultyDraft())[33]!;
    const gates = [
      { side: 'left' as const, index: 2, color: 'red' as const },
      { side: 'right' as const, index: 3, color: 'blue' as const },
    ];
    const changed = { ...baseline, overrideValues: { gatePlacement: gates } };
    expect(effectiveGenerationInput(changed, baseline, null).params.gates).toEqual(gates);
  });
});
