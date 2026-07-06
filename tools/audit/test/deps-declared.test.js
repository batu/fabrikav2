import { describe, it, expect } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintDepsDeclared } from '../src/deps-declared.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => join(here, 'fixtures', 'deps-declared', name);

describe('deps-declared', () => {
  it('passes when the imported @fabrikav2 package is declared', () => {
    const { violations } = lintDepsDeclared(fixture('pass'));
    expect(violations).toEqual([]);
  });

  it('fails on phantom imports in BOTH quote styles (the v1 grep bug)', () => {
    const { violations } = lintDepsDeclared(fixture('fail'));
    const imports = violations.map((v) => v.import).sort();
    // single-quoted @fabrikav2/kernel is exactly what v1's grep missed
    expect(imports).toEqual(['@fabrikav2/kernel', '@fabrikav2/ui']);
    for (const v of violations) {
      expect(v.workspace).toBe('@fabrikav2/badgame');
      expect(v.file).toMatch(/games\/badgame\/src\/index\.ts/);
    }
  });

  it('warns on a declared @fabrikav2/* dep that is never imported (inverse check)', () => {
    const { violations } = lintDepsDeclared(fixture('unused-fail'));
    const unused = violations.filter((v) => v.kind === 'unused');
    expect(unused).toHaveLength(1);
    expect(unused[0]).toMatchObject({
      workspace: '@fabrikav2/consumer',
      import: '@fabrikav2/kernel',
      severity: 'warn',
    });
    // it is a warning, not a phantom-import error — no phantom violations here.
    expect(violations.filter((v) => v.kind !== 'unused')).toEqual([]);
  });
});
