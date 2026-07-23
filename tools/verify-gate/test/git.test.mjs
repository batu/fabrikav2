import { describe, it, expect } from 'vitest';
import { makeRunner } from '../src/git.mjs';

describe('makeRunner (real execSync)', () => {
  it('returns stdout on success', () => {
    const run = makeRunner(process.cwd());
    expect(run('echo hello')).toEqual({ ok: true, stdout: 'hello\n', stderr: '' });
  });

  it('trims stdout when asked (release-provenance behavior)', () => {
    const run = makeRunner(process.cwd(), { trim: true });
    expect(run('echo hello').stdout).toBe('hello');
  });

  it('captures stderr on failure so gates can report WHY', () => {
    const run = makeRunner(process.cwd());
    const res = run('node -e "console.error(\'boom\'); process.exit(3)"');
    expect(res.ok).toBe(false);
    expect(res.stderr).toContain('boom');
  });
});
