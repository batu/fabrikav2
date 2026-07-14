// The publisher loads an explicit, session-validated project graph and FAILS
// CLOSED on a missing, symlinked, or unexpected generated-graph file
// (requirement 1). These tests prove the REAL committed graph loads and
// publishes, that every portable authoring input is retained, and that each
// rejection path blocks with a typed code (never a silent proceed).
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, symlinkSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { publish, verifyPluginTrust } from '../src/publish/publish.ts';
import { loadCommittedPublishProject, loadScratchProject, ProjectLoadBlocked } from '../src/loadProject.ts';
import { resetToScratch } from '../src/reset.ts';
import { STATE_IDS } from '../src/authoring/extractV2.ts';
import { PathBlocked } from '../src/session/paths.ts';
import { repoPath, sealScratchProvenance } from './helpers.ts';
import { sha256 } from '../src/publish/manifest.ts';

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

const tmps: string[] = [];
function tmp(): string {
  const d = mkdtempSync(path.join(os.tmpdir(), 'u5-load-'));
  tmps.push(d);
  return d;
}
afterEach(() => {
  while (tmps.length) rmSync(tmps.pop()!, { recursive: true, force: true });
});

/** Assert `fn` throws a ProjectLoadBlocked with the given code. */
function expectBlocked(fn: () => unknown, code: string): void {
  try {
    fn();
    expect.fail(`expected a ProjectLoadBlocked "${code}"`);
  } catch (err) {
    expect(err).toBeInstanceOf(ProjectLoadBlocked);
    expect((err as ProjectLoadBlocked).code).toBe(code);
  }
}

describe('P5 session-validated project loader', () => {
  it('loads the REAL committed generated graph (not a synthesized stand-in) and publishes it', async () => {
    const input = loadCommittedPublishProject(tmp());
    expect(input.scenes.size).toBe(7);
    // Real editor-generated .ts carries the Editor build method + user-code markers.
    const menuGenerated = input.scenes.get('menu')!.generatedSource;
    expect(menuGenerated).toContain('editorCreate');
    expect(menuGenerated).toContain('START OF COMPILED CODE');
    const r = await publish(input);
    expect(r.result).toBe('ok');
    expect(existsSync(path.join(r.dir!, 'projection', 'scenes', 'shell.js'))).toBe(true);
  });

  it('blocks a catalog that drifts from the frozen seed authority', async () => {
    const input = loadCommittedPublishProject(tmp());
    input.catalog = structuredClone(input.catalog);
    input.catalog.entries[0].sha256 = 'sha256-deadbeef';
    const result = await publish(input);
    expect(result.result).toBe('blocked');
    expect(result.blocks).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'blocked-invalid-catalog-id' }),
    ]));
  });

  it('blocks arbitrary code in the generated Semantic bridge', async () => {
    const input = loadCommittedPublishProject(tmp());
    input.userComponentsBytes = Buffer.concat([
      input.userComponentsBytes,
      Buffer.from('\nglobalThis.compromised = true;\n'),
    ]);
    const result = await publish(input);
    expect(result.result).toBe('blocked');
    expect(result.blocks).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'blocked-user-code', where: 'src/components/Semantic.ts' }),
    ]));
  });

  it('retains the complete portable authoring graph in the manifest', async () => {
    const r = await publish(loadCommittedPublishProject(tmp()));
    const manifest = JSON.parse(readFileSync(path.join(r.dir!, 'manifest.json'), 'utf8')) as {
      files: Array<{ path: string }>;
    };
    const paths = new Set(manifest.files.map((f) => f.path));
    const required = [
      'source/components/Semantic.components',
      'source/components/Semantic.ts',
      'source/catalog/catalog.json',
      'source/editor-plugins/allowlist.json',
      'source/editor-plugins/live-copy-preview/live-copy-preview.js',
      'projection/scenes/shell.js',
    ];
    for (const state of STATE_IDS) {
      required.push(`source/scenes/${cap(state)}.scene`, `source/scenes/${cap(state)}.ts`);
    }
    for (const p of required) expect(paths.has(p), p).toBe(true);
  });

  it('rejects a scratch with a MISSING generated module', async () => {
    const s = await resetToScratch(tmp());
    await sealScratchProvenance(s.scratch, s.project);
    rmSync(path.join(s.project, 'src', 'scenes', 'Menu.ts'));
    expectBlocked(() => loadScratchProject(s.scratch, tmp()), 'missing-file');
  });

  it('rejects a SYMLINK in the generated graph', async () => {
    const s = await resetToScratch(tmp());
    await sealScratchProvenance(s.scratch, s.project);
    const link = path.join(s.project, 'src', 'scenes', 'Menu.ts');
    rmSync(link);
    symlinkSync(path.join(s.project, 'src', 'scenes', 'Level.ts'), link);
    expect(() => loadScratchProject(s.scratch, tmp())).toThrow(expect.objectContaining({ code: 'scratch-symlink' }));
  });

  it('rejects an UNEXPECTED file in the generated graph', async () => {
    const s = await resetToScratch(tmp());
    await sealScratchProvenance(s.scratch, s.project);
    writeFileSync(path.join(s.project, 'src', 'scenes', 'Evil.ts'), 'export const x = 1;\n');
    expectBlocked(() => loadScratchProject(s.scratch, tmp()), 'unexpected-graph-file');
  });

  it('rejects provenance evidence with absent compile graph hashes', async () => {
    const s = await resetToScratch(tmp());
    await sealScratchProvenance(s.scratch, s.project);
    const evidencePath = path.join(s.scratch, 'evidence', 'provenance-unit-fixture.json');
    const evidence = JSON.parse(readFileSync(evidencePath, 'utf8')) as Record<string, unknown>;
    evidence['compile'] = { generation1: null, generation2: null, deterministic: true };
    writeFileSync(evidencePath, `${JSON.stringify(evidence)}\n`);
    expectBlocked(() => loadScratchProject(s.scratch, tmp()), 'provenance-invalid');
  });

  it('rejects compile combined hashes that do not bind the generated graph', async () => {
    const s = await resetToScratch(tmp());
    await sealScratchProvenance(s.scratch, s.project);
    const evidencePath = path.join(s.scratch, 'evidence', 'provenance-unit-fixture.json');
    const evidence = JSON.parse(readFileSync(evidencePath, 'utf8')) as {
      compile: { generation1: { combined: string }; generation2: { combined: string } };
    };
    const forged = `sha256-${'0'.repeat(64)}`;
    evidence.compile.generation1.combined = forged;
    evidence.compile.generation2.combined = forged;
    writeFileSync(evidencePath, `${JSON.stringify(evidence)}\n`);
    expectBlocked(() => loadScratchProject(s.scratch, tmp()), 'provenance-invalid');
  });

  it('rejects drift in reset-owned catalog and plugin authority', async () => {
    const catalogScratch = await resetToScratch(tmp());
    await sealScratchProvenance(catalogScratch.scratch, catalogScratch.project);
    const catalogPath = path.join(catalogScratch.scratch, 'catalog', 'catalog.json');
    writeFileSync(catalogPath, `${readFileSync(catalogPath, 'utf8')} `);
    expectBlocked(() => loadScratchProject(catalogScratch.scratch, tmp()), 'fixed-authority-drift');

    const pluginScratch = await resetToScratch(tmp());
    await sealScratchProvenance(pluginScratch.scratch, pluginScratch.project);
    rmSync(path.join(pluginScratch.plugins, 'catalog-panel', 'catalog-panel.js'));
    expectBlocked(() => loadScratchProject(pluginScratch.scratch, tmp()), 'fixed-authority-drift');
  });

  it('rejects every plugin payload outside the exact allowlisted plugin directories', () => {
    const input = loadCommittedPublishProject(tmp());
    expect(verifyPluginTrust(input.pluginAllowlistBytes, input.pluginFiles)).toEqual([]);
    const blocks = verifyPluginTrust(input.pluginAllowlistBytes, [
      ...input.pluginFiles,
      { rel: 'rogue/rogue.js', bytes: Buffer.from('const harmless = true;\n') },
    ]);
    expect(blocks).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'blocked-untrusted-plugin', where: 'rogue/rogue.js' }),
    ]));
  });

  it('requires an id-consistent plugin descriptor alongside each allowlisted source', () => {
    const input = loadCommittedPublishProject(tmp());
    const sourceOnly = input.pluginFiles.filter((file) => !file.rel.endsWith('/plugin.json'));
    expect(verifyPluginTrust(input.pluginAllowlistBytes, sourceOnly)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'blocked-untrusted-plugin', where: 'live-copy-preview/plugin.json' }),
    ]));
  });

  it('rejects missing, duplicate, or self-signed plugin allowlists', () => {
    const input = loadCommittedPublishProject(tmp());
    expect(verifyPluginTrust(Buffer.from('{"plugins":[]}'), [])).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'blocked-untrusted-plugin' }),
    ]));

    const parsed = JSON.parse(input.pluginAllowlistBytes.toString('utf8')) as { plugins: Array<Record<string, unknown>> };
    parsed.plugins.push({ ...parsed.plugins[0] });
    expect(verifyPluginTrust(Buffer.from(JSON.stringify(parsed)), input.pluginFiles)).toEqual(expect.arrayContaining([
      expect.objectContaining({ detail: expect.stringContaining('duplicate plugin id') }),
    ]));

    const tamperedFiles = input.pluginFiles.map((file) => file.rel === 'live-copy-preview/live-copy-preview.js'
      ? { ...file, bytes: Buffer.concat([file.bytes, Buffer.from('\nconst harmless = true;\n')]) }
      : file);
    const selfSigned = JSON.parse(input.pluginAllowlistBytes.toString('utf8')) as { plugins: Array<{ id: string; sha256: string }> };
    selfSigned.plugins.find((entry) => entry.id === 'live-copy-preview')!.sha256 = sha256(
      tamperedFiles.find((file) => file.rel === 'live-copy-preview/live-copy-preview.js')!.bytes,
    );
    expect(verifyPluginTrust(Buffer.from(JSON.stringify(selfSigned)), tamperedFiles)).toEqual(expect.arrayContaining([
      expect.objectContaining({ detail: expect.stringContaining('external trust anchor') }),
    ]));
  });

  it('rejects a scratch INSIDE the landing worktree (never publishes from the repo)', () => {
    try {
      loadScratchProject(repoPath('tools', 'phaser-shell'), tmp());
      expect.fail('expected a scratch-in-repo block');
    } catch (err) {
      expect(err).toBeInstanceOf(PathBlocked);
      expect((err as PathBlocked).code).toBe('scratch-in-repo');
    }
  });
});
