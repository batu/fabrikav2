import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGameManifest } from '../../refcap-compare/src/run.mjs';
import { decodePng, encodePng } from '../../refcap-compare/src/png.mjs';
import {
  cropPngVertical,
  cropPngTop,
  prepareJudgedCaptures,
  resolveContentInsets,
  resolveContentInsetTop,
  resolveJudgedContentInsets,
  resolveJudgedContentInsetTop,
} from '../src/contentInset.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const tmpDirs = [];

function tmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-inset-'));
  tmpDirs.push(dir);
  return dir;
}

function testPng() {
  const width = 2;
  const height = 3;
  const rgba = new Uint8Array(width * height * 4);
  const rows = [
    [10, 1, 2, 255],
    [20, 3, 4, 255],
    [30, 5, 6, 255],
  ];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      rgba.set(rows[y], (y * width + x) * 4);
    }
  }
  return { buffer: encodePng(width, height, rgba), rows };
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('content inset crop', () => {
  it('crops exactly the requested top rows from a PNG', () => {
    const { buffer, rows } = testPng();
    const cropped = cropPngTop(buffer, 1);
    const img = decodePng(cropped.buffer);

    expect(img.width).toBe(2);
    expect(img.height).toBe(2);
    expect([...img.data.slice(0, 4)]).toEqual(rows[1]);
    expect([...img.data.slice(8, 12)]).toEqual(rows[2]);
  });

  it('crops requested top and bottom rows from a PNG', () => {
    const { buffer, rows } = testPng();
    const cropped = cropPngVertical(buffer, { top: 1, bottom: 1 });
    const img = decodePng(cropped.buffer);

    expect(img.width).toBe(2);
    expect(img.height).toBe(1);
    expect([...img.data.slice(0, 4)]).toEqual(rows[1]);
  });

  it('rejects a crop that would remove the whole image', () => {
    const { buffer } = testPng();
    expect(() => cropPngTop(buffer, 3)).toThrow(/smaller than image height/);
    expect(() => cropPngVertical(buffer, { top: 2, bottom: 1 })).toThrow(/smaller than image height/);
  });

  it('resolves manifest content inset and lets the CLI override it', () => {
    const manifest = loadGameManifest('marble_run', REPO_ROOT);

    expect(resolveContentInsetTop({ manifest })).toBe(130);
    expect(resolveContentInsetTop({ args: { contentInsetTop: 0 }, manifest })).toBe(0);
    expect(resolveContentInsetTop({ manifest: {} })).toBe(0);
  });

  it('resolves platform-specific Android content insets for Pixel bars', () => {
    const manifest = {
      verifyDevice: {
        contentInsetTop: 130,
        androidContentInsetTop: 72,
        androidContentInsetBottom: 96,
      },
    };

    expect(resolveContentInsets({ manifest, platform: 'android' })).toEqual({ top: 72, bottom: 96 });
    expect(resolveContentInsets({
      args: { contentInsetTop: 12, contentInsetBottom: 34 },
      manifest,
      platform: 'android',
    })).toEqual({ top: 12, bottom: 34 });
    expect(resolveContentInsets({ manifest, platform: 'ios' })).toEqual({ top: 130, bottom: 0 });
  });

  it('does not apply device manifest crop to browser fallback unless CLI overrides it', () => {
    const manifest = loadGameManifest('marble_run', REPO_ROOT);

    expect(resolveJudgedContentInsetTop({ manifest, lane: 'browser' })).toBe(0);
    expect(resolveJudgedContentInsetTop({ args: { contentInsetTop: 12 }, manifest, lane: 'browser' })).toBe(12);
    expect(resolveJudgedContentInsetTop({ manifest, lane: 'provided-captures' })).toBe(130);
    expect(resolveJudgedContentInsets({
      args: { contentInsetBottom: 7 },
      manifest,
      lane: 'browser',
    })).toEqual({ top: 130, bottom: 7 });
  });

  it('preserves raw captures and writes cropped judged captures separately', () => {
    const dir = tmpDir();
    const outDir = path.join(dir, 'out');
    const source = path.join(dir, 'menu.png');
    const { buffer } = testPng();
    fs.writeFileSync(source, buffer);

    const prepared = prepareJudgedCaptures({
      captures: { menu: source },
      outDir,
      contentInsets: { top: 1, bottom: 1 },
    });

    expect(fs.readFileSync(source).equals(buffer)).toBe(true);
    expect(fs.readFileSync(prepared.rawCaptures.menu).equals(buffer)).toBe(true);
    expect(prepared.rawCaptures.menu).toContain(`${path.sep}raw-captures${path.sep}`);
    expect(prepared.judgedCaptures.menu).toContain(`${path.sep}judged-captures${path.sep}`);
    expect(decodePng(fs.readFileSync(prepared.rawCaptures.menu)).height).toBe(3);
    expect(decodePng(fs.readFileSync(prepared.judgedCaptures.menu)).height).toBe(1);
    expect(prepared.artifacts.contentInsetTop).toBe(1);
    expect(prepared.artifacts.contentInsetBottom).toBe(1);
  });
});
