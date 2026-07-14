// Portable-project manifest + published-revision identity for the U5 publisher
// (KTD-G). The publication is authenticated by TWO non-circular hashes:
//
//   publicationId  — sha256 over the contract-declared `publicationIdFields`
//                    ONLY (contractId, contractVersion, rendererProfile,
//                    editorSources, assetCatalogHash, pageCount, states). It
//                    authenticates the AUTHORITATIVE EDITOR SOURCES. It does NOT
//                    depend on the manifest, the canonical bundle, or itself.
//   manifest.digest — sha256 over the sorted per-file hash list ONLY. It does
//                    NOT include the `digest` field, the `publicationId` field,
//                    or the manifest file's own bytes. So neither hash feeds the
//                    other: the preimages are non-circular (card comment 15 §5).
//
// U5 never mints the runtime `projectionId` — U6 computes it over
// `sourcePublicationId` + the de-cycled artifacts when it places the projection.
import { createHash } from 'node:crypto';
import { computeShellPublicationIdV2 } from '@fabrikav2/kernel';
import type { ShellEditorSourceHash, ShellPublishedRevisionV2, ShellStateIdV2 } from '@fabrikav2/kernel';

/** `sha256-<hex>` over a buffer (the contract's raster hash format). */
export function sha256(buf: Buffer | string): string {
  return `sha256-${createHash('sha256').update(buf).digest('hex')}`;
}

/** A deterministic canonical JSON serialization (sorted keys) for hashing. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** One file in the portable manifest: its publication-relative path + hash + size. */
export interface FileHash {
  path: string;
  sha256: string;
  bytes: number;
}

export interface PortableManifest {
  publicationId: string;
  contractId: string;
  contractVersion: string;
  rendererProfile: string;
  /** sha256 over the sorted `files` list only (non-circular). */
  digest: string;
  files: FileHash[];
}

/** The editor-source categories the phaser-native profile authenticates. */
export interface EditorSources {
  /** Bytes of the editor `asset-pack.json`. */
  assetPack: Buffer;
  /** Bytes of `phasereditor2d.config.json`. */
  editorConfig: Buffer;
  /** Concatenated canonical bytes of the seven `.scene` files (state-ordered). */
  scene: Buffer;
  /** Bytes of the `Semantic.components` user-component DEFINITION authority. */
  userComponents: Buffer;
}

/** Build the four `ShellEditorSourceHash` entries in profile `editorSourceKinds` order. */
export function editorSourceHashes(sources: EditorSources): ShellEditorSourceHash[] {
  return [
    { kind: 'asset-pack', sha256: sha256(sources.assetPack) },
    { kind: 'editor-config', sha256: sha256(sources.editorConfig) },
    { kind: 'scene', sha256: sha256(sources.scene) },
    { kind: 'user-components', sha256: sha256(sources.userComponents) },
  ];
}

export interface RevisionInput {
  editorSources: ShellEditorSourceHash[];
  assetCatalogHash: string;
  states: ShellStateIdV2[];
}

/**
 * Compute the immutable `ShellPublishedRevisionV2` (with its `publicationId`)
 * over the authoritative editor sources. `pageCount` is fixed at 7.
 */
export async function buildPublishedRevision(
  input: RevisionInput,
): Promise<ShellPublishedRevisionV2> {
  const base: Omit<ShellPublishedRevisionV2, 'publicationId'> = {
    contractId: 'shell-presentation-v2',
    contractVersion: '2.0.0',
    rendererProfile: 'phaser-native',
    editorSources: input.editorSources,
    assetCatalogHash: input.assetCatalogHash,
    pageCount: 7,
    states: input.states,
  };
  const publicationId = await computeShellPublicationIdV2(base);
  return { ...base, publicationId };
}

/** Compute the manifest digest over the sorted file list (excludes digest/publicationId). */
export function computeManifestDigest(files: FileHash[]): string {
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return sha256(canonicalJson(sorted.map((f) => ({ path: f.path, sha256: f.sha256, bytes: f.bytes }))));
}

/**
 * Build the portable manifest. `files` must NOT include the manifest file itself
 * (self-exclusion) — the digest is over the other files only, and the
 * `publicationId` is passed in already computed from the editor sources.
 */
export function buildPortableManifest(
  publicationId: string,
  rendererProfile: string,
  files: FileHash[],
): PortableManifest {
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return {
    publicationId,
    contractId: 'shell-presentation-v2',
    contractVersion: '2.0.0',
    rendererProfile,
    digest: computeManifestDigest(sorted),
    files: sorted,
  };
}
