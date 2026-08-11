import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  canonicalArtifactContentJson,
  type ArtifactContentManifestV1,
} from '../../src/data/artifactRevisionContract';

const manifest: ArtifactContentManifestV1 = {
  schemaVersion: 1,
  sessionId: 'scene-a',
  scene: { path: 'color.png', sha256: 'a'.repeat(64), size: 10 },
  restore: {
    image: { path: 'bg_00.png', sha256: 'c'.repeat(64), size: 10 },
    sourceSceneSha256: 'a'.repeat(64),
    sourceHitboxesSha256: 'd'.repeat(64),
  },
  birds: [{
    birdId: 'bird-a',
    compatibilitySlot: 'dog_00',
    hitbox: { x: 20, y: 30, r: 12 },
    sprite: {
      image: { path: 'dogs/dog_00/sprite_000.png', sha256: 'b'.repeat(64), size: 10 },
      spriteBox: [10, 20, 40, 60],
      cleanupBox: [8, 18, 42, 62],
      anchorX: 0.5,
      anchorY: 0.5,
      flipX: false,
      flipY: false,
    },
  }],
  presentationOrder: ['bird-a'],
};

describe('artifact revision contract', () => {
  it('matches the Python semantic content revision fixture', () => {
    const revision = createHash('sha256').update(canonicalArtifactContentJson(manifest)).digest('hex');
    expect(revision).toBe('1b4e99883a32371eaddcbe4ba7defadcb856b990ff515b7e4043ccb26e58d2e0');
  });

  it('does not bind gallery-only presentation ordering', () => {
    const changed = { ...manifest, presentationOrder: [] };
    expect(canonicalArtifactContentJson(changed)).toBe(canonicalArtifactContentJson(manifest));
  });
});
