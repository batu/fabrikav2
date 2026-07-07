import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { lintRefs } from '../src/refs-lint.js';

const roots = [];

afterEach(() => {
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

function root() {
  const dir = mkdtempSync(join(tmpdir(), 'refs-lint-'));
  roots.push(dir);
  mkdirSync(join(dir, 'games', 'game', 'refs', 'captures', 'source'), { recursive: true });
  return dir;
}

function write(rootDir, path, data = '') {
  const full = join(rootDir, path);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, data);
}

function manifestEntry(overrides = {}) {
  return {
    'state-variant': 'menu/cold-start',
    'capture-recipe': 'launch the reference app and wait for the menu to settle',
    'at-rest': true,
    provenance: {
      package: 'com.example.reference',
      device: 'Pixel 6a',
      host: 'ubuntu-server',
      captured: '2026-07-06',
    },
    ...overrides,
  };
}

function writeManifest(rootDir, refs) {
  const lines = [
    'game: game',
    'reference:',
    '  package: com.example.reference',
    'states:',
    '  - name: menu',
    '    reference:',
    '      gap: documented',
    '    v2:',
    '      gap: documented',
    'refs:',
  ];
  for (const [path, entry] of Object.entries(refs)) {
    lines.push(`  ${path}:`);
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      lines.push(`    value: ${entry}`);
      continue;
    }
    for (const [key, value] of Object.entries(entry)) {
      if (key === 'provenance' && value && typeof value === 'object') {
        lines.push('    provenance:');
        for (const [pkey, pvalue] of Object.entries(value)) {
          lines.push(`      ${pkey}: ${pvalue}`);
        }
      } else {
        lines.push(`    ${key}: ${value}`);
      }
    }
  }
  write(rootDir, 'games/game/refs/manifest.yaml', `${lines.join('\n')}\n`);
}

describe('refs-lint', () => {
  it('passes when every capture has complete refs metadata', () => {
    const repo = root();
    write(repo, 'games/game/refs/captures/source/menu.png', 'png');
    writeManifest(repo, {
      'refs/captures/source/menu.png': manifestEntry(),
    });

    expect(lintRefs(repo).violations).toEqual([]);
  });

  it('errors when a capture file has no manifest entry', () => {
    const repo = root();
    write(repo, 'games/game/refs/captures/source/menu.png', 'png');
    writeManifest(repo, {});

    expect(lintRefs(repo).violations).toMatchObject([
      {
        game: 'games/game',
        entry: 'refs/captures/source/menu.png',
        kind: 'MISSING-ENTRY',
      },
    ]);
  });

  it('errors when a required field is missing', () => {
    const repo = root();
    write(repo, 'games/game/refs/captures/source/menu.png', 'png');
    const entry = manifestEntry();
    delete entry['capture-recipe'];
    writeManifest(repo, {
      'refs/captures/source/menu.png': entry,
    });

    expect(lintRefs(repo).violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entry: 'refs/captures/source/menu.png',
          kind: 'MISSING-FIELD',
          field: 'capture-recipe',
        }),
      ]),
    );
  });

  it('errors when at-rest is not a boolean', () => {
    const repo = root();
    write(repo, 'games/game/refs/captures/source/menu.png', 'png');
    writeManifest(repo, {
      'refs/captures/source/menu.png': manifestEntry({ 'at-rest': 'yes' }),
    });

    expect(lintRefs(repo).violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'INVALID-FIELD',
          field: 'at-rest',
        }),
      ]),
    );
  });

  it('errors when a manifest entry points at a missing capture', () => {
    const repo = root();
    write(repo, 'games/game/refs/captures/source/menu.png', 'png');
    writeManifest(repo, {
      'refs/captures/source/menu.png': manifestEntry(),
      'refs/captures/source/stale.png': manifestEntry({ 'state-variant': 'menu/stale' }),
    });

    expect(lintRefs(repo).violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entry: 'refs/captures/source/stale.png',
          kind: 'STALE-ENTRY',
        }),
      ]),
    );
  });

  it('requires not-at-rest entries to explain the unsafe capture and recapture path', () => {
    const repo = root();
    write(repo, 'games/game/refs/captures/source/fail.png', 'png');
    writeManifest(repo, {
      'refs/captures/source/fail.png': manifestEntry({
        'state-variant': 'fail/mid-load',
        'at-rest': false,
      }),
    });

    expect(lintRefs(repo).violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'not-at-rest-reason' }),
        expect.objectContaining({ field: 'recapture-note' }),
      ]),
    );
  });
});
