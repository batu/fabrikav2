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

describe('copyNativePublicBundle', () => {
  it('ships only manifest-referenced fallback assets and native runtime metadata', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'ftd-native-public-'));
    try {
      const publicRoot = join(fixture, 'public');
      const outputRoot = join(fixture, 'dist');
      write(publicRoot, 'ui/icon.png', 'ui');
      write(publicRoot, 'levels/fallback/color.webp', 'fallback');
      write(publicRoot, 'levels/fallback/unused-source.png', 'large-unused-source');
      write(publicRoot, 'levels/remote/color.webp', 'remote-only');
      write(publicRoot, 'levels/catalog-manifest.json', '{"levels":[]}');
      write(publicRoot, 'levels/catalog-snapshots/catalog-1.json', '{"levels":[]}');
      write(publicRoot, 'levels/bundled-manifest.json', JSON.stringify({
        levels: [{ assets: { colorImage: { path: 'levels/fallback/color.webp' } } }],
      }));

      const bytes = copyNativePublicBundle(publicRoot, outputRoot);

      expect(bytes).toBeGreaterThan(0);
      expect(readFileSync(join(outputRoot, 'ui/icon.png'), 'utf8')).toBe('ui');
      expect(readFileSync(join(outputRoot, 'levels/fallback/color.webp'), 'utf8')).toBe('fallback');
      expect(readFileSync(join(outputRoot, 'levels/catalog-snapshots/catalog-1.json'), 'utf8')).toContain('levels');
      expect(() => readFileSync(join(outputRoot, 'levels/fallback/unused-source.png'))).toThrow();
      expect(() => readFileSync(join(outputRoot, 'levels/remote/color.webp'))).toThrow();
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});
