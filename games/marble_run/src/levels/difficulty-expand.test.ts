import { describe, expect, it } from 'vitest';
import { createDefaultDifficultyDraft } from './difficulty-contract';
import { effectiveTargetFor } from './funnel-schedule';
import { affectedLevelIds, expandDifficultyDraft } from './difficulty-expand';

type Mutable<T> = { -readonly [K in keyof T]: T[K] extends readonly (infer U)[] ? Mutable<U>[] : T[K] extends object ? Mutable<T[K]> : T[K] };
const clone = <T>(value: T): Mutable<T> => structuredClone(value) as Mutable<T>;

describe('difficulty expansion', () => {
  it('reproduces the shipped target windows across every cycle and partial tail', () => {
    const draft = createDefaultDifficultyDraft();
    const expanded = expandDifficultyDraft(draft);
    for (const row of expanded) {
      const target = effectiveTargetFor(row.id);
      expect(row.targetRange, `level ${row.id}`).toEqual({
        min: Math.max(1, target - 1.5),
        max: Math.min(20, target + 1.5),
      });
    }
    expect(expanded[14]!.targetRange).toEqual({ min: 9.5, max: 12.5 });
    expect(expanded[29]!.targetRange).toEqual({ min: 17, max: 20 });
    expect(expanded[48]!.targetRange).toEqual({ min: 17, max: 20 });
    expect(expanded[67]!.targetRange).toEqual({ min: 17, max: 20 });
  });
  it('propagates a base slot through cycle offsets but excludes locked and overridden occurrences', () => {
    const before = clone(createDefaultDifficultyDraft());
    const linked = before.levels.filter((level) => level.baseCycleSlot === 3).map((level) => level.id);
    before.locks = [{ levelId: linked[0]!, reason: 'accepted' }];
    before.overrides = [{ levelId: linked[1]!, replaces: ['targetRange'], values: { targetRange: { min: 9, max: 9 } } }];
    const after = clone(before);
    after.authored.baseCycle[3]!.targetRange = { min: 12, max: 16 };
    expect(affectedLevelIds(before, after)).toEqual(linked.slice(2));
    const expanded = expandDifficultyDraft(after);
    expect(expanded.find((row) => row.id === linked[0])!.overrideState).toBe('locked');
    expect(expanded.find((row) => row.id === linked[1])!.targetRange).toEqual({ min: 9, max: 9 });
    expect(expanded.find((row) => row.id === linked.at(-1))!.targetRange.min).toBeGreaterThanOrEqual(12);
  });

  it('moving a debut affects availability between its old and new positions and both spotlight levels', () => {
    const before = clone(createDefaultDifficultyDraft());
    const after = clone(before);
    after.authored.onboarding[2]!.mechanicDebut = null;
    after.authored.onboarding[4]!.mechanicDebut = 'green';
    after.authored.onboarding[4]!.spotlight = true;
    expect(affectedLevelIds(before, after)).toEqual([3, 4, 5]);
  });

  it('marks all levels when a global mapping changes and restores inheritance after override reset', () => {
    const before = clone(createDefaultDifficultyDraft());
    const mapped = clone(before);
    mapped.authored.mappings.marbleCount[0]!.value += 1;
    expect(affectedLevelIds(before, mapped)).toHaveLength(110);

    const overridden = clone(before);
    overridden.overrides = [{ levelId: 34, replaces: ['targetRange'], values: { targetRange: { min: 2, max: 2 } } }];
    const edited = clone(overridden);
    edited.authored.baseCycle[3]!.targetRange = { min: 12, max: 16 };
    expect(affectedLevelIds(overridden, edited)).not.toContain(34);
    const changedOverride = clone(overridden);
    changedOverride.overrides[0]!.values.targetRange = { min: 3, max: 3 };
    expect(affectedLevelIds(overridden, changedOverride)).toContain(34);
    edited.overrides = [];
    expect(affectedLevelIds(overridden, edited)).toContain(34);
  });

  it('adds climax dependency closure when a preceding spike changes', () => {
    const before = clone(createDefaultDifficultyDraft());
    const after = clone(before);
    const spikeIndex = after.authored.baseCycle.findIndex(({ role }) => role === 'spike');
    after.authored.baseCycle[spikeIndex]!.targetRange = { min: 17, max: 18 };
    const affected = affectedLevelIds(before, after);
    const changedSpike = expandDifficultyDraft(after).find((row) => row.baseCycleSlot === spikeIndex)!;
    const climax = expandDifficultyDraft(after).find((row) => row.cycle === changedSpike.cycle && row.role === 'climax')!;
    expect(affected).toContain(climax.id);
  });
});
