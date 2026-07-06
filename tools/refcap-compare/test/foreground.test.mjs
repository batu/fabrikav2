import { describe, it, expect } from 'vitest';
import { parseForegroundActivity, verifyForeground, assertForeground } from '../src/foreground.mjs';

const PKG = 'com.basegamelab.marblerun';
const MATCHING = `
  mResumedActivity: ActivityRecord{1a2b u0 com.basegamelab.marblerun/.MainActivity t42}
  topResumedActivity=ActivityRecord{9a3f u0 com.basegamelab.marblerun/.MainActivity t42}
`;
const WRONG = `
  topResumedActivity=ActivityRecord{7c1d u0 com.android.launcher3/.Launcher t1}
`;
const EMPTY = 'no resumed activity here';

describe('foreground-verify (reference lane capture-integrity)', () => {
  it('parses the foreground package/activity', () => {
    expect(parseForegroundActivity(MATCHING)).toEqual({
      package: 'com.basegamelab.marblerun',
      activity: '.MainActivity',
    });
  });

  it('passes when the expected package is foreground', () => {
    expect(verifyForeground(MATCHING, PKG).ok).toBe(true);
  });

  it('fails when a different app is foreground (mislabel guard)', () => {
    const r = verifyForeground(WRONG, PKG);
    expect(r.ok).toBe(false);
    expect(r.actual.package).toBe('com.android.launcher3');
  });

  it('fails when no activity can be parsed', () => {
    expect(verifyForeground(EMPTY, PKG).ok).toBe(false);
  });

  it('assertForeground throws naming the state on mismatch', () => {
    expect(() => assertForeground(WRONG, PKG, 'menu')).toThrow(/foreground-verify FAILED for state "menu"/);
  });

  it('assertForeground returns the actual component on match', () => {
    expect(assertForeground(MATCHING, PKG, 'menu').package).toBe(PKG);
  });
});
