import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(__dirname, '..', 'merge-gate.mjs');

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-gate-cli-'));
  fs.mkdirSync(path.join(dir, 'tools', 'verify-device'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'tools', 'verify-device', 'cli.mjs'), '');
  fs.mkdirSync(path.join(dir, 'games'), { recursive: true });
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function runCli(env = {}) {
  return spawnSync(process.execPath, [CLI], {
    cwd: dir,
    env: { ...process.env, VERIFY_GATE_PROJECT_DIR: dir, ...env },
    encoding: 'utf8',
  });
}

function git(cmd) {
  return execSync(`git ${cmd}`, { cwd: dir, encoding: 'utf8' });
}

function write(rel, text, mtimeMs = null) {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  if (mtimeMs !== null) fs.utimesSync(file, new Date(mtimeMs), new Date(mtimeMs));
}

describe('merge-gate CLI', () => {
  it('FAILS closed in a non-git project instead of treating the diff as empty', () => {
    const res = runCli();
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/ERROR|could not resolve changed files/);
  });

  it('FAILS closed when no base ref exists', () => {
    git('init -q -b feature');
    git('config user.email t@t.t');
    git('config user.name t');
    write('games/g/src/menu.ts', 'x');
    git('add -A');
    git('commit -q -m first');
    const res = runCli();
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/origin\/main or main/);
  });

  it('FAILS when the worktree has uncommitted changes', () => {
    git('init -q -b main');
    git('config user.email t@t.t');
    git('config user.name t');
    write('README.md', 'base');
    git('add -A');
    git('commit -q -m base');
    git('checkout -q -b feature');
    write('src/work.ts', 'uncommitted');
    const res = runCli();
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/uncommitted worktree/);
    expect(res.stderr).toContain('src/work.ts');
  });

  it('FAILS a non-exempt docs-only implementation diff', () => {
    git('init -q -b main');
    git('config user.email t@t.t');
    git('config user.name t');
    write('README.md', 'base');
    git('add -A');
    git('commit -q -m base');
    git('checkout -q -b feature');
    write('docs/brainstorms/requirements.md', '# Requirements\n');
    git('add -A');
    git('commit -q -m "docs: requirements only"');
    const res = runCli({ VERIFY_GATE_CARD_TITLE: 'MACHINERY 4: implementation card' });
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/rubber-stamp/);
    expect(res.stderr).toContain('docs/brainstorms/requirements.md');
  });

  it('PASSES a docs-only diff when card labels mark it as research', () => {
    git('init -q -b main');
    git('config user.email t@t.t');
    git('config user.name t');
    write('README.md', 'base');
    git('add -A');
    git('commit -q -m base');
    git('checkout -q -b feature');
    write('docs/research/note.md', '# Note\n');
    git('add -A');
    git('commit -q -m "docs: research note"');
    const res = runCli({ VERIFY_GATE_CARD_LABELS: 'research' });
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/PASS/);
  });

  it('PASSES a visual diff with a fresh matching device panel even when verdict fails', () => {
    git('init -q -b main');
    git('config user.email t@t.t');
    git('config user.name t');
    write('games/g/src/menu.ts', 'base', 1000);
    git('add -A');
    git('commit -q -m base');
    git('checkout -q -b feature');
    write('games/g/src/menu.ts', 'changed', 1000);
    write('docs/evidence/2026-07-07-device-verify/panel.json', JSON.stringify({
      game: 'g',
      lane: 'device',
      generatedAt: '1970-01-01T00:00:02.000Z',
      verdict: { pass: false, score: 45, summary: 'FAIL — panel median 45%' },
      states: [],
    }), 2000);
    git('add -A');
    git('commit -q -m "feat: visual change with evidence"');
    const res = runCli();
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/PASS/);
    expect(res.stdout).toMatch(/verdict FAIL/);
    expect(res.stdout).toMatch(/45/);
  });
});
