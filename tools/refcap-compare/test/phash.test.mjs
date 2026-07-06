import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng } from '../src/png.mjs';
import { signature, distance, DUP_THRESHOLD } from '../src/phash.mjs';

const REF = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', '..', '..',
  'games/marble_run/refs/captures/android-basegamelab',
);

function sig(name) {
  return signature(decodePng(fs.readFileSync(path.join(REF, name))));
}

describe('perceptual signature calibration (dedup threshold)', () => {
  const menu = sig('menu.png');
  const levelStart = sig('level-start.png');
  const levelMid = sig('level-mid.png');
  const settings = sig('settings.png');
  const win = sig('win-ref.png');
  const fail = sig('fail-ref.png');

  it('level-start and level-mid (same state, ledger B2) are within the dup threshold', () => {
    expect(distance(levelStart, levelMid)).toBeLessThanOrEqual(DUP_THRESHOLD);
  });

  it('genuinely distinct states are all above the dup threshold', () => {
    const pairs = [
      ['menu', menu, 'settings', settings],
      ['menu', menu, 'level', levelStart],
      ['settings', settings, 'level', levelStart],
      ['win', win, 'fail', fail], // the tricky pair: coarse dHash could not separate these
      ['menu', menu, 'win', win],
      ['settings', settings, 'win', win],
    ];
    for (const [na, a, nb, b] of pairs) {
      expect(distance(a, b), `${na} vs ${nb}`).toBeGreaterThan(DUP_THRESHOLD);
    }
  });

  it('an identical image has zero distance', () => {
    expect(distance(menu, sig('menu.png'))).toBe(0);
  });
});
