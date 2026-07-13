// Deterministic, atomic, portable publisher for the Phaser authoring lane
// (U5, KTD-G). Runs the full gate chain and emits ONE immutable publication:
//
//   authoring/publications/<publicationId>/
//     revision.json     — ShellPublishedRevisionV2 (publicationId over editor sources)
//     manifest.json     — portable manifest (non-circular preimages)
//     source/…          — retained raw editor sources (.scene + generated .ts +
//                         Semantic component + editor config + editor asset-pack)
//     projection/…      — the SINGLE canonical projection candidate: scenes/shell.js
//                         + scene-manifest.json + runtime asset-pack.json +
//                         asset-identity.json (sourcePublicationId, no projectionId)
//                         + assets/*.png
//
// The publication is assembled in a temp dir and atomically renamed into place
// (no partial writes). If a directory for the computed publicationId already
// exists but its bytes differ, publish BLOCKS rather than overwriting; identical
// bytes are a `no-op`. U5 never mints the runtime projectionId (U6 owns it).
import { mkdtemp, mkdir, writeFile, rename, rm, readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SceneDoc } from '../authoring/sceneModel.ts';
import { extractDocument, STATE_IDS } from '../authoring/extractV2.ts';
import { verifyGeneratedModule } from '../authoring/astFacts.ts';
import { toShellAssetCatalog, type Catalog } from '../authoring/catalog.ts';
import type { ShellStateIdV2 } from '@fabrikav2/kernel';
import { validateProject } from './validate.ts';
import { buildBundle } from './bundle.ts';
import {
  sha256,
  canonicalJson,
  editorSourceHashes,
  buildPublishedRevision,
  buildPortableManifest,
  type EditorSources,
  type FileHash,
} from './manifest.ts';
import type { Block } from './safety.ts';

/** One authored scene + its accepted (GUI-compiled) generated module source. */
export interface SceneInput {
  doc: SceneDoc;
  /** Raw `.scene` bytes (retained in the publication). */
  sceneBytes: Buffer;
  /** Accepted generated `.ts` module source (AST-parity checked, retained). */
  generatedSource: string;
}

export interface PublishInput {
  scenes: ReadonlyMap<ShellStateIdV2, SceneInput>;
  catalog: Catalog;
  editorPack: unknown;
  editorPackBytes: Buffer;
  /** Exact payload bytes resolved by the editor pack, keyed by pack URL. */
  editorAssetBytesByUrl: ReadonlyMap<string, Buffer>;
  editorAssetSymlinks: readonly string[];
  /** Zero-byte Phaser Editor marker that makes `public/` the project web root. */
  publicRootMarkerBytes: Buffer;
  editorConfigBytes: Buffer;
  userComponentsBytes: Buffer;
  /** The accepted generated `scenes/shell.js` runtime bundle (GUI-compiled). */
  runtimeSceneJs: Buffer;
  assetBytesById: ReadonlyMap<string, Buffer>;
  /** `authoring/publications` directory the publication is renamed into. */
  outputRoot: string;
}

export interface PublishResult {
  result: 'ok' | 'no-op' | 'blocked';
  publicationId?: string;
  dir?: string;
  blocks?: Block[];
}

/** Recursively hash every file under `dir`, returning publication-relative FileHashes. */
async function hashTree(dir: string, rel = ''): Promise<FileHash[]> {
  const out: FileHash[] = [];
  for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const abs = path.join(dir, entry.name);
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await hashTree(abs, relPath)));
    else {
      const bytes = await readFile(abs);
      out.push({ path: relPath, sha256: sha256(bytes), bytes: bytes.length });
    }
  }
  return out;
}

/** Compare two directory trees byte-for-byte. */
async function treesEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([hashTree(a), hashTree(b)]);
  if (ha.length !== hb.length) return false;
  const mb = new Map(hb.map((f) => [f.path, f.sha256]));
  return ha.every((f) => mb.get(f.path) === f.sha256);
}

/** Run the full gate chain and emit one immutable publication. */
export async function publish(input: PublishInput): Promise<PublishResult> {
  // 1. Validate the authoring project (kernel authority + lane block codes).
  const docScenes = new Map<ShellStateIdV2, SceneDoc>();
  for (const [state, s] of input.scenes) docScenes.set(state, s.doc);
  const validation = validateProject({
    scenes: docScenes,
    catalog: input.catalog,
    editorPack: input.editorPack,
    editorAssetBytesByUrl: input.editorAssetBytesByUrl,
    editorAssetSymlinks: input.editorAssetSymlinks,
  });
  if (validation.result === 'blocked') return { result: 'blocked', blocks: validation.blocks };
  const blocks: Block[] = [];

  // 2. AST-fact parity: every accepted generated module must match its scene.
  for (const [, s] of input.scenes) {
    blocks.push(...verifyGeneratedModule(s.generatedSource, s.doc));
  }
  if (blocks.length > 0) return { result: 'blocked', blocks };

  // 3. Editor-source hashes → publicationId.
  const sceneBytesConcat = Buffer.concat(
    STATE_IDS.map((state) => input.scenes.get(state)?.sceneBytes ?? Buffer.alloc(0)),
  );
  const editorSources: EditorSources = {
    assetPack: input.editorPackBytes,
    editorConfig: input.editorConfigBytes,
    scene: sceneBytesConcat,
    userComponents: input.userComponentsBytes,
  };
  const assetCatalogHash = sha256(canonicalJson(toShellAssetCatalog(input.catalog)));
  const revision = await buildPublishedRevision({
    editorSources: editorSourceHashes(editorSources),
    assetCatalogHash,
    states: [...STATE_IDS],
  });

  // 4. Canonical bundle (single scenes/shell.js) + profile-layout validation.
  const { document } = extractDocument(docScenes, input.catalog);
  const bundle = buildBundle({
    document,
    catalog: input.catalog,
    sourcePublicationId: revision.publicationId,
    runtimeSceneJs: input.runtimeSceneJs,
    assetBytesById: input.assetBytesById,
  });
  if (bundle.layoutIssues.length > 0) {
    return {
      result: 'blocked',
      blocks: bundle.layoutIssues.map((detail) => ({ code: 'blocked-unrepresentable' as const, where: 'bundle', detail })),
    };
  }

  // 5. Assemble the publication tree in a temp dir.
  const staging = await mkdtemp(path.join(os.tmpdir(), 'u5-pub-'));
  const files = new Map<string, Buffer>();
  files.set('revision.json', Buffer.from(JSON.stringify(revision, null, 2) + '\n', 'utf8'));
  // Retained raw editor sources.
  for (const [state, s] of input.scenes) {
    const cap = state.charAt(0).toUpperCase() + state.slice(1);
    files.set(`source/scenes/${cap}.scene`, s.sceneBytes);
    files.set(`source/scenes/${cap}.ts`, Buffer.from(s.generatedSource, 'utf8'));
  }
  files.set('source/components/Semantic.ts', input.userComponentsBytes);
  files.set('source/phasereditor2d.config.json', input.editorConfigBytes);
  files.set('source/public/assets/asset-pack.json', input.editorPackBytes);
  for (const [url, bytes] of [...input.editorAssetBytesByUrl].sort(([a], [b]) => (a < b ? -1 : 1))) {
    files.set(`source/public/${url}`, bytes);
  }
  files.set('source/public/publicroot', input.publicRootMarkerBytes);
  // Canonical projection candidate.
  for (const artifact of bundle.artifacts) files.set(`projection/${artifact.path}`, artifact.content);

  // Portable manifest over every file EXCEPT the manifest itself.
  const fileHashes: FileHash[] = [...files.entries()].map(([p, content]) => ({
    path: p,
    sha256: sha256(content),
    bytes: content.length,
  }));
  const manifest = buildPortableManifest(revision.publicationId, 'phaser-native', fileHashes);
  files.set('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8'));

  try {
    for (const [rel, content] of files) {
      const abs = path.join(staging, rel);
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, content);
    }

    // 6. Atomic placement with collision detection.
    const finalDir = path.join(input.outputRoot, revision.publicationId);
    if (existsSync(finalDir)) {
      const identical = await treesEqual(staging, finalDir);
      await rm(staging, { recursive: true, force: true });
      if (identical) return { result: 'no-op', publicationId: revision.publicationId, dir: finalDir };
      return {
        result: 'blocked',
        publicationId: revision.publicationId,
        blocks: [{ code: 'blocked-publication-mismatch', where: finalDir, detail: 'existing publication bytes differ' }],
      };
    }
    await mkdir(input.outputRoot, { recursive: true });
    await rename(staging, finalDir);
    return { result: 'ok', publicationId: revision.publicationId, dir: finalDir };
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

/** Read a publication's committed manifest, if present. */
export async function readPublicationManifest(dir: string): Promise<unknown | null> {
  const manifestPath = path.join(dir, 'manifest.json');
  if (!existsSync(manifestPath)) return null;
  return JSON.parse(await readFile(manifestPath, 'utf8'));
}

/** True when `dir` exists and is a directory. */
export async function isPublicationDir(dir: string): Promise<boolean> {
  try {
    return (await stat(dir)).isDirectory() && existsSync(path.join(dir, 'manifest.json'));
  } catch {
    return false;
  }
}
