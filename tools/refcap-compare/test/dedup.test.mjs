import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng } from '../src/png.mjs';
import { signature } from '../src/phash.mjs';
import { assertNoDuplicateStates, DuplicateStateError } from '../src/dedup.mjs';

const REF = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', '..', '..',
  'games/marble_run/refs/captures/android-basegamelab',
);

function capture(state, name) {
  return {
    state,
    lane: 'reference',
    source: name,
    signature: signature(decodePng(fs.readFileSync(path.join(REF, name)))),
  };
}

describe('dedup guard (fixes ledger B2)', () => {
  it('throws when two DIFFERENT states are perceptually identical (level-start/level-mid)', () => {
    // The canonical B2 case: marbles-barely-move duplicate labeled as two states.
    const captures = [
      capture('level', 'level-start.png'),
      capture('level_alt', 'level-mid.png'),
    ];
    expect(() => assertNoDuplicateStates(captures)).toThrow(DuplicateStateError);
    try {
      assertNoDuplicateStates(captures);
    } catch (err) {
      expect(err.message).toContain('level');
      expect(err.message).toContain('level_alt');
    }
  });

  it('passes when all states are genuinely distinct', () => {
    const captures = [
      capture('menu', 'menu.png'),
      capture('level', 'level-start.png'),
      capture('settings', 'settings.png'),
      capture('win', 'win-ref.png'),
      capture('fail', 'fail-ref.png'),
    ];
    expect(() => assertNoDuplicateStates(captures)).not.toThrow();
  });

  it('does not flag the same state captured twice (same-state is allowed)', () => {
    const captures = [
      capture('level', 'level-start.png'),
      capture('level', 'level-mid.png'), // same state name -> not a mislabel
    ];
    expect(() => assertNoDuplicateStates(captures)).not.toThrow();
  });

  it('does not compare across different lanes', () => {
    const a = capture('menu', 'menu.png');
    const b = { ...capture('menu_v2', 'menu.png'), lane: 'v2' };
    expect(() => assertNoDuplicateStates([a, b])).not.toThrow();
  });
});
