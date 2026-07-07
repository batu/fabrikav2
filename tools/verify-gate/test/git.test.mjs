import { describe, it, expect } from 'vitest';
import { resolveBaseRef, changedFilesVsMain } from '../src/git.mjs';

// A scripted command runner: matches on a substring of the git command.
function runner(map) {
  return (cmd) => {
    for (const [needle, res] of Object.entries(map)) {
      if (cmd.includes(needle)) return res;
    }
    return { ok: false, stdout: '' };
  };
}

describe('resolveBaseRef', () => {
  it('prefers origin/main when it resolves', () => {
    const run = runner({ 'rev-parse --verify --quiet origin/main': { ok: true, stdout: 'sha\n' } });
    expect(resolveBaseRef(run)).toEqual({ ok: true, ref: 'origin/main' });
  });
  it('falls back to main when origin/main is absent', () => {
    const run = runner({
      'rev-parse --verify --quiet origin/main': { ok: false, stdout: '' },
      'rev-parse --verify --quiet main': { ok: true, stdout: 'sha\n' },
    });
    expect(resolveBaseRef(run)).toEqual({ ok: true, ref: 'main' });
  });
  it('fails closed when neither base ref resolves', () => {
    expect(resolveBaseRef(runner({}))).toMatchObject({ ok: false, error: expect.stringMatching(/origin\/main or main/) });
  });
});

describe('changedFilesVsMain', () => {
  it('diffs against the merge-base with origin/main and splits filenames', () => {
    const run = runner({
      'rev-parse --verify --quiet origin/main': { ok: true, stdout: 'sha\n' },
      'merge-base origin/main HEAD': { ok: true, stdout: 'BASESHA\n' },
      'diff --name-only BASESHA': { ok: true, stdout: 'games/g/src/a.ts\npackages/ui/b.tsx\n' },
      'ls-files --others --exclude-standard': { ok: true, stdout: '' },
    });
    expect(changedFilesVsMain(run)).toEqual({ ok: true, files: ['games/g/src/a.ts', 'packages/ui/b.tsx'] });
  });

  it('fails closed when no base ref resolves', () => {
    expect(changedFilesVsMain(runner({}))).toMatchObject({ ok: false });
  });

  it('includes untracked files and de-dupes against the diff', () => {
    const run = runner({
      'rev-parse --verify --quiet origin/main': { ok: true, stdout: 'sha\n' },
      'merge-base origin/main HEAD': { ok: true, stdout: 'BASESHA\n' },
      'diff --name-only BASESHA': { ok: true, stdout: 'games/g/src/a.ts\n' },
      'ls-files --others --exclude-standard': { ok: true, stdout: 'games/g/src/a.ts\ngames/g/src/new.ts\n' },
    });
    expect(changedFilesVsMain(run)).toEqual({ ok: true, files: ['games/g/src/a.ts', 'games/g/src/new.ts'] });
  });

  it('fails closed when the diff command fails', () => {
    const run = runner({
      'rev-parse --verify --quiet origin/main': { ok: true, stdout: 'sha\n' },
      'merge-base origin/main HEAD': { ok: true, stdout: 'BASESHA\n' },
      'diff --name-only BASESHA': { ok: false, stdout: '' },
    });
    expect(changedFilesVsMain(run)).toMatchObject({ ok: false, error: expect.stringMatching(/diff/) });
  });

  it('fails closed when untracked-file enumeration fails', () => {
    const run = runner({
      'rev-parse --verify --quiet origin/main': { ok: true, stdout: 'sha\n' },
      'merge-base origin/main HEAD': { ok: true, stdout: 'BASESHA\n' },
      'diff --name-only BASESHA': { ok: true, stdout: '' },
      'ls-files --others --exclude-standard': { ok: false, stdout: '' },
    });
    expect(changedFilesVsMain(run)).toMatchObject({ ok: false, error: expect.stringMatching(/ls-files/) });
  });
});
