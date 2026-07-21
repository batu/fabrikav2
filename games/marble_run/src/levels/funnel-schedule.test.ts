import { describe, expect, it } from 'vitest';
import {
  LEVEL_TOTAL,
  CLIMAX_MARBLE_CAP,
  MARBLE_CAP,
  TEACH_PINS,
  allowsPlugs,
  allowsVoids,
  boardSizeFor,
  effectiveTargetFor,
  isDebutLevel,
  minOpenersFor,
  marbleCapFor,
  paletteFor,
  sculptsAt,
  slotFor,
  unlockedColors,
  symmetryModeFor,
  MIRROR_SHARE_NUMERATOR,
  MIRROR_SHARE_DENOMINATOR,
  targetFor,
} from './funnel-schedule';

const IDS = Array.from({ length: LEVEL_TOTAL }, (_, i) => i + 1);

describe('funnel schedule', () => {
  it('levels 1-11 are a linear onboarding ramp from trivial to 10', () => {
    expect(slotFor(1)).toBe('onboarding');
    expect(slotFor(11)).toBe('onboarding');
    expect(targetFor(1)).toBe(1);
    expect(targetFor(11)).toBe(10);
    // Non-decreasing: 11 levels cannot strictly span 10 target values, so
    // exactly one repeat is expected (levels 1-2, both tutorial-trivial).
    for (let id = 2; id <= 11; id += 1) {
      expect(targetFor(id)).toBeGreaterThanOrEqual(targetFor(id - 1));
    }
    const repeats = [...Array(10).keys()].filter((i) => targetFor(i + 2) === targetFor(i + 1));
    expect(repeats).toEqual([0]);
  });

  it('cycle 0 opens with band/band/relax instead of the ramp triplet', () => {
    expect(slotFor(12)).toBe('band');
    expect(slotFor(13)).toBe('band');
    expect(slotFor(14)).toBe('relax');
    expect(targetFor(14)).toBeGreaterThanOrEqual(5);
    expect(targetFor(14)).toBeLessThanOrEqual(10);
  });

  it('every later cycle opens with the fixed ramp triplet 5/7/10', () => {
    for (let cycle = 1; cycle * 19 + 12 <= LEVEL_TOTAL; cycle += 1) {
      const base = 12 + cycle * 19;
      expect([slotFor(base), slotFor(base + 1), slotFor(base + 2)]).toEqual([
        'ramp', 'ramp', 'ramp',
      ]);
      expect([targetFor(base), targetFor(base + 1), targetFor(base + 2)]).toEqual([5, 7, 10]);
    }
  });

  it('recover is always exactly 7 — it never scales with progression', () => {
    const recovers = IDS.filter((id) => slotFor(id) === 'recover');
    expect(recovers.length).toBeGreaterThan(0);
    for (const id of recovers) expect(targetFor(id)).toBe(7);
  });

  it('band creep caps at +3 and never exceeds 18', () => {
    for (const id of IDS.filter((i) => slotFor(i) === 'band')) {
      expect(targetFor(id)).toBeGreaterThanOrEqual(11);
      expect(targetFor(id)).toBeLessThanOrEqual(18);
    }
    // Cycle 3 and cycle 4 bands are identical: creep is capped.
    const bandsIn = (cycle: number) =>
      IDS.filter((id) => id >= 12 + cycle * 19 && id < 12 + (cycle + 1) * 19 && slotFor(id) === 'band')
        .map(targetFor);
    expect(bandsIn(3)).toEqual(bandsIn(4));
  });

  it('spike stays within 16-18 and climax within 19-20', () => {
    for (const id of IDS.filter((i) => slotFor(i) === 'spike')) {
      expect(targetFor(id)).toBeGreaterThanOrEqual(16);
      expect(targetFor(id)).toBeLessThanOrEqual(18);
    }
    for (const id of IDS.filter((i) => slotFor(i) === 'climax')) {
      expect([19, 20]).toContain(targetFor(id));
    }
  });

  it('every level has a slot and an in-range target', () => {
    for (const id of IDS) {
      expect(slotFor(id)).toBeTruthy();
      expect(targetFor(id)).toBeGreaterThanOrEqual(1);
      expect(targetFor(id)).toBeLessThanOrEqual(20);
    }
  });

  it('unlock ceiling is monotone and matches the teach pins exactly', () => {
    for (const id of IDS) {
      const unlocked = unlockedColors(id);
      expect(unlocked.includes('green')).toBe(id >= TEACH_PINS.green);
      expect(unlocked.includes('yellow')).toBe(id >= TEACH_PINS.yellow);
      expect(unlocked.includes('purple')).toBe(id >= TEACH_PINS.purple);
      expect(unlocked.includes('orange')).toBe(id >= TEACH_PINS.orange);
      expect(allowsPlugs(id)).toBe(id >= TEACH_PINS.plugs);
      expect(allowsVoids(id)).toBe(id >= TEACH_PINS.voids);
    }
    for (let id = 2; id <= LEVEL_TOTAL; id += 1) {
      expect(unlockedColors(id).length).toBeGreaterThanOrEqual(unlockedColors(id - 1).length);
    }
  });

  it('a level never uses a color before that color has debuted', () => {
    // The pin is a floor, not a mandate: an easy late level may legitimately
    // use FEWER colors than are unlocked, but never one that is still locked.
    for (const id of IDS) {
      const unlocked = new Set(unlockedColors(id));
      for (const color of paletteFor(id)) expect(unlocked.has(color)).toBe(true);
      expect(paletteFor(id).length).toBeGreaterThanOrEqual(2);
    }
  });

  it('each color debuts on exactly its teach-pin level', () => {
    for (const [feature, color] of [
      ['green', 'green'], ['yellow', 'yellow'], ['purple', 'purple'], ['orange', 'orange'],
    ] as const) {
      const pin = TEACH_PINS[feature];
      const firstUse = IDS.find((id) => paletteFor(id).includes(color));
      expect(firstUse, `${color} should first appear at level ${pin}`).toBe(pin);
    }
  });

  it('each climax is strictly harder than every spike in its own cycle', () => {
    // Climax levels have the card's explicit 80-marble exception, so their
    // literal 19-20 targets remain intact while ordinary levels stay capped.
    const climaxes = IDS.filter((id) => slotFor(id) === 'climax');
    expect(climaxes.length).toBeGreaterThan(0);
    for (const climax of climaxes) {
      const cycleStart = climax - 18; // climax sits at the end of its cycle
      const spikes = IDS.filter(
        (id) => id >= cycleStart && id < climax && slotFor(id) === 'spike',
      );
      expect(spikes.length).toBeGreaterThan(0);
      for (const spike of spikes) {
        expect(
          effectiveTargetFor(climax),
          `climax ${climax} must outrank spike ${spike}`,
        ).toBeGreaterThan(effectiveTargetFor(spike));
      }
    }
  });

  it('climax targets use the separate reachable ceiling', () => {
    for (const id of IDS.filter((levelId) => slotFor(levelId) === 'climax')) {
      expect(effectiveTargetFor(id)).toBe(18.5);
      expect(marbleCapFor(id)).toBe(CLIMAX_MARBLE_CAP);
    }
    for (const id of IDS.filter((levelId) => slotFor(levelId) !== 'climax')) {
      expect(effectiveTargetFor(id)).toBeLessThanOrEqual(17.5);
      expect(marbleCapFor(id)).toBe(MARBLE_CAP);
    }
  });

  it('debut levels are spotlights: smaller than the same target elsewhere', () => {
    // The plugs and voids pins are BOARD features, not colors: their debut
    // board is clamped up to MIN_SCULPT_SIZE so the new element is actually
    // visible. After the MRB-7 pin retune (voids 6, plugs 8) that floor sits
    // above the natural board size for those targets, so the sculpt floor
    // and the spotlight shrink genuinely conflict. The floor wins — a voids
    // debut that renders as a plain board teaches nothing at all — so these
    // two pins are exempt from the shrink rule rather than silently broken.
    const boardFeaturePins = [TEACH_PINS.plugs, TEACH_PINS.voids];
    for (const id of Object.values(TEACH_PINS)) {
      expect(isDebutLevel(id)).toBe(true);
      if (boardFeaturePins.includes(id)) {
        const { cols, rows } = boardSizeFor(id);
        expect(sculptsAt(cols, rows), `pin ${id} must be able to show its element`).toBe(true);
        continue;
      }
      const peer = IDS.find((other) => !isDebutLevel(other) && targetFor(other) === targetFor(id));
      if (peer === undefined) continue;
      expect(boardSizeFor(id).cols).toBeLessThan(boardSizeFor(peer).cols);
    }
  });

  it('board sizes are sane and respect the marble cap', () => {
    for (const id of IDS) {
      const { cols, rows, marbleTarget } = boardSizeFor(id);
      expect(cols).toBeGreaterThanOrEqual(4);
      expect(rows).toBeGreaterThanOrEqual(4);
      const isClimax = slotFor(id) === 'climax';
      expect(cols).toBeLessThanOrEqual(isClimax ? 11 : 10);
      expect(rows).toBeLessThanOrEqual(isClimax ? 13 : 12);
      expect(marbleTarget).toBeLessThanOrEqual(isClimax ? CLIMAX_MARBLE_CAP : MARBLE_CAP);
      expect(marbleCapFor(id)).toBe(isClimax ? CLIMAX_MARBLE_CAP : MARBLE_CAP);
      expect(marbleTarget).toBeGreaterThanOrEqual(6);
    }
  });

  it('requests mirrors on 30-40% of levels and never in long runs', () => {
    const mirrors = [];
    for (let id = 1; id <= LEVEL_TOTAL; id += 1) {
      if (symmetryModeFor(id) === 'mirror') mirrors.push(id);
    }
    const share = mirrors.length / LEVEL_TOTAL;
    expect(share).toBeGreaterThanOrEqual(0.3);
    expect(share).toBeLessThanOrEqual(0.4);
    expect(share).toBeCloseTo(MIRROR_SHARE_NUMERATOR / MIRROR_SHARE_DENOMINATOR, 1);

    // Coprime stride => mirrors scatter instead of clumping into a block.
    let run = 0;
    let longest = 0;
    for (let id = 1; id <= LEVEL_TOTAL; id += 1) {
      run = symmetryModeFor(id) === 'mirror' ? run + 1 : 0;
      longest = Math.max(longest, run);
    }
    expect(longest).toBeLessThanOrEqual(3);
  });

  it('openers tighten with progress', () => {
    expect(minOpenersFor(1)).toBeGreaterThan(minOpenersFor(LEVEL_TOTAL));
  });
});
