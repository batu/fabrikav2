import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The production seam is an executable Node .mjs script outside this game's
// TypeScript root; Vitest loads it directly, while tsc has no sibling .d.mts.
// @ts-expect-error exercised runtime module intentionally has no declaration
import { ANDROID_LAUNCHER_ICONS, assertFilesMatch, copyOverlay } from '../../../../tools/marble-run/sync-native-resources.mjs';

function write(root: string, relative: string, content: string): void {
  const target = join(root, relative);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

describe('native resource overlay', () => {
  it('restores every Android launcher icon byte-for-byte and is idempotent', () => {
    const root = mkdtempSync(join(tmpdir(), 'marble-native-sync-'));
    const source = join(root, 'source');
    const target = join(root, 'generated');

    for (const relative of ANDROID_LAUNCHER_ICONS) {
      write(source, relative, `branded:${relative}`);
      write(target, relative, 'capacitor-placeholder');
    }

    expect(copyOverlay(source, target).sort()).toEqual([...ANDROID_LAUNCHER_ICONS].sort());
    expect(assertFilesMatch(source, target, ANDROID_LAUNCHER_ICONS)).toEqual([]);
    expect(copyOverlay(source, target)).toEqual([]);

    const corrupted = ANDROID_LAUNCHER_ICONS[0];
    write(target, corrupted, 'capacitor-placeholder-again');
    expect(assertFilesMatch(source, target, ANDROID_LAUNCHER_ICONS)).toEqual([corrupted]);
    expect(copyOverlay(source, target)).toEqual([corrupted]);
    expect(readFileSync(join(target, corrupted))).toEqual(readFileSync(join(source, corrupted)));
  });

  it('copies nested iOS AppIcon assets and rejects missing expected files', () => {
    const root = mkdtempSync(join(tmpdir(), 'marble-native-sync-'));
    const source = join(root, 'source');
    const target = join(root, 'generated');
    const icon = 'AppIcon.appiconset/AppIcon-512@2x.png';
    const manifest = 'AppIcon.appiconset/Contents.json';

    write(source, icon, 'branded-ios-icon');
    write(source, manifest, '{"images":[]}');

    expect(copyOverlay(source, target)).toEqual([icon, manifest]);
    expect(assertFilesMatch(source, target, [icon, manifest])).toEqual([]);
    expect(copyOverlay(source, target)).toEqual([]);

    expect(() => assertFilesMatch(source, target, ['AppIcon.appiconset/missing.png']))
      .toThrow(/expected source file missing/);
  });
});
