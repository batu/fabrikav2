import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { publish } from '../src/publish/publish.ts';
import { offlineProof } from '../src/publish/proof.ts';
import { status } from '../src/publish/status.ts';
import { resetToScratch } from '../src/reset.ts';
import { loadPublishInput } from './gen.ts';
import { REPO_ROOT } from './helpers.ts';

const tmps: string[] = [];
function tmp(): string {
  const d = mkdtempSync(path.join(os.tmpdir(), 'u5-proof-'));
  tmps.push(d);
  return d;
}
afterEach(() => {
  while (tmps.length) rmSync(tmps.pop()!, { recursive: true, force: true });
});

describe('P5 offline proof (editor-free leg)', () => {
  it('a clean publication passes the offline proof (network-free, editor-free, raster-only)', async () => {
    const r = await publish(loadPublishInput(tmp()));
    const proof = await offlineProof(r.dir!);
    expect(proof.ok).toBe(true);
    expect(proof.findings).toEqual([]);
  });

  it('flags an editor footprint leaking into the runtime bundle', async () => {
    const r = await publish(loadPublishInput(tmp()));
    const shellJs = path.join(r.dir!, 'projection', 'scenes', 'shell.js');
    writeFileSync(shellJs, readFileSync(shellJs, 'utf8') + '\n// phasereditor2d marker\n');
    const proof = await offlineProof(r.dir!);
    expect(proof.ok).toBe(false);
    expect(proof.findings.some((f) => f.code === 'editor-footprint')).toBe(true);
  });

  it('flags a remote URL leaking into the runtime bundle', async () => {
    const r = await publish(loadPublishInput(tmp()));
    const shellJs = path.join(r.dir!, 'projection', 'scenes', 'shell.js');
    writeFileSync(shellJs, readFileSync(shellJs, 'utf8') + '\nfetchFrom("https://tracker.example.com");\n');
    const proof = await offlineProof(r.dir!);
    expect(proof.findings.some((f) => f.code === 'remote-content')).toBe(true);
  });

  it('status reports ready for a clean publication and tampered after an edit', async () => {
    const r = await publish(loadPublishInput(tmp()));
    expect((await status(r.dir!)).outcome).toBe('ready');
    writeFileSync(path.join(r.dir!, 'projection', 'scenes', 'shell.js'), 'tampered');
    expect((await status(r.dir!)).outcome).toBe('tampered');
  });
});

describe('P5 rehearsal reset (clean P0 scratch, never the landing worktree)', () => {
  it('copies the clean P0 to a scratch dir outside the worktree and records a stable P0 hash', async () => {
    const scratch = tmp();
    const a = await resetToScratch(scratch);
    expect(a.scratch).toBe(scratch);
    const scratchMenu = path.join(a.project, 'src', 'scenes', 'Menu.scene');
    expect(existsSync(scratchMenu)).toBe(true);
    // The scratch starts in the licensed Editor's own no-trailing-newline save form.
    expect(readFileSync(scratchMenu, 'utf8').endsWith('\n')).toBe(false);
    // The scratch is NOT inside the landing worktree.
    expect(path.resolve(a.scratch).startsWith(path.resolve(REPO_ROOT))).toBe(false);
    // The recorded P0 hash is deterministic.
    const b = await resetToScratch(tmp());
    expect(b.p0Hash).toBe(a.p0Hash);
    expect(a.p0Hash).toMatch(/^sha256-[a-f0-9]{64}$/);
  });

  it('copies the allowlisted editor-plugins into the scratch so the provenance -plugins path is scratch-local', async () => {
    const scratch = tmp();
    const a = await resetToScratch(scratch);
    expect(a.plugins).toBe(path.join(scratch, 'editor-plugins'));
    // The allowlist + the live-copy plugin ride with the scratch (never the worktree).
    expect(existsSync(path.join(a.plugins, 'allowlist.json'))).toBe(true);
    expect(existsSync(path.join(a.plugins, 'live-copy-preview', 'plugin.json'))).toBe(true);
    expect(path.resolve(a.plugins).startsWith(path.resolve(REPO_ROOT))).toBe(false);
  });
});
