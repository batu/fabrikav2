// The `publish <scratch> [--out <publicationRoot>]` CLI verb actually runs and is
// HONEST: usage errors return 2, every block returns nonzero and writes nothing
// to the output root, and a valid session scratch produces an immutable
// publication (requirement 4). It publishes only from a scratch OUTSIDE the
// landing worktree; the default output is the committed publications root but a
// block never mutates it. These tests spawn the REAL CLI binary (not an in-process
// import) so the verb's exit codes and side effects are proven end-to-end.
import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resetToScratch } from '../src/reset.ts';
import { repoPath, sealScratchProvenance } from './helpers.ts';

const TSX = repoPath('node_modules', '.bin', 'tsx');
const CLI = repoPath('tools', 'phaser-shell', 'src', 'cli.mjs');
const CWD = repoPath('tools', 'phaser-shell');

const tmps: string[] = [];
function tmp(): string {
  const d = mkdtempSync(path.join(os.tmpdir(), 'u5-cli-'));
  tmps.push(d);
  return d;
}
afterEach(() => {
  while (tmps.length) rmSync(tmps.pop()!, { recursive: true, force: true });
});

/** Run `cli publish …`, returning the exit code + parsed stdout JSON (if any). */
function cliPublish(...args: string[]): { code: number; out: Record<string, unknown> | null; stderr: string } {
  const r = spawnSync(TSX, [CLI, 'publish', ...args], { cwd: CWD, encoding: 'utf8' });
  let out: Record<string, unknown> | null = null;
  try {
    out = JSON.parse(r.stdout);
  } catch {
    /* usage errors print to stderr only */
  }
  return { code: r.status ?? -1, out, stderr: r.stderr };
}

describe('P5 cli publish <scratch> [--out]', () => {
  it('prints usage and returns 2 when no scratch is given', () => {
    const r = cliPublish();
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('usage: cli publish <scratch>');
  });

  it('prints usage and returns 2 when --out has no value', () => {
    const r = cliPublish(tmp(), '--out');
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('usage: cli publish <scratch>');
  });

  it('blocks (returns 1) an in-repo scratch and writes NOTHING to the output root', () => {
    const out = tmp();
    const r = cliPublish(CWD, '--out', out);
    expect(r.code).toBe(1);
    expect(r.out).toMatchObject({ result: 'blocked', code: 'scratch-in-repo' });
    expect(readdirSync(out)).toEqual([]);
  });

  it('blocks a reset-only scratch until real-Editor provenance seals its exact bytes', { timeout: 30_000 }, async () => {
    const s = await resetToScratch(tmp());
    const out = tmp();
    const r = cliPublish(s.scratch, '--out', out);
    expect(r.code).toBe(1);
    expect(r.out).toMatchObject({ result: 'blocked', code: 'provenance-missing' });
    expect(readdirSync(out)).toEqual([]);
  });

  it('publishes a provenance-sealed session scratch into an immutable publication (returns 0)', { timeout: 30_000 }, async () => {
    const s = await resetToScratch(tmp());
    await sealScratchProvenance(s.scratch, s.project);
    const out = tmp();
    const r = cliPublish(s.scratch, '--out', out);
    expect(r.code).toBe(0);
    expect(r.out?.result).toBe('ok');
    const dir = path.join(out, String(r.out?.publicationId));
    expect(existsSync(path.join(dir, 'manifest.json'))).toBe(true);
    expect(existsSync(path.join(dir, 'projection', 'scenes', 'shell.js'))).toBe(true);
  });

  it('blocks (returns 1) a validation-failing scratch and mutates NOTHING', { timeout: 30_000 }, async () => {
    const s = await resetToScratch(tmp());
    const scenePath = path.join(s.project, 'src', 'scenes', 'Menu.scene');
    const scene = JSON.parse(readFileSync(scenePath, 'utf8')) as { displayList: Array<Record<string, unknown>> };
    scene.displayList.find((o) => o['Semantic.fabSemanticId'] === 'menu.title')!['text'] = '<script>evil</script>';
    writeFileSync(scenePath, JSON.stringify(scene));
    await sealScratchProvenance(s.scratch, s.project);
    const out = tmp();
    const r = cliPublish(s.scratch, '--out', out);
    expect(r.code).toBe(1);
    expect(r.out?.result).toBe('blocked');
    // Validation fails closed BEFORE staging → the output root is untouched.
    expect(readdirSync(out)).toEqual([]);
  });

  it('blocks when bytes change after the real-Editor provenance seal', { timeout: 30_000 }, async () => {
    const s = await resetToScratch(tmp());
    await sealScratchProvenance(s.scratch, s.project);
    const scenePath = path.join(s.project, 'src', 'scenes', 'Menu.scene');
    const scene = JSON.parse(readFileSync(scenePath, 'utf8')) as { displayList: Array<Record<string, unknown>> };
    scene.displayList.find((o) => o['Semantic.fabSemanticId'] === 'menu.title')!['text'] = 'After Seal';
    writeFileSync(scenePath, JSON.stringify(scene));
    const out = tmp();
    const r = cliPublish(s.scratch, '--out', out);
    expect(r.code).toBe(1);
    expect(r.out).toMatchObject({ result: 'blocked', code: 'provenance-invalid' });
    expect(readdirSync(out)).toEqual([]);
  });
});
