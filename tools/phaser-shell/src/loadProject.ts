// Editor-free loaders for the Phaser authoring lane's CLI verbs.
//
//   loadCommittedProject()      → the committed project as an AuthoringProject for
//                                 the read-only `validate`/`preflight` verbs.
//   loadCommittedPublishProject → the committed project as a full PublishInput
//                                 (REAL generated `.ts` graph) for the publisher.
//   loadScratchProject(scratch) → a session-validated scratch (minted by `reset`,
//                                 OUTSIDE the landing worktree) as a PublishInput.
//
// The publish loaders read the WHOLE portable authoring graph — the seven `.scene`
// authority + their accepted generated `.ts`, the `Semantic` user-component
// (`.components` authority + generated `.ts`), the curated catalog, the editor
// asset-pack + its raster/font payloads + the public-root marker + editor config,
// and the allowlisted editor plugins — and FAIL CLOSED on a missing, symlinked, or
// unexpected generated-graph file (requirement 1). They never fabricate or accept
// a runtime bundle: `scenes/shell.js` is derived by the publisher from the
// generated graph they carry.
import { readFileSync, lstatSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseSceneDoc, type SceneDoc } from './authoring/sceneModel.ts';
import { parseCatalog, indexById, type Catalog, type SeedAsset } from './authoring/catalog.ts';
import { loadEditorAssets } from './authoring/editorAssets.ts';
import { STATE_IDS } from './authoring/extractV2.ts';
import type { AuthoringProject } from './publish/validate.ts';
import type { PublishInput, PluginFile, SceneInput } from './publish/publish.ts';
import { resolveScratch } from './session/paths.ts';
import { GENERATED_GRAPH, SCENE_AUTHORITY, SCENE_ORDER, combineGraphHash, type GraphHash } from './session/graph.ts';
import type { ProvenanceEvidence } from './session/evidence.ts';
import type { ShellStateIdV2 } from '@fabrikav2/kernel';

/** Repo root, three levels above this module (`tools/phaser-shell/src`). */
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const AUTHORING = path.join(REPO_ROOT, 'games', 'shell_proof_phaser', 'authoring');
const EDITOR = path.join(AUTHORING, 'phaser-editor');
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

function loadFrozenSeedAssets(): SeedAsset[] {
  const manifest = JSON.parse(readFileSync(path.join(REPO_ROOT, 'games', 'shell_proof_phaser', 'design', 'kenney-seed.manifest.json'), 'utf8')) as {
    assetCatalog?: { assets?: SeedAsset[] };
  };
  if (!Array.isArray(manifest.assetCatalog?.assets)) {
    throw new ProjectLoadBlocked('fixed-authority-missing', 'design/kenney-seed.manifest.json', 'frozen seed asset authority is missing');
  }
  return manifest.assetCatalog.assets;
}

/** A fail-closed block loading an explicit project (missing/symlink/unexpected graph). */
export class ProjectLoadBlocked extends Error {
  constructor(
    public readonly code: string,
    public readonly where: string,
    message: string,
  ) {
    super(message);
    this.name = 'ProjectLoadBlocked';
  }
}

/** Read a file that must exist and must NOT be a symlink (fail-closed). */
function readSolidFile(abs: string, where: string): Buffer {
  let stat;
  try {
    stat = lstatSync(abs);
  } catch {
    throw new ProjectLoadBlocked('missing-file', where, `required file is missing: ${where}`);
  }
  if (stat.isSymbolicLink()) {
    throw new ProjectLoadBlocked('symlink-in-graph', where, `refusing a symlinked source file: ${where}`);
  }
  if (!stat.isFile()) {
    throw new ProjectLoadBlocked('not-a-file', where, `expected a regular file: ${where}`);
  }
  return readFileSync(abs);
}

/** The exact generated-graph filenames permitted in `src/scenes` and `src/components`. */
function expectedGraphFiles(): { scenes: Set<string>; components: Set<string> } {
  const scenes = new Set<string>();
  for (const state of STATE_IDS) {
    scenes.add(`${cap(state)}.scene`);
    scenes.add(`${cap(state)}.ts`);
  }
  return { scenes, components: new Set(['Semantic.components', 'Semantic.ts']) };
}

/** Reject any unexpected entry (or symlink) in a generated-graph directory. */
function assertNoUnexpected(dir: string, allowed: Set<string>, label: string): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    throw new ProjectLoadBlocked('missing-graph-dir', label, `generated-graph directory is missing: ${label}`);
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      throw new ProjectLoadBlocked('symlink-in-graph', `${label}/${entry.name}`, `refusing a symlink in the generated graph: ${label}/${entry.name}`);
    }
    if (!allowed.has(entry.name)) {
      throw new ProjectLoadBlocked('unexpected-graph-file', `${label}/${entry.name}`, `unexpected file in the generated graph: ${label}/${entry.name}`);
    }
  }
}

/** Recursively collect non-symlink plugin files (POSIX rel paths), excluding `allowlist.json`. */
function collectPluginFiles(pluginsDir: string): PluginFile[] {
  const out: PluginFile[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) {
        throw new ProjectLoadBlocked('symlink-in-graph', `editor-plugins/${relPath}`, `refusing a symlinked plugin file: ${relPath}`);
      }
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), relPath);
      } else if (relPath !== 'allowlist.json') {
        out.push({ rel: relPath, bytes: readFileSync(path.join(dir, entry.name)) });
      }
    }
  };
  walk(pluginsDir, '');
  return out.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
}

/** Hash a declared project graph synchronously using the shared preimage
 *  (symlink-rejecting sync I/O + the canonical {@link combineGraphHash}). */
function hashGraphSync(projectDir: string, relPaths: readonly string[]): GraphHash {
  const entries: [string, Buffer][] = relPaths.map((rel) => [rel, readSolidFile(path.join(projectDir, rel), rel)]);
  return combineGraphHash(entries);
}

function sameRecord(left: Record<string, string> | null, right: Record<string, string>): boolean {
  if (!left) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => left[key] === right[key]);
}

function isGraphHash(value: GraphHash | null | undefined): value is GraphHash {
  return Boolean(
    value
    && /^sha256-[0-9a-f]{64}$/.test(value.combined)
    && value.byPath
    && typeof value.byPath === 'object',
  );
}

/** Recursively read an exact regular-file tree while rejecting every symlink. */
function solidTree(root: string, label: string): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  const walk = (dir: string, rel: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      throw new ProjectLoadBlocked('fixed-authority-missing', label, `trusted reset input is missing: ${label}`);
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      const child = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        throw new ProjectLoadBlocked('symlink-in-graph', `${label}/${childRel}`, `refusing a symlinked reset input: ${label}/${childRel}`);
      }
      if (entry.isDirectory()) walk(child, childRel);
      else if (entry.isFile()) files.set(childRel, readFileSync(child));
      else throw new ProjectLoadBlocked('not-a-file', `${label}/${childRel}`, `unexpected reset input type: ${label}/${childRel}`);
    }
  };
  walk(root, '');
  return files;
}

function assertTreeMatches(actual: string, trusted: string, label: string): void {
  const actualFiles = solidTree(actual, label);
  const trustedFiles = solidTree(trusted, `trusted-${label}`);
  if (actualFiles.size !== trustedFiles.size) {
    throw new ProjectLoadBlocked('fixed-authority-drift', label, `${label} file set differs from the reset authority`);
  }
  for (const [rel, expected] of trustedFiles) {
    const observed = actualFiles.get(rel);
    if (!observed || !observed.equals(expected)) {
      throw new ProjectLoadBlocked('fixed-authority-drift', `${label}/${rel}`, `${label}/${rel} differs from the reset authority`);
    }
  }
}

/** Scene files are editable; every other reset-owned input is pinned externally. */
function assertScratchFixedAuthority(layout: ReturnType<typeof resolveScratch>): void {
  assertTreeMatches(layout.catalog, path.join(AUTHORING, 'catalog'), 'catalog');
  assertTreeMatches(layout.plugins, path.join(AUTHORING, 'editor-plugins'), 'editor-plugins');
  assertTreeMatches(path.join(layout.project, 'public'), path.join(EDITOR, 'public'), 'public');
  for (const rel of [
    'phasereditor2d.config.json',
    'src/components/Semantic.components',
    'src/components/Semantic.ts',
  ]) {
    const observed = readSolidFile(path.join(layout.project, rel), rel);
    const expected = readSolidFile(path.join(EDITOR, rel), `trusted/${rel}`);
    if (!observed.equals(expected)) {
      throw new ProjectLoadBlocked('fixed-authority-drift', rel, `${rel} differs from the reset authority`);
    }
  }
}

/**
 * Require a successful real-Editor provenance record that seals the exact
 * authority and generated bytes currently present in the scratch. `reset`
 * alone is deliberately insufficient: publish is the promotion boundary.
 */
function assertScratchProvenance(scratch: string, projectDir: string): void {
  const evidenceDir = path.join(scratch, 'evidence');
  let entries;
  try {
    entries = readdirSync(evidenceDir, { withFileTypes: true });
  } catch {
    throw new ProjectLoadBlocked('provenance-missing', 'evidence', 'scratch has no real-Editor provenance evidence');
  }

  const authority = hashGraphSync(projectDir, SCENE_AUTHORITY);
  const generated = hashGraphSync(projectDir, GENERATED_GRAPH);
  for (const entry of entries.sort((a, b) => (a.name < b.name ? 1 : -1))) {
    if (!entry.name.startsWith('provenance-') || !entry.name.endsWith('.json')) continue;
    if (entry.isSymbolicLink() || !entry.isFile()) continue;
    let evidence: ProvenanceEvidence;
    try {
      evidence = JSON.parse(readFileSync(path.join(evidenceDir, entry.name), 'utf8')) as ProvenanceEvidence;
    } catch {
      continue;
    }
    const compile1 = evidence.compile?.generation1;
    const compile2 = evidence.compile?.generation2;
    const valid = evidence.schema === 'u5.phaser.provenance/1'
      && evidence.result === 'ok'
      && evidence.code === undefined
      && evidence.serverMode?.desktop === true
      && evidence.serverMode?.unlocked === true
      && evidence.serverModeAfterRestart?.desktop === true
      && evidence.serverModeAfterRestart?.unlocked === true
      && evidence.restart?.endpointDownProven === true
      && evidence.compile?.deterministic === true
      && isGraphHash(compile1)
      && isGraphHash(compile2)
      && compile1.combined === compile2.combined
      && compile1.combined === generated.combined
      && compile2.combined === generated.combined
      && sameRecord(compile1.byPath, generated.byPath)
      && sameRecord(compile2.byPath, generated.byPath)
      && evidence.authority?.stableAcrossRestart === true
      && evidence.generated?.stableAcrossRestart === true
      && evidence.authority.afterSaveCombined === authority.combined
      && evidence.authority.reopenCombined === authority.combined
      && evidence.generated.afterSaveCombined === generated.combined
      && evidence.generated.reopenCombined === generated.combined
      && sameRecord(evidence.authority.byPathAfterSave, authority.byPath)
      && sameRecord(evidence.generated.byPathAfterSave, generated.byPath)
      && JSON.stringify(evidence.sceneOrder) === JSON.stringify(SCENE_ORDER)
      && JSON.stringify(evidence.sceneAuthority) === JSON.stringify(SCENE_AUTHORITY)
      && JSON.stringify(evidence.generatedGraph) === JSON.stringify(GENERATED_GRAPH);
    if (valid) return;
  }
  throw new ProjectLoadBlocked(
    'provenance-invalid',
    'evidence',
    'scratch has no successful real-Editor provenance record for its current bytes',
  );
}

export interface PublishProjectDirs {
  /** The Phaser Editor project (`phaser-editor/`). */
  projectDir: string;
  /** The curated catalog directory (holds `catalog.json`). */
  catalogDir: string;
  /** The allowlisted editor plugins directory (holds `allowlist.json` + plugin sources). */
  pluginsDir: string;
  /** The `authoring/publications` root the publication is renamed into. */
  outputRoot: string;
}

/**
 * Load a full `PublishInput` from an explicit, session-validated project graph.
 * Fails closed on a missing, symlinked, or unexpected generated-graph file.
 */
export function loadPublishProject(dirs: PublishProjectDirs): PublishInput {
  const { scenes: allowedScenes, components: allowedComponents } = expectedGraphFiles();
  const scenesDir = path.join(dirs.projectDir, 'src', 'scenes');
  const componentsDir = path.join(dirs.projectDir, 'src', 'components');
  assertNoUnexpected(scenesDir, allowedScenes, 'src/scenes');
  assertNoUnexpected(componentsDir, allowedComponents, 'src/components');

  const scenes = new Map<ShellStateIdV2, SceneInput>();
  for (const state of STATE_IDS) {
    const sceneBytes = readSolidFile(path.join(scenesDir, `${cap(state)}.scene`), `src/scenes/${cap(state)}.scene`);
    const generatedSource = readSolidFile(path.join(scenesDir, `${cap(state)}.ts`), `src/scenes/${cap(state)}.ts`).toString('utf8');
    scenes.set(state, { doc: parseSceneDoc(JSON.parse(sceneBytes.toString('utf8'))) as SceneDoc, sceneBytes, generatedSource });
  }

  const userComponentDefinitionBytes = readSolidFile(path.join(componentsDir, 'Semantic.components'), 'src/components/Semantic.components');
  const userComponentsBytes = readSolidFile(path.join(componentsDir, 'Semantic.ts'), 'src/components/Semantic.ts');

  const catalogBytes = readSolidFile(path.join(dirs.catalogDir, 'catalog.json'), 'catalog/catalog.json');
  const catalog = parseCatalog(JSON.parse(catalogBytes.toString('utf8'))) as Catalog;

  const editorPackBytes = readSolidFile(path.join(dirs.projectDir, 'public', 'assets', 'asset-pack.json'), 'public/assets/asset-pack.json');
  const editorPack = JSON.parse(editorPackBytes.toString('utf8'));
  const editorAssets = loadEditorAssets(path.join(dirs.projectDir, 'public'), editorPack);

  const assetBytesById = new Map<string, Buffer>();
  for (const entry of indexById(catalog).values()) {
    const bytes = editorAssets.bytesByUrl.get(entry.path);
    if (bytes) assetBytesById.set(entry.id, bytes);
  }

  const pluginAllowlistBytes = readSolidFile(path.join(dirs.pluginsDir, 'allowlist.json'), 'editor-plugins/allowlist.json');
  const pluginFiles = collectPluginFiles(dirs.pluginsDir);

  return {
    scenes,
    catalog,
    seedAssets: loadFrozenSeedAssets(),
    editorPack,
    editorPackBytes,
    editorAssetBytesByUrl: editorAssets.bytesByUrl,
    editorAssetSymlinks: editorAssets.symlinkUrls,
    publicRootMarkerBytes: readSolidFile(path.join(dirs.projectDir, 'public', 'publicroot'), 'public/publicroot'),
    editorConfigBytes: readSolidFile(path.join(dirs.projectDir, 'phasereditor2d.config.json'), 'phasereditor2d.config.json'),
    userComponentsBytes,
    userComponentDefinitionBytes,
    catalogBytes,
    pluginAllowlistBytes,
    pluginFiles,
    assetBytesById,
    outputRoot: dirs.outputRoot,
  };
}

/** The committed `authoring/publications` root (the default publisher output). */
export const COMMITTED_PUBLICATIONS_ROOT = path.join(AUTHORING, 'publications');

/** Load the committed authoring project as a full PublishInput (real generated graph). */
export function loadCommittedPublishProject(outputRoot: string = COMMITTED_PUBLICATIONS_ROOT): PublishInput {
  return loadPublishProject({
    projectDir: EDITOR,
    catalogDir: path.join(AUTHORING, 'catalog'),
    pluginsDir: path.join(AUTHORING, 'editor-plugins'),
    outputRoot,
  });
}

/**
 * Load an explicit session-validated scratch (minted by `reset`, OUTSIDE the
 * landing worktree) as a full PublishInput. `resolveScratch` fails closed when the
 * scratch is inside the repo, missing, or incomplete.
 */
export function loadScratchProject(scratch: string | undefined, outputRoot: string): PublishInput {
  const layout = resolveScratch(scratch);
  assertScratchProvenance(layout.scratch, layout.project);
  assertScratchFixedAuthority(layout);
  return loadPublishProject({
    projectDir: layout.project,
    catalogDir: layout.catalog,
    pluginsDir: layout.plugins,
    outputRoot,
  });
}

/** Load the committed authoring project as a validatable AuthoringProject. */
export function loadCommittedProject(): AuthoringProject {
  const catalog = parseCatalog(JSON.parse(readFileSync(path.join(AUTHORING, 'catalog', 'catalog.json'), 'utf8'))) as Catalog;
  const scenes = new Map<ShellStateIdV2, SceneDoc>();
  for (const state of STATE_IDS) {
    const raw = JSON.parse(readFileSync(path.join(EDITOR, 'src', 'scenes', `${cap(state)}.scene`), 'utf8'));
    scenes.set(state, parseSceneDoc(raw));
  }
  const editorPack = JSON.parse(readFileSync(path.join(EDITOR, 'public', 'assets', 'asset-pack.json'), 'utf8'));
  const assets = loadEditorAssets(path.join(EDITOR, 'public'), editorPack);
  return {
    scenes,
    catalog,
    seedAssets: loadFrozenSeedAssets(),
    editorPack,
    editorAssetBytesByUrl: assets.bytesByUrl,
    editorAssetSymlinks: assets.symlinkUrls,
  };
}
