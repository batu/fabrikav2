import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { encodePng } from '../../refcap-compare/src/png.mjs';
import {
  detectIndistinguishableStates,
  formatAllowedIndistinguishableStates,
  formatIndistinguishableStateWarnings,
  resolveIndistinguishableStateAllowList,
} from '../src/indistinguishableStates.mjs';

let tmpDirs = [];

afterEach(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
  tmpDirs = [];
});

function tmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-device-indist-'));
  tmpDirs.push(dir);
  return dir;
}

function writeSolidPng(dir, name, gray) {
  const width = 48;
  const height = 48;
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = gray;
    data[i + 1] = gray;
    data[i + 2] = gray;
    data[i + 3] = 255;
  }
  const file = path.join(dir, `${name}.png`);
  fs.writeFileSync(file, encodePng(width, height, data));
  return file;
}

describe('detectIndistinguishableStates', () => {
  it('flags different states that have identical raw captures', () => {
    const dir = tmpDir();
    const menu = writeSolidPng(dir, 'menu', 128);
    const level = path.join(dir, 'level.png');
    fs.copyFileSync(menu, level);

    const result = detectIndistinguishableStates({
      captures: { menu, level, settings: writeSolidPng(dir, 'settings', 255) },
    });

    expect(result.blockingPairs).toHaveLength(1);
    expect(result.blockingPairs[0]).toMatchObject({
      stateA: 'menu',
      stateB: 'level',
      allowed: false,
    });
    expect(result.blockingPairs[0].distance).toBe(0);
  });

  it('flags near-identical raw captures under the perceptual threshold', () => {
    const dir = tmpDir();
    const result = detectIndistinguishableStates({
      captures: {
        menu: writeSolidPng(dir, 'menu', 130),
        level: writeSolidPng(dir, 'level', 134),
      },
    });

    expect(result.blockingPairs).toHaveLength(1);
    expect(result.blockingPairs[0].distance).toBeLessThanOrEqual(result.threshold);
  });

  it('does not flag clearly distinct raw captures', () => {
    const dir = tmpDir();
    const result = detectIndistinguishableStates({
      captures: {
        menu: writeSolidPng(dir, 'menu', 0),
        level: writeSolidPng(dir, 'level', 255),
      },
    });

    expect(result.pairs).toEqual([]);
  });

  it('keeps allowed near-identical pairs visible without making them blocking', () => {
    const dir = tmpDir();
    const result = detectIndistinguishableStates({
      captures: {
        menu: writeSolidPng(dir, 'menu', 128),
        level: writeSolidPng(dir, 'level', 128),
      },
      manifest: {
        verifyDevice: {
          indistinguishableStates: {
            allow: [
              {
                states: ['level', 'menu'],
                reason: 'shared loading shell before content arrives',
              },
            ],
          },
        },
      },
    });

    expect(result.blockingPairs).toEqual([]);
    expect(result.allowedPairs).toHaveLength(1);
    expect(result.allowedPairs[0]).toMatchObject({
      allowed: true,
      reason: 'shared loading shell before content arrives',
    });
  });
});

describe('indistinguishable-state allow list parsing and formatting', () => {
  it('parses comma-string and object allow entries into pair keys', () => {
    const allow = resolveIndistinguishableStateAllowList({
      verifyDevice: {
        indistinguishableStates: {
          allow: [
            'menu, level',
            { pair: ['win', 'fail'], reason: 'same result shell' },
          ],
        },
      },
    });

    expect(allow.size).toBe(2);
  });

  it('prints the mandatory warning phrase for blocking pairs', () => {
    const warning = formatIndistinguishableStateWarnings([
      {
        stateA: 'menu',
        stateB: 'level',
        distance: 0,
        threshold: 10,
        digestA: 'aaaaaaaa',
        digestB: 'aaaaaaaa',
      },
    ]);

    expect(warning).toContain('INDISTINGUISHABLE STATES');
    expect(warning).toContain('menu == level');
  });

  it('prints allowed manifest pairs separately from blocking warnings', () => {
    const warning = formatAllowedIndistinguishableStates([
      { stateA: 'win', stateB: 'fail', reason: 'same terminal shell' },
    ]);

    expect(warning).toContain('allowed by manifest');
    expect(warning).toContain('same terminal shell');
  });
});
