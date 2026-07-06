import { afterEach, describe, expect, test } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveEvidenceOutDir, writeFidelityGrid } from './fidelityRun.ts';

const tmpDirs: string[] = [];
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'fab-fidelity-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach((): void => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Build a run dir with `screenshots/<name>.png` candidates and a sibling refDir
 *  with `<name>.png` references, controlling which side exists per state. */
function fixture(states: Array<{ name: string; ref: boolean; candidate: boolean }>): { dir: string; refDir: string } {
  const root = scratch();
  const dir = join(root, 'run');
  const refDir = join(root, 'refs-src');
  mkdirSync(join(dir, 'screenshots'), { recursive: true });
  mkdirSync(refDir, { recursive: true });
  for (const s of states) {
    if (s.candidate) writeFileSync(join(dir, 'screenshots', `${s.name}.png`), `cand-${s.name}`);
    if (s.ref) writeFileSync(join(refDir, `${s.name}.png`), `ref-${s.name}`);
  }
  return { dir, refDir };
}

describe('writeFidelityGrid', (): void => {
  test('copies matched refs, writes the grid, and pairs both-present states', (): void => {
    const { dir, refDir } = fixture([
      { name: 'menu', ref: true, candidate: true },
      { name: 'settings', ref: true, candidate: true },
    ]);

    const result = writeFidelityGrid({
      dir,
      refDir,
      states: [
        { name: 'menu', axes: 'layout' },
        { name: 'settings' },
      ],
    });

    expect(result.paired).toEqual(['menu', 'settings']);
    expect(result.missing).toEqual([]);
    // Refs were copied into the run dir's refs/ subdir.
    expect(readdirSync(join(dir, 'refs')).sort()).toEqual(['menu.png', 'settings.png']);
    expect(readFileSync(join(dir, 'refs', 'menu.png'), 'utf8')).toBe('ref-menu');
    // The grid references the in-dir relative srcs.
    const html = readFileSync(result.gridPath, 'utf8');
    expect(html).toContain('src="refs/menu.png"');
    expect(html).toContain('src="screenshots/menu.png"');
  });

  test('reports missing states by which side is absent and drops them from the grid', (): void => {
    const { dir, refDir } = fixture([
      { name: 'menu', ref: true, candidate: true },
      { name: 'win', ref: true, candidate: false }, // ref exists, no v2 capture
      { name: 'ghost', ref: false, candidate: true }, // captured but no reference
      { name: 'void', ref: false, candidate: false },
    ]);

    const result = writeFidelityGrid({
      dir,
      refDir,
      states: [{ name: 'menu' }, { name: 'win' }, { name: 'ghost' }, { name: 'void' }],
    });

    expect(result.paired).toEqual(['menu']);
    expect(result.missing).toEqual([
      { name: 'win', reason: 'candidate' },
      { name: 'ghost', reason: 'ref' },
      { name: 'void', reason: 'both' },
    ]);
    // A missing state is not copied and not rendered.
    expect(readdirSync(join(dir, 'refs'))).toEqual(['menu.png']);
    const html = readFileSync(result.gridPath, 'utf8');
    expect(html).not.toContain('<h2>win</h2>');
  });
});

describe('resolveEvidenceOutDir', (): void => {
  const evidenceDir = '/game/evidence';
  const workDir = '/game/.work';

  test('defaults to the gitignored workDir (side-effect-free)', (): void => {
    expect(resolveEvidenceOutDir({ evidenceDir, workDir, env: {} })).toBe(workDir);
  });

  test('promotes to evidenceDir when PROMOTE_EVIDENCE=1', (): void => {
    expect(resolveEvidenceOutDir({ evidenceDir, workDir, env: { PROMOTE_EVIDENCE: '1' } })).toBe(evidenceDir);
  });

  test('an explicit promote flag overrides the env', (): void => {
    expect(resolveEvidenceOutDir({ evidenceDir, workDir, promote: true, env: {} })).toBe(evidenceDir);
    expect(resolveEvidenceOutDir({ evidenceDir, workDir, promote: false, env: { PROMOTE_EVIDENCE: '1' } })).toBe(workDir);
  });
});
