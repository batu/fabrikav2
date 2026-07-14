import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { computeShellPublicationIdV2 } from '@fabrikav2/kernel';
import { publish } from '../src/publish/publish.ts';
import { sha256, canonicalJson, computeManifestDigest, type FileHash } from '../src/publish/manifest.ts';
import { loadPublishInput } from './gen.ts';
import { repoPath } from './helpers.ts';

const tmps: string[] = [];
function tmp(): string {
  const d = mkdtempSync(path.join(os.tmpdir(), 'u5-pre-'));
  tmps.push(d);
  return d;
}
afterEach(() => {
  while (tmps.length) rmSync(tmps.pop()!, { recursive: true, force: true });
});

describe('P5 non-circular manifest preimages', () => {
  it('publicationId recomputes from the declared publication fields ALONE (independent of the manifest)', async () => {
    const r = await publish(loadPublishInput(tmp()));
    const revision = JSON.parse(readFileSync(path.join(r.dir!, 'revision.json'), 'utf8'));
    const { publicationId: _drop, ...withoutId } = revision;
    void _drop;
    const recomputed = await computeShellPublicationIdV2(withoutId);
    expect(recomputed).toBe(r.publicationId);
  });

  it('the manifest digest is over the file list ONLY (excludes publicationId + its own digest field)', async () => {
    const r = await publish(loadPublishInput(tmp()));
    const manifest = JSON.parse(readFileSync(path.join(r.dir!, 'manifest.json'), 'utf8')) as {
      publicationId: string;
      digest: string;
      files: FileHash[];
    };
    // Recompute the digest from the files alone → matches.
    expect(computeManifestDigest(manifest.files)).toBe(manifest.digest);
    // A digest that (wrongly) folds in the publicationId differs → proves non-circularity.
    const circular = sha256(canonicalJson({ publicationId: manifest.publicationId, files: manifest.files }));
    expect(circular).not.toBe(manifest.digest);
  });

  it('the manifest does not hash itself (self-exclusion)', async () => {
    const r = await publish(loadPublishInput(tmp()));
    const manifest = JSON.parse(readFileSync(path.join(r.dir!, 'manifest.json'), 'utf8')) as { files: FileHash[] };
    expect(manifest.files.some((f) => f.path === 'manifest.json')).toBe(false);
    // Every OTHER publication file is present in the manifest.
    expect(manifest.files.some((f) => f.path === 'revision.json')).toBe(true);
    expect(manifest.files.some((f) => f.path === 'projection/scenes/shell.js')).toBe(true);
  });

  it('every recorded file hash matches the on-disk bytes', async () => {
    const r = await publish(loadPublishInput(tmp()));
    const manifest = JSON.parse(readFileSync(path.join(r.dir!, 'manifest.json'), 'utf8')) as { files: FileHash[] };
    for (const file of manifest.files) {
      const bytes = readFileSync(path.join(r.dir!, file.path));
      expect(sha256(bytes)).toBe(file.sha256);
      expect(bytes.length).toBe(file.bytes);
    }
  });

  it('retains every editor raster, frozen font, and public-root marker in the portable source manifest', async () => {
    const r = await publish(loadPublishInput(tmp()));
    const manifest = JSON.parse(readFileSync(path.join(r.dir!, 'manifest.json'), 'utf8')) as { files: FileHash[] };
    const paths = new Set(manifest.files.map((file) => file.path));
    const pack = JSON.parse(readFileSync(repoPath(
      'games', 'shell_proof_phaser', 'authoring', 'phaser-editor', 'public', 'assets', 'asset-pack.json',
    ), 'utf8')) as Record<string, { files: Array<{ url: string }> }>;

    for (const file of pack['shell-authoring'].files) {
      expect(paths.has(`source/public/${file.url}`), file.url).toBe(true);
    }
    expect(paths.has('source/public/publicroot')).toBe(true);
  });

  it('ships the whole curated shell catalog in the runtime projection', async () => {
    const r = await publish(loadPublishInput(tmp()));
    const manifest = JSON.parse(readFileSync(path.join(r.dir!, 'manifest.json'), 'utf8')) as { files: FileHash[] };
    const manifestPaths = new Set(manifest.files.map((file) => file.path));
    const runtimePack = JSON.parse(readFileSync(
      path.join(r.dir!, 'projection', 'asset-pack.json'),
      'utf8',
    )) as Record<string, { files: Array<{ key: string; url: string; type: string }> }>;
    const catalog = JSON.parse(readFileSync(repoPath(
      'games', 'shell_proof_phaser', 'authoring', 'catalog', 'catalog.json',
    ), 'utf8')) as { entries: Array<{ id: string; packKey: string; path: string }> };

    expect(runtimePack['shell-runtime'].files).toEqual(
      [...catalog.entries]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((entry) => ({ url: entry.path, type: 'image', key: entry.packKey })),
    );
    for (const entry of catalog.entries) {
      expect(manifestPaths.has(`projection/${entry.path}`), entry.path).toBe(true);
    }
  });

  it('hashes every portable authoring input — Semantic.components, catalog, plugins, module graph', async () => {
    const r = await publish(loadPublishInput(tmp()));
    const manifest = JSON.parse(readFileSync(path.join(r.dir!, 'manifest.json'), 'utf8')) as { files: FileHash[] };
    const paths = new Set(manifest.files.map((file) => file.path));
    for (const p of [
      'source/components/Semantic.components', // user-component authority
      'source/components/Semantic.ts', // generated module graph
      'source/catalog/catalog.json', // curated R9 catalog
      'source/editor-plugins/allowlist.json', // plugin trust authority
      'source/editor-plugins/live-copy-preview/live-copy-preview.js', // allowlisted plugin
    ]) {
      expect(paths.has(p), p).toBe(true);
    }
  });
});
