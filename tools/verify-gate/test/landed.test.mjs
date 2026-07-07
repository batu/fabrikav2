import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import {
  resolveSha,
  isAncestorOf,
  artifactPresent,
  locateBranch,
  decideLanded,
  evaluateLanded,
  parseArgs,
} from '../src/landed.mjs';

// A scripted command runner: matches on a substring of the git command.
function runner(map) {
  return (cmd) => {
    for (const [needle, res] of Object.entries(map)) {
      if (cmd.includes(needle)) return res;
    }
    return { ok: false, stdout: '' };
  };
}

describe('resolveSha', () => {
  it('returns the trimmed sha when the ref resolves', () => {
    const run = runner({ 'rev-parse --verify --quiet feature^{commit}': { ok: true, stdout: 'ABC123\n' } });
    expect(resolveSha(run, 'feature')).toBe('ABC123');
  });
  it('returns null when the ref does not resolve', () => {
    expect(resolveSha(runner({}), 'nope')).toBe(null);
  });
});

describe('isAncestorOf', () => {
  it('true when merge-base --is-ancestor exits 0', () => {
    const run = runner({ 'merge-base --is-ancestor ABC HEAD': { ok: true, stdout: '' } });
    expect(isAncestorOf(run, 'ABC', 'HEAD')).toBe(true);
  });
  it('false when merge-base --is-ancestor exits non-zero', () => {
    expect(isAncestorOf(runner({}), 'ABC', 'HEAD')).toBe(false);
  });
});

describe('artifactPresent', () => {
  it('true when cat-file -e succeeds', () => {
    const run = runner({ 'cat-file -e main:tools/x': { ok: true, stdout: '' } });
    expect(artifactPresent(run, 'main', 'tools/x')).toBe(true);
  });
  it('false when cat-file -e fails', () => {
    expect(artifactPresent(runner({}), 'main', 'tools/x')).toBe(false);
  });
});

describe('locateBranch (locate, never reconstruct)', () => {
  it('returns the single matching branch', () => {
    const run = runner({
      "branch --list 'trello-abc12345-": { ok: true, stdout: 'trello-abc12345-do-thing\n' },
    });
    expect(locateBranch(run, 'abc12345')).toEqual({ ok: true, branch: 'trello-abc12345-do-thing' });
  });
  it('hard-fails on zero matches', () => {
    const res = locateBranch(runner({}), 'abc12345');
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/cannot locate/);
    expect(res.reason).toMatch(/NEVER reconstruct/);
  });
  it('hard-fails (ambiguous) on multiple matches, naming candidates', () => {
    const run = runner({
      "branch --list 'trello-abc12345-": { ok: true, stdout: 'trello-abc12345-a\ntrello-abc12345-b\n' },
    });
    const res = locateBranch(run, 'abc12345');
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/ambiguous/);
    expect(res.candidates).toEqual(['trello-abc12345-a', 'trello-abc12345-b']);
  });
});

describe('decideLanded (pure decision)', () => {
  const base = { branch: 'trello-x-y', branchSha: 'SHA', ontoRef: 'HEAD', isAncestor: true };

  it('PASS when the branch tip is an ancestor of the integration ref', () => {
    const d = decideLanded(base);
    expect(d.ok).toBe(true);
    expect(d.reason).toMatch(/safe to clean up/);
  });

  it('FAIL (loud, sha-bearing) when the branch is NOT an ancestor', () => {
    const d = decideLanded({ ...base, isAncestor: false });
    expect(d.ok).toBe(false);
    expect(d.reason).toMatch(/NOT an ancestor/);
    expect(d.reason).toMatch(/REFUSING/);
    expect(d.reason).toMatch(/SHA/); // sha echoed for recovery
  });

  it('FAIL when the branch tip cannot be resolved', () => {
    const d = decideLanded({ ...base, branchSha: null });
    expect(d.ok).toBe(false);
    expect(d.reason).toMatch(/cannot resolve the tip commit/);
  });

  it('FAIL when a key artifact is missing even though ancestry holds', () => {
    const d = decideLanded({
      ...base,
      artifacts: ['tools/x', 'tools/y'],
      missingArtifacts: ['tools/y'],
    });
    expect(d.ok).toBe(false);
    expect(d.reason).toMatch(/key artifact\(s\) are MISSING/);
    expect(d.reason).toMatch(/tools\/y/);
  });

  it('PASS and mentions artifact count when all key artifacts are present', () => {
    const d = decideLanded({ ...base, artifacts: ['tools/x'], missingArtifacts: [] });
    expect(d.ok).toBe(true);
    expect(d.reason).toMatch(/1 key artifact\(s\) present/);
  });

  it('FAIL when no branch is supplied', () => {
    expect(decideLanded({ ...base, branch: '' }).ok).toBe(false);
  });
});

describe('evaluateLanded (gather + decide)', () => {
  it('PASSes for a landed branch with a present artifact', () => {
    const run = runner({
      'rev-parse --verify --quiet trello-x-y^{commit}': { ok: true, stdout: 'SHA1\n' },
      'merge-base --is-ancestor SHA1 HEAD': { ok: true, stdout: '' },
      'cat-file -e HEAD:tools/verify-gate/landed-gate.mjs': { ok: true, stdout: '' },
    });
    const res = evaluateLanded({
      run,
      branch: 'trello-x-y',
      artifacts: ['tools/verify-gate/landed-gate.mjs'],
    });
    expect(res.ok).toBe(true);
    expect(res.branchSha).toBe('SHA1');
  });

  it('FAILs (does not touch artifacts) when the branch is not landed', () => {
    let artifactChecked = false;
    const run = (cmd) => {
      if (cmd.includes('cat-file')) artifactChecked = true;
      if (cmd.includes('rev-parse --verify --quiet trello-x-y^{commit}')) return { ok: true, stdout: 'SHA1\n' };
      return { ok: false, stdout: '' }; // is-ancestor fails
    };
    const res = evaluateLanded({ run, branch: 'trello-x-y', artifacts: ['whatever'] });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/NOT an ancestor/);
    expect(artifactChecked).toBe(false); // short-circuits before artifact ls
  });
});

describe('parseArgs', () => {
  it('takes a positional branch and defaults onto=HEAD', () => {
    expect(parseArgs(['trello-x-y'])).toEqual({
      branch: 'trello-x-y', shortid: null, onto: 'HEAD', artifacts: [],
    });
  });
  it('parses --shortid, --onto, and repeatable --artifact', () => {
    expect(parseArgs(['--shortid', 'abc12345', '--onto', 'main', '--artifact', 'a', '--artifact', 'b'])).toEqual({
      branch: null, shortid: 'abc12345', onto: 'main', artifacts: ['a', 'b'],
    });
  });
  it('throws when neither branch nor --shortid is given', () => {
    expect(() => parseArgs([])).toThrow(/branch .* or --shortid/);
  });
  it('throws when both branch and --shortid are given', () => {
    expect(() => parseArgs(['trello-x-y', '--shortid', 'abc12345'])).toThrow(/EITHER a branch/);
  });
  it('throws on an unexpected flag', () => {
    expect(() => parseArgs(['--bogus'])).toThrow(/unexpected argument/);
  });
});

// Real-git integration: observe that the guard's plumbing reflects true merge
// state, not just a mocked runner. This exercises resolveSha + isAncestorOf +
// artifactPresent against an actual repo through evaluateLanded.
describe('evaluateLanded against a real git repo', () => {
  let dir;
  const git = (cmd) => execSync(`git ${cmd}`, { cwd: dir, encoding: 'utf8' });
  const realRun = (cmd) => {
    try {
      return { ok: true, stdout: execSync(cmd, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) };
    } catch (e) {
      return { ok: false, stdout: e && e.stdout ? String(e.stdout) : '' };
    }
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'landed-gate-'));
    git('init -q -b main');
    git('config user.email t@t.t');
    git('config user.name t');
    fs.writeFileSync(path.join(dir, 'base.txt'), 'base\n');
    git('add -A');
    git('commit -q -m base');
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('PASSes after the card branch is merged into main (artifact reachable on HEAD)', () => {
    git('checkout -q -b trello-abc12345-add-key');
    fs.writeFileSync(path.join(dir, 'key-artifact.txt'), 'the artifact\n');
    git('add -A');
    git('commit -q -m "add key artifact"');
    git('checkout -q main');
    git('merge -q --no-edit trello-abc12345-add-key');

    const res = evaluateLanded({
      run: realRun,
      branch: 'trello-abc12345-add-key',
      ontoRef: 'HEAD',
      artifacts: ['key-artifact.txt'],
    });
    expect(res.ok).toBe(true);
  });

  it('FAILs when the branch was NOT merged (the branch-delete-before-confirm class)', () => {
    git('checkout -q -b trello-abc12345-add-key');
    fs.writeFileSync(path.join(dir, 'key-artifact.txt'), 'the artifact\n');
    git('add -A');
    git('commit -q -m "add key artifact"');
    git('checkout -q main'); // never merged

    const res = evaluateLanded({ run: realRun, branch: 'trello-abc12345-add-key', ontoRef: 'HEAD' });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/NOT an ancestor/);
  });

  it('FAILs when the branch merged but a named key artifact is absent on main', () => {
    git('checkout -q -b trello-abc12345-add-key');
    fs.writeFileSync(path.join(dir, 'other.txt'), 'other\n');
    git('add -A');
    git('commit -q -m "add other"');
    git('checkout -q main');
    git('merge -q --no-edit trello-abc12345-add-key');

    const res = evaluateLanded({
      run: realRun,
      branch: 'trello-abc12345-add-key',
      ontoRef: 'HEAD',
      artifacts: ['key-artifact.txt'], // never created
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/MISSING/);
  });
});
