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

  it('passes a package that re-exports another package symbol (re-export allowance)', () => {
    const { violations } = lintNoDuplication(fixture('pkg-pass'));
    expect(violations).toEqual([]);
  });

  it('fails when a package re-declares a name another package already exports', () => {
    const { violations } = lintNoDuplication(fixture('pkg-fail'));
    const cross = violations.filter((v) => v.kind === 'cross');
    expect(cross.some((v) => v.name === 'sharedThing')).toBe(true);
    // cross-package collisions are hard errors (no severity field).
    for (const v of cross) expect(v.severity).toBeUndefined();
  });

  it('warns on a sdk local shadowing a shared export + a local-vs-local dup', () => {
    const { violations } = lintNoDuplication(fixture('local-fail'));
    const locals = violations.filter((v) => v.kind === 'local');
    const names = locals.map((v) => v.name).sort();
    expect(names).toContain('withTimeout'); // (a) shadows the shared export
    expect(names).toContain('parseEnv'); // (b) copy-pasted across files
    for (const v of locals) expect(v.severity).toBe('warn');
    const shadow = locals.find((v) => v.name === 'withTimeout');
    expect(shadow.file).toMatch(/coordinator\.ts/);
    expect(shadow.note).toMatch(/with-timeout\.ts/);
  });
});
