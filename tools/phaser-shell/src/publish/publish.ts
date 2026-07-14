// Deterministic, atomic, portable publisher for the Phaser authoring lane
// (U5, KTD-G). Runs the full gate chain and emits ONE immutable publication:
//
//   authoring/publications/<publicationId>/
//     revision.json     — ShellPublishedRevisionV2 (publicationId over editor sources)
//     manifest.json     — portable manifest (non-circular preimages) over EVERY file
//     source/…          — retained portable authoring inputs: the seven .scene +
//                         their accepted generated .ts, the Semantic user-component
//                         (.components authority + generated .ts), the curated
//                         catalog.json, the allowlisted editor-plugins, the editor
//                         config, the editor asset-pack + its raster/font payloads,
//                         and the public-root marker
//     projection/…      — the SINGLE canonical projection candidate: scenes/shell.js
//                         (DERIVED from the accepted generated graph, never caller
//                         bytes) + scene-manifest.json + runtime asset-pack.json +
//                         asset-identity.json (sourcePublicationId, no projectionId)
//                         + assets/*.png
//
// `scenes/shell.js` is DERIVED from the accepted generated `.ts` graph (KTD-D);
// the publisher never accepts arbitrary runtime bytes. The `publicationId`
// authenticates the authoritative Editor sources — asset-pack, editor config, the
// seven scenes, and the `Semantic.components` user-component authority — plus the
// curated catalog (via `assetCatalogHash`); the generated module graph is bound by
// AST-fact parity and the allowlisted plugins by an id+hash + banned-API trust
// gate. All preimages are non-circular (no field feeds its own hash).
//
// The publication is assembled in a temp dir and atomically renamed into place
// (no partial writes). If a directory for the computed publicationId already
// exists but its bytes differ, publish BLOCKS rather than overwriting; identical
// bytes are a `no-op`. U5 never mints the runtime projectionId (U6 owns it).
import { mkdtemp, mkdir, writeFile, rename, rm, readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { SceneDoc } from '../authoring/sceneModel.ts';
import { extractDocument, STATE_IDS } from '../authoring/extractV2.ts';
import { verifyGeneratedModule } from '../authoring/astFacts.ts';
import { toShellAssetCatalog, type Catalog, type SeedAsset } from '../authoring/catalog.ts';
import type { ShellStateIdV2 } from '@fabrikav2/kernel';
import { validateProject } from './validate.ts';
import { buildBundle } from './bundle.ts';
import { deriveRuntimeBundle } from './deriveRuntime.ts';
import {
  sha256,
  canonicalJson,
  editorSourceHashes,
  buildPublishedRevision,
  buildPortableManifest,
  type EditorSources,
  type FileHash,
} from './manifest.ts';
import { isAllowlistedPlugin, scanPluginSource, type Block, type PluginAllowlistEntry } from './safety.ts';

/** One authored scene + its accepted (GUI-compiled) generated module source. */
export interface SceneInput {
  doc: SceneDoc;
  /** Raw `.scene` bytes (retained in the publication). */
  sceneBytes: Buffer;
  /**
   * Accepted generated `.ts` module source (AST-parity checked, retained, and the
   * sole source the canonical `scenes/shell.js` is DERIVED from).
   */
  generatedSource: string;
}

/** One allowlisted editor-plugin source file, retained under `source/editor-plugins/`. */
export interface PluginFile {
  /** Path under `editor-plugins/` (POSIX, e.g. `live-copy-preview/live-copy-preview.js`). */
  rel: string;
  bytes: Buffer;
}

/** External trust anchor for the two deliberately tiny U5 authoring plugins. */
const TRUSTED_PLUGIN_HASHES = new Map<string, string>([
  ['catalog-panel', 'sha256-b8ffffebb1a401c315c02ca27b534a59e347ef69fd43408a3b10295560641203'],
  ['live-copy-preview', 'sha256-86d273030203433f236ab65a328f033adaa2f8d64c8973ba8a21471738d315a8'],
]);
const TRUSTED_SEMANTIC_MODULE_HASH = 'sha256-3994bfbda4ee5b313f75f4c1ccd5031f02488cd57b19dfeca86aaf6e0543999b';

export interface PublishInput {
  scenes: ReadonlyMap<ShellStateIdV2, SceneInput>;
  catalog: Catalog;
  /** Frozen Kenney seed authority used to validate the curated catalog. */
  seedAssets: readonly SeedAsset[];
  editorPack: unknown;
  editorPackBytes: Buffer;
  /** Exact payload bytes resolved by the editor pack, keyed by pack URL. */
  editorAssetBytesByUrl: ReadonlyMap<string, Buffer>;
  editorAssetSymlinks: readonly string[];
  /** Zero-byte Phaser Editor marker that makes `public/` the project web root. */
  publicRootMarkerBytes: Buffer;
  editorConfigBytes: Buffer;
  /** Generated `Semantic.ts` module (retained; part of the local module graph, derives shell.js). */
  userComponentsBytes: Buffer;
  /** `Semantic.components` user-component DEFINITION authority (authenticated by the publicationId). */
  userComponentDefinitionBytes: Buffer;
  /** Raw `catalog.json` bytes (retained; authenticated via `assetCatalogHash`). */
  catalogBytes: Buffer;
  /** `editor-plugins/allowlist.json` bytes (retained; the plugin-trust authority). */
  pluginAllowlistBytes: Buffer;
  /** Allowlisted plugin source files (retained; hash-matched + banned-API scanned). */
  pluginFiles: readonly PluginFile[];
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

/**
 * Trust-gate the allowlisted editor plugins: every allowlist entry's `<id>/<id>.js`
 * source must be present, hash-match the allowlist, and reference no banned
 * network/storage/exfiltration API. Any failure is `blocked-untrusted-plugin`.
 */
export function verifyPluginTrust(allowlistBytes: Buffer, pluginFiles: readonly PluginFile[]): Block[] {
  let allowlist: PluginAllowlistEntry[];
  try {
    const parsed = JSON.parse(allowlistBytes.toString('utf8')) as { plugins?: PluginAllowlistEntry[] };
    allowlist = Array.isArray(parsed.plugins) ? parsed.plugins : [];
  } catch {
    return [{ code: 'blocked-untrusted-plugin', where: 'editor-plugins/allowlist.json', detail: 'malformed plugin allowlist' }];
  }
  const blocks: Block[] = [];
  const allowlistedIds = new Set<string>();
  for (const entry of allowlist) {
    if (allowlistedIds.has(entry.id)) {
      blocks.push({ code: 'blocked-untrusted-plugin', where: 'editor-plugins/allowlist.json', detail: `duplicate plugin id "${entry.id}"` });
    }
    allowlistedIds.add(entry.id);
    if (TRUSTED_PLUGIN_HASHES.get(entry.id) !== entry.sha256) {
      blocks.push({ code: 'blocked-untrusted-plugin', where: `editor-plugins/${entry.id}`, detail: `plugin "${entry.id}" is not on the external trust anchor` });
    }
  }
  for (const id of TRUSTED_PLUGIN_HASHES.keys()) {
    if (!allowlistedIds.has(id)) {
      blocks.push({ code: 'blocked-untrusted-plugin', where: 'editor-plugins/allowlist.json', detail: `required trusted plugin "${id}" is missing` });
    }
  }
  if (allowlistedIds.size !== TRUSTED_PLUGIN_HASHES.size) {
    blocks.push({ code: 'blocked-untrusted-plugin', where: 'editor-plugins/allowlist.json', detail: 'plugin id set differs from the trusted U5 set' });
  }
  const byRel = new Map(pluginFiles.map((file) => [file.rel, file]));
  for (const file of pluginFiles) {
    const [id, filename, ...rest] = file.rel.split('/');
    const permitted = rest.length === 0
      && allowlistedIds.has(id)
      && (filename === `${id}.js` || filename === 'plugin.json');
    if (!permitted) {
      blocks.push({
        code: 'blocked-untrusted-plugin',
        where: file.rel,
        detail: `plugin payload is not declared by the exact id allowlist: ${file.rel}`,
      });
    }
  }
  for (const entry of allowlist) {
    const rel = `${entry.id}/${entry.id}.js`;
    const file = byRel.get(rel);
    if (!file) {
      blocks.push({ code: 'blocked-untrusted-plugin', where: rel, detail: `allowlisted plugin "${entry.id}" source is missing` });
      continue;
    }
    if (!isAllowlistedPlugin(entry.id, sha256(file.bytes), allowlist)) {
      blocks.push({ code: 'blocked-untrusted-plugin', where: rel, detail: `plugin "${entry.id}" content hash is off the allowlist` });
    }
    const banned = scanPluginSource(file.bytes.toString('utf8'));
    if (banned.length > 0) {
      blocks.push({ code: 'blocked-untrusted-plugin', where: rel, detail: `plugin "${entry.id}" references banned API: ${banned.join(', ')}` });
    }
    const descriptor = byRel.get(`${entry.id}/plugin.json`);
    try {
      const parsed = descriptor ? JSON.parse(descriptor.bytes.toString('utf8')) as { id?: string; scripts?: unknown } : null;
      if (!parsed || parsed.id !== entry.id || !Array.isArray(parsed.scripts)
        || parsed.scripts.length !== 1 || parsed.scripts[0] !== `${entry.id}.js`) {
        blocks.push({ code: 'blocked-untrusted-plugin', where: `${entry.id}/plugin.json`, detail: `plugin "${entry.id}" descriptor is missing or inconsistent` });
      }
    } catch {
      blocks.push({ code: 'blocked-untrusted-plugin', where: `${entry.id}/plugin.json`, detail: `plugin "${entry.id}" descriptor is malformed` });
    }
  }
  return blocks;
}

/** Run the full gate chain and emit one immutable publication. */
export async function publish(input: PublishInput): Promise<PublishResult> {
  // 1. Validate the authoring project (kernel authority + lane block codes).
  const docScenes = new Map<ShellStateIdV2, SceneDoc>();
  for (const [state, s] of input.scenes) docScenes.set(state, s.doc);
  const validation = validateProject({
    scenes: docScenes,
    catalog: input.catalog,
    seedAssets: input.seedAssets,
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
  if (sha256(input.userComponentsBytes) !== TRUSTED_SEMANTIC_MODULE_HASH) {
    blocks.push({
      code: 'blocked-user-code',
      where: 'src/components/Semantic.ts',
      detail: 'generated Semantic module differs from the trusted component bridge',
    });
  }
  // 2b. Plugin trust: the retained editor-plugins must be on the id+hash allowlist
  //     and free of banned APIs (KTD-C, card comment 15 §10).
  blocks.push(...verifyPluginTrust(input.pluginAllowlistBytes, input.pluginFiles));
  if (blocks.length > 0) return { result: 'blocked', blocks };

  // 3. Editor-source hashes → publicationId. `user-components` hashes the
  //    `Semantic.components` DEFINITION authority (not the generated `.ts`).
  const sceneBytesConcat = Buffer.concat(
    STATE_IDS.map((state) => input.scenes.get(state)?.sceneBytes ?? Buffer.alloc(0)),
  );
  const editorSources: EditorSources = {
    assetPack: input.editorPackBytes,
    editorConfig: input.editorConfigBytes,
    scene: sceneBytesConcat,
    userComponents: input.userComponentDefinitionBytes,
  };
  const assetCatalogHash = sha256(canonicalJson(toShellAssetCatalog(input.catalog)));
  const revision = await buildPublishedRevision({
    editorSources: editorSourceHashes(editorSources),
    assetCatalogHash,
    states: [...STATE_IDS],
  });

  // 4. DERIVE the canonical scenes/shell.js from the accepted generated graph
  //    (never caller bytes), then assemble + profile-validate the bundle.
  const scenesByState = new Map<ShellStateIdV2, string>();
  for (const [state, s] of input.scenes) scenesByState.set(state, s.generatedSource);
  const runtimeSceneJs = deriveRuntimeBundle({
    scenesByState,
    semanticSource: input.userComponentsBytes.toString('utf8'),
  });
  const { document } = extractDocument(docScenes, input.catalog);
  const bundle = buildBundle({
    document,
    catalog: input.catalog,
    sourcePublicationId: revision.publicationId,
    runtimeSceneJs,
    assetBytesById: input.assetBytesById,
  });
  if (bundle.layoutIssues.length > 0) {
    return {
      result: 'blocked',
      blocks: bundle.layoutIssues.map((detail) => ({ code: 'blocked-unrepresentable' as const, where: 'bundle', detail })),
    };
  }

  // 5. Assemble the publication tree in a staging dir ON THE SAME FILESYSTEM as
  //    the destination, so the final placement is a single atomic rename. Staging
  //    in os.tmpdir() would make rename() cross a mount boundary on any host where
  //    /tmp is a separate device (tmpfs on Linux/CI, Docker) — fs.rename has no
  //    copy fallback and throws EXDEV, producing no publication at all.
  await mkdir(input.outputRoot, { recursive: true });
  const staging = await mkdtemp(path.join(input.outputRoot, '.u5-pub-'));
  const files = new Map<string, Buffer>();
  files.set('revision.json', Buffer.from(JSON.stringify(revision, null, 2) + '\n', 'utf8'));
  // Retained raw editor sources.
  for (const [state, s] of input.scenes) {
    const cap = state.charAt(0).toUpperCase() + state.slice(1);
    files.set(`source/scenes/${cap}.scene`, s.sceneBytes);
    files.set(`source/scenes/${cap}.ts`, Buffer.from(s.generatedSource, 'utf8'));
  }
  files.set('source/components/Semantic.components', input.userComponentDefinitionBytes);
  files.set('source/components/Semantic.ts', input.userComponentsBytes);
  files.set('source/catalog/catalog.json', input.catalogBytes);
  files.set('source/editor-plugins/allowlist.json', input.pluginAllowlistBytes);
  for (const plugin of [...input.pluginFiles].sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))) {
    files.set(`source/editor-plugins/${plugin.rel}`, plugin.bytes);
  }
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
