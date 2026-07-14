// Typed, fail-closed validation gate for the Phaser authoring lane (U5, KTD-F).
//
// `validate` runs TWO authorities and returns named block codes with ZERO writes:
//   1. the frozen kernel v2 contract — extract the scene set into a
//      `ShellPresentationDocumentV2` and run `parseShellPresentationV2`, mapping
//      kernel `ShellValidationIssue`s onto lane block codes (semantic drift,
//      unsafe copy, unknown asset, invalid geometry, missing required instance);
//   2. the lane scene-carrier surface the kernel cannot see post-extraction —
//      missing/duplicate `fabSemanticId`, unknown texture / non-curated catalog
//      id, active/remote content in raw scene props, editor-only guide leaks,
//      hidden required actions, unsafe asset-pack paths, and unsafe string
//      encoding.
// A blocked result performs no writes; the caller's prior outputs are untouched.
import { shellPresentationContractV2, parseShellPresentationV2, ShellContractValidationError } from '@fabrikav2/kernel';
import type { ShellStateIdV2 } from '@fabrikav2/kernel';
import type { SceneDoc, SemanticObject } from '../authoring/sceneModel.ts';
import { findDuplicateSemanticIds } from '../authoring/sceneModel.ts';
import { BINDING_IDS, prototype } from '../authoring/semantic.ts';
import { extractDocument } from '../authoring/extractV2.ts';
import { toShellAssetCatalog, indexById, validateCatalog, validateEditorAssetBytes } from '../authoring/catalog.ts';
import type { Catalog, SeedAsset } from '../authoring/catalog.ts';
import {
  isActiveContent,
  isRemoteContent,
  isUnsafeStringEncoding,
  isUnsafeAssetPath,
  isGuideObject,
  type Block,
  type BlockCode,
} from './safety.ts';

const contract = shellPresentationContractV2;

export interface AuthoringProject {
  scenes: ReadonlyMap<ShellStateIdV2, SceneDoc>;
  catalog: Catalog;
  /** Frozen seed manifest entries: external byte/metadata authority for catalog validation. */
  seedAssets: readonly SeedAsset[];
  /** Raw editor `asset-pack.json`. */
  editorPack: unknown;
  /** Bytes resolved beneath the Editor project's public root, keyed by pack URL. */
  editorAssetBytesByUrl: ReadonlyMap<string, Buffer>;
  /** Declared pack URLs that resolve to symlinks instead of regular files. */
  editorAssetSymlinks: readonly string[];
}

export interface ValidationResult {
  result: 'ok' | 'blocked';
  blocks: Block[];
}

/** Map a residual kernel validation issue code onto a lane block code. */
function mapKernelIssue(code: string): BlockCode {
  switch (code) {
    case 'unsafe-copy':
      return 'blocked-active-content';
    case 'unknown-asset':
    case 'unsafe-asset':
      return 'blocked-invalid-catalog-id';
    case 'invalid-geometry':
    case 'duplicate-order':
      return 'blocked-unsafe-geometry';
    case 'missing-instance':
      return 'blocked-missing-required-action';
    default:
      return 'blocked-unrepresentable';
  }
}

/** Collect the editor-pack image keys (for texture validation). */
function editorImageKeys(pack: unknown): Set<string> {
  const keys = new Set<string>();
  if (pack === null || typeof pack !== 'object') return keys;
  for (const [section, value] of Object.entries(pack as Record<string, unknown>)) {
    if (section === 'meta' || value === null || typeof value !== 'object') continue;
    const files = (value as Record<string, unknown>)['files'];
    if (!Array.isArray(files)) continue;
    for (const file of files as Array<Record<string, unknown>>) {
      if (file['type'] === 'image' && typeof file['key'] === 'string') keys.add(file['key']);
    }
  }
  return keys;
}

/** Every raw string value on a scene object (own enumerable properties). */
function* stringValues(obj: Record<string, unknown>): Generator<{ field: string; value: string }> {
  for (const [field, value] of Object.entries(obj)) {
    if (typeof value === 'string') yield { field, value };
  }
}

function* rawObjects(list: unknown): Generator<Record<string, unknown>> {
  if (!Array.isArray(list)) return;
  for (const value of list) {
    if (!value || typeof value !== 'object') continue;
    const object = value as Record<string, unknown>;
    yield object;
    yield* rawObjects(object['list']);
  }
}

/** Non-semantic visual companions are render authority too: validate every texture. */
function checkAllSceneTextures(
  scene: SceneDoc,
  imageKeys: ReadonlySet<string>,
  packKeyToId: ReadonlyMap<string, string>,
  blocks: Block[],
): void {
  for (const object of rawObjects(scene.raw['displayList'])) {
    const type = typeof object['type'] === 'string' ? object['type'] : 'object';
    const label = typeof object['label'] === 'string' ? object['label'] : String(object['id'] ?? type);
    const texture = object['texture'];
    const key = texture && typeof texture === 'object'
      ? (texture as Record<string, unknown>)['key']
      : undefined;
    if (['Image', 'Sprite', 'NineSlice'].includes(type) && typeof key !== 'string') {
      blocks.push({ code: 'blocked-unknown-texture', where: `${scene.sceneKey}:${label}`, detail: 'rendered image has no texture key' });
      continue;
    }
    if (typeof key !== 'string') continue;
    if (!imageKeys.has(key)) {
      blocks.push({ code: 'blocked-unknown-texture', where: `${scene.sceneKey}:${label}`, detail: `texture "${key}" not in editor pack` });
    } else if (!packKeyToId.has(key)) {
      blocks.push({ code: 'blocked-invalid-catalog-id', where: `${scene.sceneKey}:${label}`, detail: `texture "${key}" is not a curated catalog asset` });
    }
  }
}

function checkSceneObject(
  scene: SceneDoc,
  obj: SemanticObject,
  imageKeys: Set<string>,
  packKeyToId: Map<string, string>,
  blocks: Block[],
): void {
  const where = `${scene.sceneKey}:${obj.label}`;
  const id = obj.carrier.fabSemanticId;

  if (isGuideObject(obj.raw)) {
    blocks.push({ code: 'blocked-guide-leak', where, detail: 'editor-only guide carries a Semantic component' });
    return;
  }
  if (!id) {
    blocks.push({ code: 'blocked-missing-semantic-id', where, detail: 'object has the Semantic component but no fabSemanticId' });
    return;
  }
  const proto = prototype(id);
  if (!proto || proto.stateId !== scene.sceneKey.toLowerCase()) {
    blocks.push({ code: 'blocked-unrepresentable', where, detail: `carrier "${id}" is not a ${scene.sceneKey} prototype` });
  }
  if (obj.carrier.fabBinding && !BINDING_IDS.has(obj.carrier.fabBinding)) {
    blocks.push({ code: 'blocked-invalid-binding', where, detail: `unknown binding "${obj.carrier.fabBinding}"` });
  }
  // Active / remote content anywhere in the raw object's string properties.
  for (const { field, value } of stringValues(obj.raw)) {
    if (isActiveContent(value)) {
      blocks.push({ code: 'blocked-active-content', where, detail: `active content in "${field}"` });
    } else if (isRemoteContent(value)) {
      blocks.push({ code: 'blocked-remote-content', where, detail: `remote/data content in "${field}"` });
    } else if (field.startsWith('Semantic.') && isUnsafeStringEncoding(value)) {
      blocks.push({ code: 'blocked-unsafe-string-encoding', where, detail: `unsafe encoding in "${field}"` });
    }
  }
  // Texture / catalog resolution.
  if (obj.textureKey) {
    if (!imageKeys.has(obj.textureKey)) {
      blocks.push({ code: 'blocked-unknown-texture', where, detail: `texture "${obj.textureKey}" not in editor pack` });
    } else if (!packKeyToId.has(obj.textureKey)) {
      blocks.push({ code: 'blocked-invalid-catalog-id', where, detail: `texture "${obj.textureKey}" is not a curated catalog asset` });
    }
  }
}

/** Validate an authoring project, returning `ok` or a typed set of blocks. */
export function validateProject(project: AuthoringProject): ValidationResult {
  const blocks: Block[] = [];
  const imageKeys = editorImageKeys(project.editorPack);
  const packKeyToId = new Map(
    [...indexById(project.catalog).values()].map((e) => [e.packKey, e.id]),
  );

  for (const issue of validateCatalog(project.catalog, project.seedAssets)) {
    blocks.push({
      code: 'blocked-invalid-catalog-id',
      where: `catalog:${issue.entry}`,
      detail: `${issue.code}: ${issue.detail}`,
    });
  }

  for (const issue of validateEditorAssetBytes(
    project.editorPack,
    project.catalog,
    project.editorAssetBytesByUrl,
  )) {
    blocks.push({
      code: 'blocked-invalid-catalog-id',
      where: `asset-pack:${issue.entry}`,
      detail: `${issue.code}: ${issue.detail}`,
    });
  }
  for (const url of project.editorAssetSymlinks) {
    blocks.push({ code: 'blocked-symlink', where: `asset-pack:${url}`, detail: 'asset payload is a symlink' });
  }

  // 1. Editor asset-pack path safety.
  if (project.editorPack && typeof project.editorPack === 'object') {
    for (const [section, value] of Object.entries(project.editorPack as Record<string, unknown>)) {
      if (section === 'meta' || value === null || typeof value !== 'object') continue;
      const files = (value as Record<string, unknown>)['files'];
      if (!Array.isArray(files)) continue;
      for (const file of files as Array<Record<string, unknown>>) {
        const url = file['url'];
        if (typeof url === 'string' && isUnsafeAssetPath(url)) {
          blocks.push({ code: 'blocked-unsafe-asset-path', where: `asset-pack:${section}`, detail: url });
        }
      }
    }
  }

  // 2. Per-scene carrier surface + duplicate detection.
  for (const scene of project.scenes.values()) {
    checkAllSceneTextures(scene, imageKeys, packKeyToId, blocks);
    for (const obj of scene.objects) {
      checkSceneObject(scene, obj, imageKeys, packKeyToId, blocks);
    }
    for (const dupId of findDuplicateSemanticIds(scene)) {
      blocks.push({ code: 'blocked-duplicate-semantic-id', where: `${scene.sceneKey}:${dupId}`, detail: 'cloned fabSemanticId not retargeted' });
    }
  }

  // 3. Required actions must be present and visible in their scene.
  const visibleByState = new Map<ShellStateIdV2, Set<string>>();
  for (const [state, scene] of project.scenes) {
    const set = new Set<string>();
    for (const obj of scene.objects) {
      if (obj.visible && obj.carrier.fabSemanticId) set.add(obj.carrier.fabSemanticId);
    }
    visibleByState.set(state, set);
  }
  for (const action of contract.requiredActions) {
    const visible = visibleByState.get(action.stateId) ?? new Set<string>();
    const satisfied = action.instanceIds.filter((instanceId) => visible.has(instanceId)).length;
    if (satisfied < action.minimumCount) {
      blocks.push({
        code: 'blocked-missing-required-action',
        where: `${action.stateId}:${action.id}`,
        detail: `required action satisfied by ${satisfied} of ${action.minimumCount} visible instances`,
      });
    }
  }

  // 4. Kernel authority backstop (semantic drift / geometry / copy / asset).
  const extraction = extractDocument(project.scenes, project.catalog);
  for (const issue of extraction.issues) {
    blocks.push({ code: 'blocked-unrepresentable', where: `${issue.scene}:${issue.object}`, detail: issue.detail });
  }
  try {
    parseShellPresentationV2(extraction.document, { assetCatalog: toShellAssetCatalog(project.catalog) });
  } catch (error) {
    if (error instanceof ShellContractValidationError) {
      for (const issue of error.issues) {
        blocks.push({ code: mapKernelIssue(issue.code), where: issue.path, detail: issue.message });
      }
    } else {
      throw error;
    }
  }

  return { result: blocks.length > 0 ? 'blocked' : 'ok', blocks };
}
