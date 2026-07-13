// Phaser dependency-freeze proof for the phaser lane (card qWCv9tUo item 3/11).
//
// The legacy game games/find_the_dog pins phaser ^3.90.0, which npm hoists to
// the ROOT node_modules/phaser. Without a lane-local pin, the phaser proof game
// (and its future authoring/ editor project) would resolve that legacy 3.90 —
// the wrong runtime for the phaser-native lane. U1 pins exact phaser@4.2.1 in
// games/shell_proof_phaser so it installs NESTED and wins resolution. This test
// proves that from both the proof runtime and the authoring project, and that
// no nested lockfile was introduced (the single root package-lock owns it).
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { describe, it, expect } from 'vitest';

const repoRoot = resolve(import.meta.dirname, '../../..');
const proofRuntime = resolve(repoRoot, 'games/shell_proof_phaser');
const authoringProject = resolve(proofRuntime, 'authoring');

/** Resolve `phaser` exactly as node would from `fromDir`, and read its version. */
function resolvedPhaser(fromDir) {
  // createRequire's base need not exist on disk — node still walks node_modules
  // up from it, which is what the future authoring/ project will do.
  const req = createRequire(resolve(fromDir, 'noop.js'));
  const entry = req.resolve('phaser');
  const marker = `${sep}node_modules${sep}phaser${sep}`;
  const idx = entry.indexOf(marker);
  if (idx < 0) throw new Error(`unexpected phaser resolution path: ${entry}`);
  const pkgRoot = entry.slice(0, idx + marker.length - 1);
  const version = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8')).version;
  return { pkgRoot, version };
}

describe('phaser 4.2.1 dependency freeze (card qWCv9tUo item 3/11)', () => {
  for (const [label, dir] of [
    ['proof runtime', proofRuntime],
    ['authoring project', authoringProject],
  ]) {
    it(`resolves exactly phaser 4.2.1 from the ${label}, never the legacy root 3.90`, () => {
      const { pkgRoot, version } = resolvedPhaser(dir);
      expect(version).toBe('4.2.1');
      expect(version.startsWith('3.')).toBe(false);
      // The winning copy is the lane-nested one, not the hoisted root 3.90.
      expect(pkgRoot.split(sep).join('/')).toContain('games/shell_proof_phaser/node_modules/phaser');
    });
  }

  it('keeps a single root lockfile — no nested lockfile in the lane workspaces', () => {
    for (const rel of [
      'games/shell_proof_phaser/package-lock.json',
      'tools/phaser-shell/package-lock.json',
    ]) {
      expect(existsSync(resolve(repoRoot, rel))).toBe(false);
    }
    expect(existsSync(resolve(repoRoot, 'package-lock.json'))).toBe(true);
  });
});
