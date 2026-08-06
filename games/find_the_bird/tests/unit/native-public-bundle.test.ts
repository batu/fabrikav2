import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';

import { copyNativePublicBundle } from '../../build/nativePublicBundle';

function write(root: string, relativePath: string, value: string): void {
  const target = join(root, relativePath);
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, value);
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function packageDigest(assets: Array<{ role: string; hash: string; size: number; path: string }>): string {
  const input = assets
    .map((asset) => `${asset.role}:${asset.hash}:${asset.size}:${asset.path}`)
    .sort()
    .join('\n');
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

describe('copyNativePublicBundle', () => {
  it('makes native manifest and catalog metadata authoritative to the packaged bytes', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'ftd-native-public-'));
    try {
      const publicRoot = join(fixture, 'public');
      const outputRoot = join(fixture, 'dist');
      write(publicRoot, 'ui/icon.png', 'ui');
      write(publicRoot, 'levels/fallback/level.json', 'level');
      write(publicRoot, 'levels/fallback/color.webp', 'fallback');
      write(publicRoot, 'levels/fallback/bg_00.webp', 'background');
      write(publicRoot, 'levels/fallback/unused-source.png', 'large-unused-source');
      write(publicRoot, 'levels/remote/color.webp', 'remote-only');
      const stalePackage = {
        complete: true,
        requiredBytes: 9999,
        requiredAssets: [
          { role: 'levelJson', hash: 'stale-level', size: 999, path: 'levels/fallback/level.json' },
          { role: 'colorImage', hash: 'stale-color', size: 999, path: 'levels/fallback/color.webp' },
          { role: 'bwImage', hash: 'obsolete-bw', size: 999, path: 'levels/fallback/bw.png' },
          { role: 'bgImage:0', hash: 'stale-bg', size: 999, path: 'levels/fallback/bg_00.webp' },
        ],
        optionalAssets: [],
      };
      write(publicRoot, 'levels/catalog-manifest.json', JSON.stringify({
        levels: [
          { id: 'fallback', packageId: 'fallback:stale', bundledInApp: false, package: stalePackage },
          { id: 'remote', bundledInApp: true },
        ],
      }));
      write(publicRoot, 'levels/catalog-snapshots/catalog-1.json', JSON.stringify({
        levels: [
          { id: 'fallback', packageId: 'fallback:stale', bundledInApp: false, package: stalePackage },
          { id: 'remote', bundledInApp: true },
        ],
      }));
      write(publicRoot, 'levels/bundled-manifest.json', JSON.stringify({
        levels: [{
          id: 'fallback',
          bundled: false,
          assets: {
            levelJson: { path: 'levels/fallback/level.json', hash: 'stale-level', size: 999 },
            colorImage: { path: 'levels/fallback/color.webp', hash: 'stale-color', size: 999 },
            bgImages: [{ path: 'levels/fallback/bg_00.webp', hash: 'stale-bg', size: 999 }],
          },
        }],
      }));

      const bytes = copyNativePublicBundle(publicRoot, outputRoot);

      const requiredAssets = [
        { role: 'levelJson', hash: hash('level'), size: 5, path: 'levels/fallback/level.json' },
        { role: 'colorImage', hash: hash('fallback'), size: 8, path: 'levels/fallback/color.webp' },
        { role: 'bgImage:0', hash: hash('background'), size: 10, path: 'levels/fallback/bg_00.webp' },
      ];
      const expectedPackage = {
        complete: true,
        requiredBytes: 23,
        requiredAssets,
        optionalAssets: [],
      };

      expect(bytes).toBeGreaterThan(0);
      expect(readFileSync(join(outputRoot, 'ui/icon.png'), 'utf8')).toBe('ui');
      expect(readFileSync(join(outputRoot, 'levels/fallback/color.webp'), 'utf8')).toBe('fallback');
      expect(JSON.parse(readFileSync(join(outputRoot, 'levels/catalog-manifest.json'), 'utf8'))).toMatchObject({
        levels: [
          {
            id: 'fallback',
            packageId: `fallback:${packageDigest(requiredAssets)}`,
            bundledInApp: true,
            package: expectedPackage,
          },
          { id: 'remote', bundledInApp: false },
        ],
      });
      expect(JSON.parse(readFileSync(join(outputRoot, 'levels/catalog-snapshots/catalog-1.json'), 'utf8'))).toMatchObject({
        levels: [
          {
            id: 'fallback',
            packageId: `fallback:${packageDigest(requiredAssets)}`,
            bundledInApp: true,
            package: expectedPackage,
          },
          { id: 'remote', bundledInApp: false },
        ],
      });
      expect(JSON.parse(readFileSync(join(outputRoot, 'levels/bundled-manifest.json'), 'utf8'))).toMatchObject({
        levels: [{
          id: 'fallback',
          bundled: true,
          assets: {
            levelJson: { path: 'levels/fallback/level.json', hash: hash('level'), size: 5 },
            colorImage: { path: 'levels/fallback/color.webp', hash: hash('fallback'), size: 8 },
            bgImages: [{ path: 'levels/fallback/bg_00.webp', hash: hash('background'), size: 10 }],
          },
        }],
      });
      expect(expectedPackage.requiredAssets.some((asset) => asset.role === 'bwImage')).toBe(false);
      expect(() => readFileSync(join(outputRoot, 'levels/fallback/unused-source.png'))).toThrow();
      expect(() => readFileSync(join(outputRoot, 'levels/remote/color.webp'))).toThrow();
      expect(() => readFileSync(join(outputRoot, 'levels/fallback/bw.png'))).toThrow();
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('fails closed when the bundled manifest references a missing asset', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'ftd-native-public-missing-'));
    try {
      const publicRoot = join(fixture, 'public');
      const outputRoot = join(fixture, 'dist');
      write(publicRoot, 'levels/catalog-manifest.json', JSON.stringify({ levels: [{ id: 'fallback' }] }));
      write(publicRoot, 'levels/bundled-manifest.json', JSON.stringify({
        levels: [{
          id: 'fallback',
          assets: {
            levelJson: { path: 'levels/fallback/level.json', hash: 'missing', size: 1 },
            colorImage: { path: 'levels/fallback/color.webp', hash: 'missing', size: 1 },
          },
        }],
      }));
      write(publicRoot, 'levels/fallback/level.json', 'level');

      expect(() => copyNativePublicBundle(publicRoot, outputRoot)).toThrow(
        'Native public asset is missing: levels/fallback/color.webp',
      );
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});
