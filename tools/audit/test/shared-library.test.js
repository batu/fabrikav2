import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { lintStructure } from '../src/structure.js';
import { lintHarness } from '../src/harness.js';

it('excludes the shared rendering library without exempting a harnessless game', () => {
  const root = mkdtempSync(join(tmpdir(), 'audit-shared-'));
  try {
    for (const name of ['shared', 'new_game']) {
      const dir = join(root, 'games', name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'CanvasTextureRegion.ts'), 'export const region = {};');
    }
    expect(lintStructure(root).violations.map((v) => v.game)).toEqual(['games/new_game']);
    expect(lintHarness(root).violations.map((v) => v.game)).toEqual(['games/new_game']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
