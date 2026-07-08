import { describe, it, expect } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { lintTokenReferences } from '../src/token-references.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => join(here, 'fixtures', 'token-references', name);
const cliPath = join(here, '..', 'src', 'cli.js');

describe('token-references', () => {
  it('fails var() references with no definition and no fallback', () => {
    const { violations } = lintTokenReferences(fixture('missing-token'));

    expect(violations).toEqual([
      expect.objectContaining({
        kind: 'unresolved-var',
        scope: 'games/demo',
        token: '--fab-missing-token',
        file: 'games/demo/src/game.css',
        line: 2,
      }),
    ]);
  });

  it('passes unresolved var() references that carry fallbacks', () => {
    const { violations } = lintTokenReferences(fixture('fallback'));

    expect(violations).toEqual([]);
  });

  it('passes references defined by UI defaults, game design tokens, and local CSS aliases', () => {
    const { violations } = lintTokenReferences(fixture('defined'));

    expect(violations).toEqual([]);
  });

  it('is wired into the audit CLI as a hard error', () => {
    const result = spawnSync(process.execPath, [cliPath, '--root', fixture('missing-token')], {
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('✗ token-references: 1 error(s)');
    expect(result.stdout).toContain('var(--fab-missing-token) has no fallback');
    expect(result.stderr).toContain('audit failed');
  });
});
