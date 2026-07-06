import { describe, it, expect } from 'vitest';
import { stateFromShotName, CANONICAL_STATES } from '../src/states.mjs';

describe('stateFromShotName', () => {
  it('maps runner shot names (order-prefixed) to canonical states', () => {
    expect(stateFromShotName('1-menu')).toBe('menu');
    expect(stateFromShotName('01-menu')).toBe('menu');
    expect(stateFromShotName('6-fail')).toBe('fail');
    expect(stateFromShotName('3-settings')).toBe('settings');
  });

  it('maps xcresult export names (suffixed with _index_uuid.png)', () => {
    expect(stateFromShotName('04-pause_0_8A262C31-C21A-4AA8.png')).toBe('pause');
    expect(stateFromShotName('1-menu_0_AE4C4187-3BED.png')).toBe('menu');
    expect(stateFromShotName('5-win_2_deadbeef.png')).toBe('win');
  });

  it('maps a bare canonical name', () => {
    expect(stateFromShotName('level')).toBe('level');
  });

  it('returns null for non-canonical names', () => {
    expect(stateFromShotName('7-final')).toBeNull();
    expect(stateFromShotName('screenshot_0_x.png')).toBeNull();
    expect(stateFromShotName('')).toBeNull();
    expect(stateFromShotName(undefined)).toBeNull();
  });

  it('covers exactly the six canonical states', () => {
    expect(CANONICAL_STATES).toEqual(['menu', 'level', 'settings', 'pause', 'win', 'fail']);
  });
});
