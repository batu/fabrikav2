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
    // requires at least one dog and the HUD shows a per-level target count.
    dogs: [
      { id: 'dog_00', x: 300, y: 800, r: 50 },
      { id: 'dog_01', x: 600, y: 1300, r: 50 },
      { id: 'dog_02', x: 850, y: 1900, r: 50 },
    ],
  };
  const levelJson = Buffer.from(JSON.stringify(level));
  writeFileSync(join(dir, 'level.json'), levelJson);
  writeFileSync(join(dir, 'color.png'), PLACEHOLDER_PNG);

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
