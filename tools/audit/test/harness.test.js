import { describe, it, expect } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { lintHarness } from '../src/harness.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => join(here, 'fixtures', 'harness', name);
const cliPath = join(here, '..', 'src', 'cli.js');

describe('harness', () => {
  it('passes a game with the canonical surface AND one using the autoWin/autoFail aliases', () => {
    const { violations } = lintHarness(fixture('pass'));
    expect(violations).toEqual([]);
  });

  it('hard-errors on a harness missing the solver-bound goal verbs', () => {
    const { violations } = lintHarness(fixture('fail'));
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ game: 'games/broken_game', severity: 'error' });
    expect(violations[0].missing.join(' ')).toMatch(/winLevel.*WIN goal/);
    expect(violations[0].missing.join(' ')).toMatch(/failLevel.*FAIL goal/);
    // STATE + primitive verbs are present, so they are NOT reported missing.
    expect(violations[0].missing.join(' ')).not.toMatch(/snapshot/);
    expect(violations[0].missing.join(' ')).not.toMatch(/verbs/);
  });

  it('flags a game that ships NO harness (no file imports the contract)', () => {
    const { violations } = lintHarness(fixture('nohar'));
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ game: 'games/harnessless_game', severity: 'error' });
    expect(violations[0].missing.join(' ')).toMatch(/no harness/);
  });

  it('makes the audit CLI fail a fixture game with no harness', () => {
    const result = spawnSync(process.execPath, [cliPath, '--root', fixture('nohar')], {
      encoding: 'utf8',
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('✗ harness: 1 error(s)');
    expect(result.stdout).toContain('games/harnessless_game');
    expect(result.stderr).toContain('audit failed');
  });
});
