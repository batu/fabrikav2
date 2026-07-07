import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { lintAssetIdentity } from '../src/asset-identity.js';
import { encodePng } from '../../refcap-compare/src/png.mjs';

const roots = [];

afterEach(() => {
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

function root() {
  const dir = mkdtempSync(join(tmpdir(), 'asset-identity-'));
  roots.push(dir);
  mkdirSync(join(dir, 'games', 'game', 'design', 'assets'), { recursive: true });
  return dir;
}

function write(rootDir, path, data = '') {
  const full = join(rootDir, path);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, data);
}

function writeManifest(rootDir, manifest) {
  write(rootDir, 'games/game/design/asset-identity.json', JSON.stringify(manifest, null, 2));
}

function solidPng(r, g, b) {
  const data = new Uint8Array(4 * 4 * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
  }
  return encodePng(4, 4, data);
}

describe('asset-identity', () => {
  it('passes exact byte mappings and matching font metrics', () => {
    const repo = root();
    write(repo, 'games/game/design/assets/button.png', 'same-bytes');
    write(repo, 'games/game/refs/assets/button.png', 'same-bytes');
    write(repo, 'games/game/design/tokens.css', ":root{--fab-font-family:'Fredoka One', system-ui;--fab-levelmap-node-font:21px;}");
    write(
      repo,
      'games/game/design/reference-metrics.json',
      JSON.stringify({
        tokens: {
          '--fab-font-family': { kind: 'font-family', expected: "'Fredoka One', system-ui" },
          '--fab-levelmap-node-font': { kind: 'font-size', expected: '21px' },
        },
      }),
    );
    writeManifest(repo, {
      coverage: 'complete',
      referenceMetrics: 'design/reference-metrics.json',
      assets: {
        'design/assets/button.png': {
          source: 'refs/assets/button.png',
          expectation: 'exact-bytes',
        },
      },
    });

    expect(lintAssetIdentity(repo).violations).toEqual([]);
  });

  it('reports exact byte divergence with hashes and paths', () => {
    const repo = root();
    write(repo, 'games/game/design/assets/button.png', 'actual');
    write(repo, 'games/game/refs/assets/button.png', 'expected');
    writeManifest(repo, {
      coverage: 'complete',
      assets: {
        'design/assets/button.png': {
          source: 'refs/assets/button.png',
          expectation: 'exact-bytes',
        },
      },
    });

    const { violations } = lintAssetIdentity(repo);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      game: 'games/game',
      entry: 'design/assets/button.png',
      kind: 'DIVERGENT',
      expectation: 'exact-bytes',
      source: 'refs/assets/button.png',
    });
    expect(violations[0].expectedHash).toHaveLength(12);
    expect(violations[0].actualHash).toHaveLength(12);
  });

  it('warns for missing mappings while incomplete and errors when complete', () => {
    const incomplete = root();
    write(incomplete, 'games/game/design/assets/button.png', 'bytes');
    writeManifest(incomplete, { coverage: 'incomplete', assets: {} });
    expect(lintAssetIdentity(incomplete).violations).toMatchObject([
      { kind: 'MISSING-MAPPING', severity: 'warn' },
    ]);

    const complete = root();
    write(complete, 'games/game/design/assets/button.png', 'bytes');
    writeManifest(complete, { coverage: 'complete', assets: {} });
    expect(lintAssetIdentity(complete).violations).toMatchObject([
      { kind: 'MISSING-MAPPING' },
    ]);
    expect(lintAssetIdentity(complete).violations[0].severity).toBeUndefined();
  });

  it('reports perceptual divergence using the shared phash distance', () => {
    const repo = root();
    write(repo, 'games/game/design/assets/panel.png', solidPng(0, 0, 0));
    write(repo, 'games/game/refs/assets/panel.png', solidPng(255, 255, 255));
    writeManifest(repo, {
      coverage: 'complete',
      assets: {
        'design/assets/panel.png': {
          source: 'refs/assets/panel.png',
          expectation: 'perceptual',
          maxDistance: 1,
        },
      },
    });

    const { violations } = lintAssetIdentity(repo);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      kind: 'DIVERGENT',
      expectation: 'perceptual',
      source: 'refs/assets/panel.png',
    });
    expect(violations[0].distance).toBeGreaterThan(1);
  });

  it('keeps intentional differences visible and requires a reason', () => {
    const documented = root();
    write(documented, 'games/game/design/assets/placeholder.png', 'bytes');
    writeManifest(documented, {
      coverage: 'complete',
      assets: {
        'design/assets/placeholder.png': {
          expectation: 'intentionally-different',
          reason: 'Reference art has not been committed yet.',
        },
      },
    });
    expect(lintAssetIdentity(documented).violations).toMatchObject([
      { kind: 'INTENTIONAL-DIFFERENCE', severity: 'warn' },
    ]);

    const invalid = root();
    write(invalid, 'games/game/design/assets/placeholder.png', 'bytes');
    writeManifest(invalid, {
      coverage: 'complete',
      assets: {
        'design/assets/placeholder.png': {
          expectation: 'intentionally-different',
        },
      },
    });
    expect(lintAssetIdentity(invalid).violations).toMatchObject([
      { kind: 'INVALID-MANIFEST', expectation: 'intentionally-different' },
    ]);
  });

  it('flags sad-face emoji copy as glyph-vs-asset until explicitly mapped', () => {
    const repo = root();
    write(repo, 'games/game/design/copy.ts', 'export const copy = {"result.lose.emoji":"😢"} as const;');
    writeManifest(repo, { coverage: 'complete', assets: {} });

    const { violations } = lintAssetIdentity(repo);
    expect(violations).toMatchObject([
      {
        kind: 'GLYPH-VS-ASSET',
        entry: 'copy:result.lose.emoji',
        file: 'games/game/design/copy.ts',
      },
    ]);
  });

  it('accepts an explicit glyph-vs-asset exception but reports it as a warning', () => {
    const repo = root();
    write(repo, 'games/game/design/copy.ts', 'export const copy = {"result.lose.emoji":"😢"} as const;');
    writeManifest(repo, {
      coverage: 'complete',
      assets: {},
      glyphs: {
        'copy:result.lose.emoji': {
          expectation: 'intentionally-different',
          reason: 'Current port uses a text glyph until reference fail art is wired.',
        },
      },
    });

    expect(lintAssetIdentity(repo).violations).toMatchObject([
      { kind: 'INTENTIONAL-DIFFERENCE', entry: 'copy:result.lose.emoji', severity: 'warn' },
    ]);
  });

  it('reports font metric mismatches against reference-metrics.json', () => {
    const repo = root();
    write(repo, 'games/game/design/tokens.css', ':root{--fab-levelmap-node-font:20px;}');
    write(repo, 'games/game/design/reference-metrics.json', JSON.stringify({
      tokens: {
        '--fab-levelmap-node-font': { kind: 'font-size', expected: '21px' },
      },
    }));
    writeManifest(repo, {
      coverage: 'complete',
      referenceMetrics: 'design/reference-metrics.json',
      assets: {},
    });

    expect(lintAssetIdentity(repo).violations).toMatchObject([
      {
        kind: 'FONT-METRIC-MISMATCH',
        entry: '--fab-levelmap-node-font',
        expectation: 'font-size',
        expected: '21px',
        actual: '20px',
      },
    ]);
  });
});
