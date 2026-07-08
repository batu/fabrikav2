import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { lintRefs } from '../src/refs-lint.js';
import { formatRefsCoverage } from '../src/cli.js';

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
      source: 'shipped-capture',
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

  it('reports per-state coverage with provenance and age', () => {
    const repo = root();
    write(repo, 'games/game/refs/captures/source/menu.png', 'png');
    writeManifest(repo, {
      'refs/captures/source/menu.png': manifestEntry(),
    });

    expect(lintRefs(repo, { now: new Date('2026-07-08T12:00:00Z') }).coverage).toEqual([
      {
        game: 'games/game',
        state: 'menu',
        refs: 1,
        provenance: 'shipped-capture',
        age: '2d',
        entries: ['refs/captures/source/menu.png'],
      },
    ]);
  });

  it('warns without failing when a manifest declares states but has no refs', () => {
    const repo = root();
    writeManifest(repo, {});

    const { violations, coverage } = lintRefs(repo);
    expect(violations).toEqual([
      expect.objectContaining({
        game: 'games/game',
        entry: 'refs/manifest.yaml',
        kind: 'NO-REFS',
        severity: 'warn',
      }),
    ]);
    expect(coverage).toEqual([
      expect.objectContaining({
        game: 'games/game',
        state: 'menu',
        refs: 0,
        provenance: '-',
        age: '-',
      }),
    ]);
  });

  it('errors when a capture file has no manifest entry', () => {
    const repo = root();
    write(repo, 'games/game/refs/captures/source/menu.png', 'png');
    writeManifest(repo, {});

    expect(lintRefs(repo).violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          game: 'games/game',
          entry: 'refs/captures/source/menu.png',
          kind: 'MISSING-ENTRY',
        }),
      ]),
    );
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

  it('requires provenance source to use the standard origin vocabulary', () => {
    const missing = root();
    write(missing, 'games/game/refs/captures/source/menu.png', 'png');
    const missingEntry = manifestEntry();
    delete missingEntry.provenance.source;
    writeManifest(missing, {
      'refs/captures/source/menu.png': missingEntry,
    });

    expect(lintRefs(missing).violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'MISSING-FIELD',
          field: 'provenance.source',
        }),
      ]),
    );

    const invalid = root();
    write(invalid, 'games/game/refs/captures/source/menu.png', 'png');
    writeManifest(invalid, {
      'refs/captures/source/menu.png': manifestEntry({
        provenance: { ...manifestEntry().provenance, source: 'unknown-origin' },
      }),
    });

    expect(lintRefs(invalid).violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'INVALID-FIELD',
          field: 'provenance.source',
        }),
      ]),
    );
  });

  it('formats refs coverage as a stable audit table', () => {
    const output = formatRefsCoverage([
      {
        game: 'games/game',
        state: 'menu',
        refs: 1,
        provenance: 'shipped-capture',
        age: '2d',
      },
      {
        game: 'games/game',
        state: 'pause',
        refs: 0,
        provenance: '-',
        age: '-',
      },
    ]).join('\n');

    expect(output).toContain('refs coverage:');
    expect(output).toMatch(/game\s+state\s+refs\s+provenance\s+age/);
    expect(output).toMatch(/games\/game\s+menu\s+1\s+shipped-capture\s+2d/);
    expect(output).toMatch(/games\/game\s+pause\s+0\s+-\s+-/);
  });
});
