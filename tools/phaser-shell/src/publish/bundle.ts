// Canonical phaser-native projection bundle for the U5 publisher (KTD-G).
//
// U5 bundles the accepted generated code into the SINGLE canonical runtime
// projection candidate `scenes/shell.js` (all seven states mapped by
// `scene-manifest.json`) plus the lowercase artifacts the phaser-native profile
// already permits — runtime `asset-pack.json` (RASTER-ONLY), de-cycled
// `asset-identity.json` (sourcePublicationId + assets, NO projectionId), and
// `assets/*.png`. The layout is validated against the profile definition (S4):
// raw editor files (`.scene`/`.components`/prefab `.ts`) and fonts can never
// enter the projection. U5 does NOT mint the runtime `projectionId` — U6 does.
import { shellPresentationContractV2, parseShellAssetIdentityDocument } from '@fabrikav2/kernel';
import type { ShellPresentationDocumentV2 } from '@fabrikav2/kernel';
import { role as roleOf } from '../authoring/semantic.ts';
import { indexById, type Catalog } from '../authoring/catalog.ts';
import { sha256 } from './manifest.ts';

const contract = shellPresentationContractV2;
const profile = contract.rendererProfiles.find((p) => p.id === 'phaser-native')!;
const allowedPatterns = profile.allowedArtifactPatterns.map((p) => new RegExp(p));
const requiredArtifacts = new Set(profile.requiredArtifacts);

/** The single canonical runtime projection module all seven states map to. */
export const CANONICAL_SCENE = 'scenes/shell.js';

export interface BundleArtifact {
  path: string;
  content: Buffer;
}

export interface BundleInput {
  document: ShellPresentationDocumentV2;
  catalog: Catalog;
  /** The publication whose editor sources this bundle derives from. */
  sourcePublicationId: string;
  /** The `scenes/shell.js` bytes DERIVED from the accepted generated graph (never caller bytes). */
  runtimeSceneJs: Buffer;
  /** Raster bytes for every entry in the curated shell catalog. */
  assetBytesById: ReadonlyMap<string, Buffer>;
}

export interface BundleResult {
  artifacts: BundleArtifact[];
  /** Non-empty when the assembled layout violates the phaser-native profile. */
  layoutIssues: string[];
}

/** True when a bundle-relative path is permitted by the phaser-native profile. */
export function isAllowedArtifactPath(path: string): boolean {
  return requiredArtifacts.has(path) || allowedPatterns.some((re) => re.test(path));
}

/** Validate an assembled artifact-path set against the profile (S4 guarantee). */
export function validateBundleLayout(paths: readonly string[]): string[] {
  const issues: string[] = [];
  const present = new Set(paths);
  for (const required of requiredArtifacts) {
    if (!present.has(required)) issues.push(`missing required artifact ${required}`);
  }
  for (const path of paths) {
    if (!isAllowedArtifactPath(path)) issues.push(`artifact ${path} is not permitted by the phaser-native profile`);
  }
  if (!present.has(CANONICAL_SCENE)) issues.push(`missing canonical projection ${CANONICAL_SCENE}`);
  return issues;
}

/** Collect the (instanceId, slotId, assetId) triples that carry a raster asset. */
function assetInstances(document: ShellPresentationDocumentV2): Array<{ instanceId: string; slotId: string; assetId: string }> {
  const out: Array<{ instanceId: string; slotId: string; assetId: string }> = [];
  for (const page of document.pages) {
    for (const instance of page.instances) {
      const assetId = instance.presentation.assetId;
      if (typeof assetId !== 'string') continue;
      const slotId = roleOf(instance.roleId)?.assetSlotId;
      if (!slotId) continue;
      out.push({ instanceId: instance.id, slotId, assetId });
    }
  }
  return out;
}

/**
 * Assemble the canonical bundle. Deterministic: artifacts are emitted in a
 * stable order and every JSON is canonically serialized so two clean runs are
 * byte-identical.
 */
export function buildBundle(input: BundleInput): BundleResult {
  const catalogIndex = indexById(input.catalog);
  const used = assetInstances(input.document);
  // The projection is a reusable pre-built shell, not a tree-shaken screenshot.
  // Editor-native visual companions deliberately carry no Semantic component,
  // so their textures do not appear in `asset-identity.json`. Retain the whole
  // curated catalog in the runtime pack: every asset visible in the Editor is
  // then available to the generated scene graph without inventing a second
  // asset authority or overloading semantic carriers.
  const runtimeAssetIds = input.catalog.entries.map((entry) => entry.id).sort();

  // Runtime asset-pack.json — RASTER ONLY (no fonts, no editor keys).
  const runtimePack = {
    'shell-runtime': {
      files: runtimeAssetIds.map((assetId) => {
        const entry = catalogIndex.get(assetId)!;
        return { url: entry.path, type: 'image', key: entry.packKey };
      }),
    },
    meta: {
      app: 'Phaser Editor 2D - Asset Pack Editor',
      contentType: 'phasereditor2d.pack.core.AssetContentType',
      url: 'https://phasereditor2d.com',
      version: 2,
    },
  };

  // De-cycled asset-identity.json — sourcePublicationId + assets, NO projectionId.
  const assetIdentity = {
    contractId: contract.contractId,
    contractVersion: contract.contractVersion,
    sourcePublicationId: input.sourcePublicationId,
    assets: used
      .map((u) => {
        const entry = catalogIndex.get(u.assetId)!;
        return { instanceId: u.instanceId, slotId: u.slotId, assetId: u.assetId, path: entry.path, sha256: entry.sha256 };
      })
      .sort((a, b) => (a.instanceId < b.instanceId ? -1 : a.instanceId > b.instanceId ? 1 : 0)),
  };

  // scene-manifest.json — maps all seven states onto the single canonical module.
  const sceneManifest = {
    contractId: contract.contractId,
    contractVersion: contract.contractVersion,
    rendererProfile: 'phaser-native',
    projection: CANONICAL_SCENE,
    sourcePublicationId: input.sourcePublicationId,
    states: input.document.pages.map((p) => ({ stateId: p.stateId, editorPageId: p.editorPageId })),
  };

  const json = (value: unknown): Buffer => Buffer.from(JSON.stringify(value, null, 2) + '\n', 'utf8');
  const artifacts: BundleArtifact[] = [
    { path: CANONICAL_SCENE, content: input.runtimeSceneJs },
    { path: 'scene-manifest.json', content: json(sceneManifest) },
    { path: 'asset-pack.json', content: json(runtimePack) },
    { path: 'asset-identity.json', content: json(assetIdentity) },
  ];
  for (const assetId of runtimeAssetIds) {
    const entry = catalogIndex.get(assetId)!;
    const bytes = input.assetBytesById.get(assetId);
    if (bytes) artifacts.push({ path: entry.path, content: bytes });
  }
  artifacts.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const layoutIssues = validateBundleLayout(artifacts.map((a) => a.path));
  for (const assetId of runtimeAssetIds) {
    if (!input.assetBytesById.has(assetId)) {
      layoutIssues.push(`curated runtime asset ${assetId} has no payload bytes`);
    }
  }

  // Kernel-authority check on the de-cycled asset-identity shape (no projectionId).
  try {
    const parsed = parseShellAssetIdentityDocument(assetIdentity);
    // Byte-check the recorded raster hashes match the emitted asset bytes.
    for (const asset of parsed.assets) {
      const bytes = input.assetBytesById.get(asset.assetId);
      if (!bytes) {
        layoutIssues.push(`semantic asset ${asset.assetId} has no payload bytes`);
      } else if (sha256(bytes) !== asset.sha256) {
        layoutIssues.push(`asset ${asset.assetId} bytes do not match its recorded sha256`);
      }
    }
  } catch (error) {
    layoutIssues.push(`asset-identity rejected by kernel: ${(error as Error).message}`);
  }

  return { artifacts, layoutIssues };
}
