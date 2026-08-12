/** Read-only runtime mirror of the canonical authoring revision contract. */

export interface ArtifactAssetDescriptor {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
}

export interface ArtifactBird {
  readonly birdId: string;
  readonly compatibilitySlot: string;
  readonly presentationOrder: number;
  readonly hitbox: { readonly x: number; readonly y: number; readonly r: number };
  readonly activeGeneration: {
    readonly generationId: string;
    readonly inputSceneSha256: string;
  };
  readonly sprite: {
    readonly asset: ArtifactAssetDescriptor;
    readonly placement: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
    readonly anchorX: number;
    readonly anchorY: number;
    readonly flipX: boolean;
    readonly flipY: boolean;
  };
  readonly cleanup: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly sourceSpriteSha256: string;
  };
}

export interface ArtifactContentSnapshotV1 {
  readonly schemaVersion: 1;
  readonly sessionId: string;
  readonly assets: {
    readonly scene: ArtifactAssetDescriptor;
    readonly cleanBackground: ArtifactAssetDescriptor;
  };
  readonly restore: {
    readonly asset: ArtifactAssetDescriptor;
    readonly sourceSceneSha256: string;
  };
  readonly birds: readonly ArtifactBird[];
  readonly reviews: Readonly<Record<string, unknown>>;
  readonly operational: Readonly<Record<string, unknown>>;
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

/** Exact TypeScript projection used by Python's `_content_projection`. */
export function canonicalArtifactContentJson(snapshot: ArtifactContentSnapshotV1): string {
  const birds = snapshot.birds
    .map(({ presentationOrder: _presentationOrder, ...bird }) => bird)
    .sort((left, right) => left.birdId.localeCompare(right.birdId));
  return JSON.stringify(canonicalize({
    schemaVersion: snapshot.schemaVersion,
    sessionId: snapshot.sessionId,
    assets: snapshot.assets,
    restore: snapshot.restore,
    birds,
  }));
}
