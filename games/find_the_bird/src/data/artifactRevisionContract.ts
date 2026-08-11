/** Read-only runtime shape of the authoring revision provenance contract.
 *
 * The game consumes projected packages, not authoring revisions. Keeping this
 * small mirror lets schema/parity tests prove that projection provenance has
 * the same semantic hash in Python and TypeScript without making runtime code
 * an authoring authority.
 */

export interface ArtifactAssetDescriptor {
  readonly path: string;
  readonly sha256: string;
  readonly size: number;
}

export interface ArtifactBird {
  readonly birdId: string;
  readonly compatibilitySlot: string;
  readonly hitbox: { readonly x: number; readonly y: number; readonly r: number };
  readonly sprite: {
    readonly image: ArtifactAssetDescriptor;
    readonly spriteBox: readonly [number, number, number, number];
    readonly cleanupBox: readonly [number, number, number, number];
    readonly anchorX: number;
    readonly anchorY: number;
    readonly flipX: boolean;
    readonly flipY: boolean;
  };
}

export interface ArtifactContentManifestV1 {
  readonly schemaVersion: 1;
  readonly sessionId: string;
  readonly scene: ArtifactAssetDescriptor;
  readonly restore: {
    readonly image: ArtifactAssetDescriptor;
    readonly sourceSceneSha256: string;
    readonly sourceHitboxesSha256: string;
  };
  readonly birds: readonly ArtifactBird[];
  readonly presentationOrder: readonly string[];
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

export function canonicalArtifactContentJson(manifest: ArtifactContentManifestV1): string {
  const { presentationOrder: _operationalPresentationOrder, ...content } = manifest;
  return JSON.stringify(canonicalize(content));
}
