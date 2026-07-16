// Generates the shell template's synthetic bundled level set.
//
// The stub game scene never renders level content, but the shell's
// progression machinery (saga map, level loader, next-level flow, manifests)
// is real and data-driven. This script emits N dummy level packages in the
// exact shape the find_the_dog-derived loader expects: per-level level.json +
// color.png (a 1x1 placeholder), plus bundled-manifest.json and
// levels-index.json with real sha256 hashes and sizes.
//
// Run from the repo root:
//   node tools/create-game/src/gen-stub-levels.mjs [game-dir] [count]
// Defaults: games/shell_template, 20 levels.
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';

const LEVEL_COUNT = Number(process.argv[3] ?? 20);
const WIDTH = 1170;
const HEIGHT = 2532;

const root = resolve(process.argv[2] ?? 'games/shell_template');
const levelsDir = join(root, 'public', 'levels');

// 1x1 opaque beige PNG.
const PLACEHOLDER_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIA' +
  'X8jx0gAAAABJRU5ErkJggg==',
  'base64',
);

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

// Full dog contract: hitbox + sprite crop + cleanup footprint containing it.
const makeDog = (id, x, y, levelId) => ({
  id,
  x,
  y,
  r: 50,
  sprite: {
    image: `levels/${levelId}/dogs/${id}/sprite_000.png`,
    x: x - 60,
    y: y - 60,
    width: 120,
    height: 120,
    anchorX: 0.5,
    anchorY: 0.5,
    cleanup: { x: x - 70, y: y - 70, width: 140, height: 140 },
  },
});

const levelIds = Array.from({ length: LEVEL_COUNT }, (_, i) =>
  `stub_level_${String(i + 1).padStart(2, '0')}`,
);

rmSync(levelsDir, { recursive: true, force: true });

const manifestLevels = [];
const indexEntries = [];

for (const id of levelIds) {
  const dir = join(levelsDir, id);
  mkdirSync(dir, { recursive: true });

  const level = {
    id,
    name: `Level ${id} (shell_template stub)`,
    width: WIDTH,
    height: HEIGHT,
    colorImage: `levels/${id}/color.png`,
    // The stub never hit-tests these; they exist because the level contract
    // requires at least one dog with full sprite metadata and the HUD shows a
    // per-level target count.
    dogs: [
      makeDog('dog_00', 300, 800, id),
      makeDog('dog_01', 600, 1300, id),
      makeDog('dog_02', 850, 1900, id),
    ],
  };
  const levelJson = Buffer.from(JSON.stringify(level));
  writeFileSync(join(dir, 'level.json'), levelJson);
  writeFileSync(join(dir, 'color.png'), PLACEHOLDER_PNG);
  writeFileSync(join(dir, 'bg_00.png'), PLACEHOLDER_PNG);
  for (const dog of level.dogs) {
    const spriteDir = join(dir, 'dogs', dog.id);
    mkdirSync(spriteDir, { recursive: true });
    writeFileSync(join(spriteDir, 'sprite_000.png'), PLACEHOLDER_PNG);
  }

  manifestLevels.push({
    id,
    name: level.name,
    width: WIDTH,
    height: HEIGHT,
    cohort_buckets: ['all'],
    bundled: true,
    assets: {
      levelJson: {
        hash: sha256(levelJson),
        size: levelJson.length,
        path: `levels/${id}/level.json`,
      },
      colorImage: {
        hash: sha256(PLACEHOLDER_PNG),
        size: PLACEHOLDER_PNG.length,
        path: `levels/${id}/color.png`,
      },
      // The runtime loader requires >=1 bg image per level (restoration
      // layering); the stub ships the same placeholder pixel.
      bgImages: [
        {
          hash: sha256(PLACEHOLDER_PNG),
          size: PLACEHOLDER_PNG.length,
          path: `levels/${id}/bg_00.png`,
        },
      ],
      dogSprites: level.dogs.map((dog) => ({
        hash: sha256(PLACEHOLDER_PNG),
        size: PLACEHOLDER_PNG.length,
        path: `levels/${id}/dogs/${dog.id}/sprite_000.png`,
      })),
    },
  });
  indexEntries.push({
    id,
    name: level.name,
    jsonPath: `levels/${id}/level.json`,
  });
}

const manifest = {
  version: 1,
  manifestRevision: 1,
  generatedAt: new Date().toISOString(),
  experimentId: 'shell_template_stub_v1',
  levels: manifestLevels,
};

writeFileSync(join(levelsDir, 'bundled-manifest.json'), JSON.stringify(manifest, null, 2));
writeFileSync(join(levelsDir, 'levels-index.json'), JSON.stringify(indexEntries, null, 2));

console.log(`Wrote ${LEVEL_COUNT} stub levels to ${levelsDir}`);
