import { describe, expect, it } from 'vitest';
import { assertRestorationBackgroundTextures } from '../../src/config/restorationAssetContract';

describe('pickup rendered asset contract', () => {
  it('rejects metadata whose background download failed rather than counting a placeholder as pickup', () => {
    expect(() => assertRestorationBackgroundTextures(['bg.png'], () => false)).toThrow('missing loaded background');
  });
  it('requires every section background, not just the first', () => {
    expect(() => assertRestorationBackgroundTextures(['a.png', 'b.png'], (key) => key === 'bg_0')).toThrow('bg_1');
    expect(() => assertRestorationBackgroundTextures(['a.png', 'b.png'], () => true)).not.toThrow();
  });
});
