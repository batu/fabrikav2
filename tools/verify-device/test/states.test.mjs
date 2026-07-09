import { describe, it, expect } from 'vitest';
import { isMissingShotName, stateFromShotName } from '../src/states.mjs';

const STATES = ['menu', 'level', 'settings', 'pause', 'win', 'fail'];

describe('stateFromShotName', () => {
  it('maps runner shot names (order-prefixed) to manifest states', () => {
    expect(stateFromShotName('1-menu', STATES)).toBe('menu');
    expect(stateFromShotName('01-menu', STATES)).toBe('menu');
    expect(stateFromShotName('6-fail', STATES)).toBe('fail');
    expect(stateFromShotName('3-settings', STATES)).toBe('settings');
  });

  it('maps xcresult export names (suffixed with _index_uuid.png)', () => {
    expect(stateFromShotName('04-pause_0_8A262C31-C21A-4AA8.png', STATES)).toBe('pause');
    expect(stateFromShotName('1-menu_0_AE4C4187-3BED.png', STATES)).toBe('menu');
    expect(stateFromShotName('5-win_2_deadbeef.png', STATES)).toBe('win');
  });

  it('maps a bare manifest state name', () => {
    expect(stateFromShotName('level', STATES)).toBe('level');
  });

  it('returns null for names outside the effective manifest states', () => {
    expect(stateFromShotName('7-final', STATES)).toBeNull();
    expect(stateFromShotName('screenshot_0_x.png', STATES)).toBeNull();
    expect(stateFromShotName('')).toBeNull();
    expect(stateFromShotName(undefined, STATES)).toBeNull();
  });

  it('accepts custom states and preserves underscores in state names', () => {
    expect(stateFromShotName('03-shop_0_uuid.png', ['menu', 'shop'])).toBe('shop');
    expect(stateFromShotName('06-fail_0_uuid.png', ['menu', 'shop'])).toBeNull();
    expect(stateFromShotName('02-level_intro_0_uuid.png', ['level_intro'])).toBe('level_intro');
  });
});

describe('isMissingShotName', () => {
  it('detects runner inspection shots for blind captures', () => {
    expect(isMissingShotName('6-fail-MISSING_0_uuid.png')).toBe(true);
    expect(isMissingShotName('1-menu_0_uuid.png')).toBe(false);
  });
});
