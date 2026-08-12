import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  canonicalArtifactContentJson,
  type ArtifactContentSnapshotV1,
} from '../../src/data/artifactRevisionContract';

const asset = (path: string, char: string): { path: string; sha256: string; bytes: number } => ({
  path,
  sha256: char.repeat(64),
  bytes: 12,
});

const scene = asset('color.png', 'a');
const clean = asset('bg_00.png', 'b');
const sprite = asset('dogs/dog_00/sprite_000.png', 'c');
const snapshot: ArtifactContentSnapshotV1 = {
  schemaVersion: 1,
  sessionId: 'example',
  assets: { scene, cleanBackground: clean },
  restore: { asset: clean, sourceSceneSha256: scene.sha256 },
  birds: [{
    birdId: 'bird_018f4f34-cc65-7c21-b59d-9b44c8c02a33',
    compatibilitySlot: 'dog_00',
    presentationOrder: 0,
    hitbox: { x: 10, y: 20, r: 5 },
    activeGeneration: { generationId: 'generation_1', inputSceneSha256: scene.sha256 },
    sprite: {
      asset: sprite,
      placement: { x: 5, y: 15, width: 10, height: 12 },
      anchorX: 0.5,
      anchorY: 0.5,
      flipX: false,
      flipY: false,
    },
    cleanup: { x: 4, y: 14, width: 12, height: 14, sourceSpriteSha256: sprite.sha256 },
  }],
  reviews: {},
  operational: { archived: false },
};

describe('artifact revision contract', () => {
  it('matches the Python semantic content revision fixture', () => {
    const revision = `sha256:${createHash('sha256').update(canonicalArtifactContentJson(snapshot)).digest('hex')}`;
    expect(revision).toBe('sha256:ea523da1375bd6fbcfb7edcf4ca6673a6ebaa1dc219f4067ea9ee0d660fb8c23');
  });

  it('does not bind gallery-only presentation ordering', () => {
    const changed = { ...snapshot, birds: [{ ...snapshot.birds[0], presentationOrder: 9 }] };
    expect(canonicalArtifactContentJson(changed)).toBe(canonicalArtifactContentJson(snapshot));
  });
});
