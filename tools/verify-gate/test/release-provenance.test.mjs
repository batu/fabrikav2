import { describe, expect, it } from 'vitest';
import { checkReleaseProvenance } from '../src/release-provenance.mjs';

function runner(responses) {
  return (cmd) => {
    for (const [prefix, value] of Object.entries(responses)) {
      if (cmd.startsWith(prefix)) return value;
    }
    return { ok: false, stdout: '' };
  };
}

const HEAD = { ok: true, stdout: 'abcdef1234abcdef1234abcdef1234abcdef1234' };

describe('checkReleaseProvenance', () => {
  it('passes on a clean, pushed HEAD', () => {
    const result = checkReleaseProvenance(runner({
      'git rev-parse': HEAD,
      'git status': { ok: true, stdout: '' },
      'git branch -r': { ok: true, stdout: '  origin/main' },
    }));
    expect(result.ok).toBe(true);
    expect(result.sha).toBe(HEAD.stdout);
  });

  it('fails on a dirty working tree', () => {
    const result = checkReleaseProvenance(runner({
      'git rev-parse': HEAD,
      'git status': { ok: true, stdout: ' M src/foo.ts\n?? scratch.txt' },
      'git branch -r': { ok: true, stdout: '  origin/main' },
    }));
    expect(result.ok).toBe(false);
    expect(result.failures.join(' ')).toContain('dirty');
    expect(result.failures.join(' ')).toContain('2 path(s)');
  });

  it('fails when HEAD is not on any remote branch', () => {
    const result = checkReleaseProvenance(runner({
      'git rev-parse': HEAD,
      'git status': { ok: true, stdout: '' },
      'git branch -r': { ok: true, stdout: '' },
    }));
    expect(result.ok).toBe(false);
    expect(result.failures.join(' ')).toContain('not pushed');
  });

  it('fails closed outside a git checkout', () => {
    const result = checkReleaseProvenance(runner({}));
    expect(result.ok).toBe(false);
    expect(result.failures[0]).toContain('not a git checkout');
  });

  it('reports both failures at once for a dirty AND unpushed tree', () => {
    const result = checkReleaseProvenance(runner({
      'git rev-parse': HEAD,
      'git status': { ok: true, stdout: ' M a' },
      'git branch -r': { ok: true, stdout: '' },
    }));
    expect(result.failures).toHaveLength(2);
  });
});
