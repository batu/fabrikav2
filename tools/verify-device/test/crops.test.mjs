import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGameManifest } from '../../refcap-compare/src/run.mjs';
import { decodePng, encodePng } from '../../refcap-compare/src/png.mjs';
import { prepareJudgedCaptures } from '../src/contentInset.mjs';
import { resolveCropRegions, writeCropArtifacts } from '../src/crops.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
let tmpDirs = [];

afterEach(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
  tmpDirs = [];
});

function tmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-device-crops-'));
  tmpDirs.push(dir);
  return dir;
}

function solidRowsPng(rows) {
  const width = 2;
  const height = rows.length;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      data.set(rows[y], (y * width + x) * 4);
    }
  }
  return encodePng(width, height, data);
}

function baseManifest(gameDir) {
  return {
    game: 'unit_game',
    gameDir,
    reference: { package: 'com.example.unit' },
    states: [{ name: 'menu' }, { name: 'pause' }, { name: 'fail' }],
    verifyDevice: {
      regions: [{
        name: 'top_band',
        label: 'Top band',
        coords: 'normalized',
        states: ['menu', 'pause', 'fail'],
        box: { x: 0, y: 0, width: 1, height: 0.34 },
      }],
    },
  };
}

describe('verifyDevice crop regions', () => {
  it('loads the seeded Marble Run regions from the real manifest', () => {
    const manifest = loadGameManifest('marble_run', REPO_ROOT);
    const regions = resolveCropRegions(manifest);

    expect(regions.map((r) => r.name)).toEqual(expect.arrayContaining([
      'result_ribbon',
      'settings_button_band',
      'gameplay_top_hud',
    ]));
    expect(regions.find((r) => r.name === 'result_ribbon').states).toEqual(['win', 'fail']);
  });

  it('rejects ambiguous or invalid geometry and names', () => {
    const manifest = baseManifest('/tmp/game');

    expect(() => resolveCropRegions({
      ...manifest,
      verifyDevice: { regions: [{ ...manifest.verifyDevice.regions[0], name: 'Bad Name' }] },
    })).toThrow(/machine-safe/);

    expect(() => resolveCropRegions({
      ...manifest,
      verifyDevice: { regions: [{ ...manifest.verifyDevice.regions[0], coords: 'pixels' }] },
    })).toThrow(/coords must be "normalized"/);

    expect(() => resolveCropRegions({
      ...manifest,
      verifyDevice: { regions: [{
        ...manifest.verifyDevice.regions[0],
        box: { x: 0.8, y: 0, width: 0.3, height: 0.5 },
      }] },
    })).toThrow(/within the source image/);

    expect(() => resolveCropRegions({
      ...manifest,
      verifyDevice: { regions: [{ ...manifest.verifyDevice.regions[0], states: ['unknown'] }] },
    })).toThrow(/unknown state/);
  });

  it('writes device, reference, and diff crops from judged capture pixels', () => {
    const dir = tmpDir();
    const gameDir = path.join(dir, 'game');
    const refsDir = path.join(gameDir, 'refs');
    const outDir = path.join(dir, 'out');
    fs.mkdirSync(refsDir, { recursive: true });

    const raw = path.join(dir, 'raw-menu.png');
    fs.writeFileSync(raw, solidRowsPng([
      [10, 0, 0, 255],
      [20, 0, 0, 255],
      [30, 0, 0, 255],
      [40, 0, 0, 255],
    ]));
    fs.writeFileSync(path.join(refsDir, 'menu-ref.png'), solidRowsPng([
      [20, 0, 0, 255],
      [30, 0, 0, 255],
      [40, 0, 0, 255],
    ]));

    const prepared = prepareJudgedCaptures({
      captures: { menu: raw, pause: raw },
      outDir,
      contentInsetTop: 1,
    });
    const manifest = baseManifest(gameDir);
    const rows = [
      {
        state: 'menu',
        device: { source: prepared.judgedCaptures.menu },
        reference: { source: 'refs/menu-ref.png' },
      },
      {
        state: 'pause',
        device: { source: prepared.judgedCaptures.pause },
        reference: { gap: 'no reference pause capture — documented gap' },
      },
      {
        state: 'fail',
        device: { gap: 'no device capture for "fail"' },
        reference: { gap: 'reference skipped by refs manifest at-rest:false: refs/fail.png' },
      },
    ];

    const result = writeCropArtifacts({ manifest, rows, outDir, repoRoot: REPO_ROOT, generatedAt: '2026-07-08' });
    const inventory = JSON.parse(fs.readFileSync(result.inventoryPath, 'utf8'));
    const deviceEntry = inventory.entries.find((e) => e.state === 'menu' && e.side === 'device');
    const referenceEntry = inventory.entries.find((e) => e.state === 'menu' && e.side === 'reference');
    const diffEntry = inventory.entries.find((e) => e.state === 'menu' && e.side === 'diff');
    const pauseReference = inventory.entries.find((e) => e.state === 'pause' && e.side === 'reference');
    const failDevice = inventory.entries.find((e) => e.state === 'fail' && e.side === 'device');

    expect(fs.existsSync(path.join(outDir, deviceEntry.path))).toBe(true);
    expect(fs.existsSync(path.join(outDir, referenceEntry.path))).toBe(true);
    expect(fs.existsSync(path.join(outDir, diffEntry.path))).toBe(true);
    expect(diffEntry.cropResolution).toBe('90x200');
    expect(pauseReference.skipReason).toMatch(/documented gap/);
    expect(failDevice.skipReason).toMatch(/no device capture/);
    expect(result.count).toBe(4); // menu device/reference/diff + pause device
    expect(result.skipped).toBe(5);

    const deviceCrop = decodePng(fs.readFileSync(path.join(outDir, deviceEntry.path)));
    expect([...deviceCrop.data.slice(0, 4)]).toEqual([20, 0, 0, 255]);
    expect(deviceEntry.geometry.sourceResolution).toBe('2x3');
    expect(deviceEntry.geometry.pixels).toEqual({ x: 0, y: 0, width: 2, height: 2 });
  });
});
