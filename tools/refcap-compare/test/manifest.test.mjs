import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadManifest } from '../src/manifest.mjs';

const tmpDirs = [];

function writeManifest(states) {
  const gameDir = fs.mkdtempSync(path.join(os.tmpdir(), 'refcap-manifest-'));
  tmpDirs.push(gameDir);
  fs.mkdirSync(path.join(gameDir, 'refs'), { recursive: true });
  fs.writeFileSync(
    path.join(gameDir, 'refs', 'manifest.yaml'),
    [
      'game: taxonomy_test',
      'reference:',
      '  package: com.example.reference',
      'v2:',
      '  package: com.fabrikav2.taxonomy_test',
      'states:',
      ...states.flatMap((name) => [
        `  - name: ${name}`,
        '    reference:',
        '      gap: "no reference capture"',
        '    v2:',
        '      gap: "no v2 capture"',
      ]),
      '',
    ].join('\n'),
  );
  return gameDir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('manifest state taxonomy validation', () => {
  it('accepts a per-game custom state list and preserves order', () => {
    const manifest = loadManifest(writeManifest(['menu', 'gameplay', 'shop', 'tutorial']));

    expect(manifest.states.map((state) => state.name)).toEqual(['menu', 'gameplay', 'shop', 'tutorial']);
  });

  it('rejects invalid state names before capture processing', () => {
    expect(() => loadManifest(writeManifest(['menu', '"Bad Name!"']))).toThrow(
      /invalid state name "Bad Name!"/,
    );
  });

  it('still rejects duplicate state names', () => {
    expect(() => loadManifest(writeManifest(['menu', 'shop', 'shop']))).toThrow(
      /duplicate state "shop"/,
    );
  });
});
