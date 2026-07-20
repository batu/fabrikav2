import { describe, expect, it } from 'vitest';

import { resolveRuntimeTextureLongEdge } from '../../src/scenes/RuntimeTexturePolicy';

describe('resolveRuntimeTextureLongEdge', () => {
  it('uses the WebGL texture limit when the renderer reports one', () => {
    expect(resolveRuntimeTextureLongEdge(8192)).toBe(8192);
    expect(resolveRuntimeTextureLongEdge(4096)).toBe(4096);
    expect(resolveRuntimeTextureLongEdge(2048)).toBe(2048);
  });

  it('retains the 2560 guard for Canvas, unknown, and invalid limits', () => {
    expect(resolveRuntimeTextureLongEdge(null)).toBe(2560);
    expect(resolveRuntimeTextureLongEdge(Number.NaN)).toBe(2560);
    expect(resolveRuntimeTextureLongEdge(0)).toBe(2560);
  });
});
