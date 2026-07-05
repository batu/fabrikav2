import { describe, it, expect } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintNoDuplication } from '../src/no-duplication.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => join(here, 'fixtures', 'no-duplication', name);

describe('no-duplication', () => {
  it('passes when a game re-uses (re-exports) the shared symbol', () => {
    const { violations } = lintNoDuplication(fixture('pass'));
    expect(violations).toEqual([]);
  });

  it('fails when a game re-declares a package public export name', () => {
    const { violations } = lintNoDuplication(fixture('fail'));
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      name: 'safeImpact',
      package: '@fabrikav2/sdk',
    });
    expect(violations[0].file).toMatch(/games\/badgame\/src\/haptics\.ts/);
  });
});
