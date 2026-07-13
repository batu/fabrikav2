import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  globToRegExp,
  matchesAny,
  classifyChange,
  verifyLaneChanges,
  laneDiffRange,
  parseRawNameStatusZ,
  collectChangedPaths,
  decideNoLaneAction,
  policyMutationReason,
  GIT_SYMLINK_MODE,
} from '../src/fence.mjs';
import { resolveLaneBase, resolveIntegrationRef } from '../fence-gate.mjs';

const FENCES_PATH = resolve(process.cwd(), '../../experiments/design-frontends/fences.json');
const fences = JSON.parse(readFileSync(FENCES_PATH, 'utf8'));

describe('globToRegExp / matchesAny', () => {
  it('`**` crosses path segments; `*` does not', () => {
    expect(globToRegExp('tools/grapes-shell/**').test('tools/grapes-shell/a/b.ts')).toBe(true);
    expect(globToRegExp('tools/grapes-shell/**').test('tools/phaser-shell/a.ts')).toBe(false);
    expect(globToRegExp('games/*/authoring/**').test('games/x/authoring/p.ts')).toBe(true);
    expect(globToRegExp('games/*/x').test('games/a/b/x')).toBe(false);
  });
  it('an un-wildcarded pattern matches its path exactly', () => {
    const re = globToRegExp('games/shell_proof_grapes/design/revision.json');
    expect(re.test('games/shell_proof_grapes/design/revision.json')).toBe(true);
    expect(re.test('games/shell_proof_grapes/design/revision.jsonx')).toBe(false);
    expect(re.test('xgames/shell_proof_grapes/design/revision.json')).toBe(false);
  });
  it('matchesAny tolerates a missing/empty pattern list', () => {
    expect(matchesAny('a', undefined)).toBe(false);
    expect(matchesAny('a', [])).toBe(false);
  });
});

describe('verifyLaneChanges — grapes lane against the real committed fence', () => {
  it('allows every path inside the grapes writable fence', () => {
    const changedPaths = [
      'tools/grapes-shell/src/publish.ts',
      'games/shell_proof_grapes/authoring/project.json',
      'games/shell_proof_grapes/src/main.ts',
      'games/shell_proof_grapes/src/shell/TemplateShell.ts',
      'games/shell_proof_grapes/src/shell/template-shell.css',
      'games/shell_proof_grapes/src/shell/renderers/DomRenderer.ts',
      'games/shell_proof_grapes/tests/runtime/renderer.test.ts',
      'games/shell_proof_grapes/design/revisions/rev-1/projection.json',
      'games/shell_proof_grapes/design/revision.json',
      'games/shell_proof_grapes/evidence/2026-07-12/menu.png',
    ];
    expect(verifyLaneChanges({ laneId: 'grapes', changedPaths, fences })).toEqual({
      ok: true,
      violations: [],
    });
  });

  it('rejects shared-surface, non-target, forbidden, cross-lane, and frozen-neighbor writes', () => {
    const cases = [
      ['packages/kernel/src/shellContract.ts', 'shared-surface'],
      ['experiments/design-frontends/protocol.json', 'shared-surface'],
      ['experiments/design-frontends/fences.json', 'shared-surface'],
      ['package-lock.json', 'shared-surface'],
      ['games/_template/src/main.ts', 'non-target'],
      ['tools/phaser-shell/src/bundle.ts', 'forbidden'],
      ['games/shell_proof_phaser/authoring/p.ts', 'forbidden'],
      ['games/shell_proof_grapes/src/core/TemplateShellController.ts', 'out-of-fence'],
      ['games/shell_proof_grapes/src/shell/harness.ts', 'out-of-fence'],
      ['games/shell_proof_grapes/tests/unit/smoke.test.ts', 'out-of-fence'],
    ];
    for (const [path, kind] of cases) {
      const { ok, violations } = verifyLaneChanges({ laneId: 'grapes', changedPaths: [path], fences });
      expect(ok, path).toBe(false);
      expect(violations[0].kind, path).toBe(kind);
    }
  });

  it('flags an unknown lane rather than silently passing', () => {
    const { ok, violations } = verifyLaneChanges({ laneId: 'nope', changedPaths: ['a'], fences });
    expect(ok).toBe(false);
    expect(violations[0].kind).toBe('unknown-lane');
  });
});

describe('verifyLaneChanges — a changed tracked symlink is rejected even inside the writable glob', () => {
  const allowed = 'games/shell_proof_grapes/evidence/2026-07-13/link';
  it('rejects an allowed-path symlink escape as kind "symlink"', () => {
    const { ok, violations } = verifyLaneChanges({
      laneId: 'grapes',
      changedPaths: [allowed],
      symlinkPaths: [allowed],
      fences,
    });
    expect(ok).toBe(false);
    expect(violations[0].kind).toBe('symlink');
  });
  it('allows the same path when it is an ordinary (non-symlink) file', () => {
    expect(verifyLaneChanges({ laneId: 'grapes', changedPaths: [allowed], fences }).ok).toBe(true);
  });
  it('exposes git symlink mode 120000', () => {
    expect(GIT_SYMLINK_MODE).toBe('120000');
  });
});

describe('classifyChange cross-lane branch (synthetic fence without an overlapping forbid)', () => {
  it("tags the other lane's writable path as cross-lane", () => {
    const synthetic = {
      sharedSurfaces: { paths: ['packages/**'] },
      nonTargets: { paths: [] },
      lanes: {
        a: { writable: ['lane-a/**'], forbidden: [] },
        b: { writable: ['lane-b/**'], forbidden: [] },
      },
    };
    expect(classifyChange('lane-b/x.ts', 'a', synthetic).kind).toBe('cross-lane');
    expect(classifyChange('lane-a/x.ts', 'a', synthetic).kind).toBe('writable');
  });
});

describe('parseRawNameStatusZ / collectChangedPaths — NUL-safe name-status', () => {
  it('parses rename(2 paths) + add-symlink + delete + a newline-in-name add', () => {
    const z =
      ':100644 100644 f f R100\0src.txt\0dst.txt\0'
      + ':000000 120000 0 s A\0link\0'
      + ':100644 000000 8 0 D\0gone.txt\0'
      + ':000000 100644 0 5 A\0weird\nname.txt\0';
    const records = parseRawNameStatusZ(z);
    expect(records.map((r) => r.status)).toEqual(['R100', 'A', 'D', 'A']);
    expect(records[0].paths).toEqual(['src.txt', 'dst.txt']);
    const { changedPaths, symlinkPaths } = collectChangedPaths(records);
    // BOTH sides of the rename, the deleted path, and the newline-named add.
    expect(changedPaths).toEqual(['src.txt', 'dst.txt', 'link', 'gone.txt', 'weird\nname.txt']);
    expect(symlinkPaths).toEqual(['link']);
  });

  it('flags a deleted symlink (source-side mode 120000)', () => {
    const records = parseRawNameStatusZ(':120000 000000 s 0 D\0oldlink\0');
    expect(collectChangedPaths(records).symlinkPaths).toEqual(['oldlink']);
  });

  it('flags BOTH paths when a rename turns a file into a symlink', () => {
    const records = parseRawNameStatusZ(':100644 120000 a b R100\0was-file\0now-link\0');
    expect(collectChangedPaths(records).symlinkPaths).toEqual(['was-file', 'now-link']);
  });

  it('de-duplicates a path touched by more than one record', () => {
    const records = parseRawNameStatusZ(':100644 100644 a b M\0f\0:100644 000000 a 0 D\0f\0');
    expect(collectChangedPaths(records).changedPaths).toEqual(['f']);
  });

  it('ignores the trailing NUL (empty final token) and empty input', () => {
    expect(parseRawNameStatusZ('')).toEqual([]);
    expect(parseRawNameStatusZ('\0')).toEqual([]);
  });

  it('throws on a record with no metainfo colon rather than passing silently', () => {
    expect(() => parseRawNameStatusZ('100644 100644 a b M\0f\0')).toThrow(/no ':' metainfo/);
  });

  it('throws on a truncated rename missing its destination path', () => {
    expect(() => parseRawNameStatusZ(':100644 100644 a b R100\0only-src')).toThrow(
      /missing its destination path/,
    );
  });
});

describe('resolveIntegrationRef — conductor-owned canonical ref only (comment 40)', () => {
  const LOCAL = 'a'.repeat(40);
  const REMOTE = 'b'.repeat(40);

  it('resolves the canonical LOCAL branch', () => {
    const run = (cmd) => (cmd.includes('refs/heads/exp/foo^{commit}') ? LOCAL : null);
    expect(resolveIntegrationRef(run, { canonicalBranch: 'exp/foo', remote: 'origin' })).toEqual({
      ok: true,
      ref: 'refs/heads/exp/foo',
      sha: LOCAL,
    });
  });

  it('falls back to the origin-tracking TWIN when there is no local branch', () => {
    const run = (cmd) => {
      if (cmd.includes('refs/heads/exp/foo^{commit}')) return null;
      if (cmd.includes('refs/remotes/origin/exp/foo^{commit}')) return REMOTE;
      return null;
    };
    expect(resolveIntegrationRef(run, { canonicalBranch: 'exp/foo' })).toEqual({
      ok: true,
      ref: 'refs/remotes/origin/exp/foo',
      sha: REMOTE,
    });
  });

  it('rejects a free-form override (HEAD, a SHA, another branch) before touching git', () => {
    let called = false;
    const run = () => {
      called = true;
      return LOCAL;
    };
    for (const bad of ['HEAD', 'refs/heads/HEAD', 'c'.repeat(40), 'some-other-branch']) {
      const r = resolveIntegrationRef(run, { canonicalBranch: 'exp/foo', overrideRef: bad });
      expect(r.ok, bad).toBe(false);
      expect(r.error, bad).toMatch(/is not the conductor-owned/);
    }
    expect(called).toBe(false);
  });

  it('accepts an override that names the canonical branch in any legal spelling, still resolving canonically', () => {
    const run = (cmd) => (cmd.includes('refs/heads/exp/foo^{commit}') ? LOCAL : null);
    for (const good of ['exp/foo', 'refs/heads/exp/foo', 'origin/exp/foo', 'refs/remotes/origin/exp/foo']) {
      const r = resolveIntegrationRef(run, { canonicalBranch: 'exp/foo', overrideRef: good });
      expect(r.ok, good).toBe(true);
      expect(r.ref, good).toBe('refs/heads/exp/foo');
    }
  });

  it('rejects a missing conductor-owned integration.branch', () => {
    const r = resolveIntegrationRef(() => null, { canonicalBranch: undefined });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no conductor-owned integration\.branch/);
  });

  it('rejects a canonical branch that is present as neither local nor twin', () => {
    const r = resolveIntegrationRef(() => null, { canonicalBranch: 'exp/foo' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/is not present as/);
  });
});

describe('lane base measurement — trusted integration merge-base (comment 38)', () => {
  it('measures over a base-EXCLUSIVE range so inherited seal commits are ignored', () => {
    expect(laneDiffRange('abc123')).toBe('abc123..HEAD');
  });

  it('attributing an inherited seal/protocol byte to a lane fails closed', () => {
    // If the base were chosen too early (before the seal), protocol.json would
    // appear in the range and must be rejected as a shared surface — the reason
    // the base must post-date the functional baseline.
    const { ok, violations } = verifyLaneChanges({
      laneId: 'grapes',
      changedPaths: ['experiments/design-frontends/protocol.json'],
      fences,
    });
    expect(ok).toBe(false);
    expect(violations[0].kind).toBe('shared-surface');
  });

  const FB = 'f'.repeat(40);
  const BASE = 'a'.repeat(40);
  const HEADSHA = 'e'.repeat(40);
  const INTEG = 'd'.repeat(40); // the RESOLVED integration ref SHA
  // Runner convention mirrors execSync: '' on zero-exit, null on non-zero exit.
  const runOk = (cmd) => {
    if (cmd.startsWith('git merge-base HEAD ')) return BASE; // trusted base
    if (cmd.startsWith('git cat-file -e')) return ''; // present
    if (cmd.includes('--is-ancestor')) return ''; // ancestor-of-HEAD + descends-from-FB
    if (cmd.startsWith('git rev-parse --verify --quiet')) return BASE; // explicit base -> BASE
    return '';
  };

  it('computes the trusted merge-base when no explicit base is given', () => {
    const r = resolveLaneBase(runOk, { integrationRef: INTEG, functionalBaseline: FB });
    expect(r).toEqual({ ok: true, base: BASE, integrationRef: INTEG });
  });

  it('accepts an explicit base equal to the trusted merge-base', () => {
    const r = resolveLaneBase(runOk, { explicitBase: BASE, integrationRef: INTEG, functionalBaseline: FB });
    expect(r.ok).toBe(true);
    expect(r.base).toBe(BASE);
  });

  it('REJECTS an explicit base that differs from the trusted merge-base (base==HEAD exploit)', () => {
    const run = (cmd) => {
      if (cmd.startsWith('git merge-base HEAD ')) return BASE;
      if (cmd.startsWith('git cat-file -e')) return '';
      if (cmd.includes('--is-ancestor')) return '';
      if (cmd.startsWith('git rev-parse --verify --quiet')) return HEADSHA; // resolves to HEAD != BASE
      return '';
    };
    const r = resolveLaneBase(run, { explicitBase: 'HEAD', integrationRef: INTEG, functionalBaseline: FB });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/is not the trusted integration merge-base/);
  });

  it('rejects an unresolvable explicit base', () => {
    const run = (cmd) => {
      if (cmd.startsWith('git merge-base HEAD ')) return BASE;
      if (cmd.startsWith('git cat-file -e')) return '';
      if (cmd.includes('--is-ancestor')) return '';
      if (cmd.startsWith('git rev-parse --verify --quiet')) return null; // cannot resolve
      return '';
    };
    const r = resolveLaneBase(run, { explicitBase: 'bogus', integrationRef: INTEG, functionalBaseline: FB });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/is not a resolvable commit/);
  });

  it('requires an integration ref', () => {
    const r = resolveLaneBase(runOk, { functionalBaseline: FB });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no integration ref/);
  });

  it('rejects when the merge-base cannot be computed', () => {
    const run = (cmd) => (cmd.startsWith('git merge-base HEAD ') ? null : '');
    const r = resolveLaneBase(run, { integrationRef: INTEG, functionalBaseline: FB });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/cannot compute merge-base/);
  });

  it('rejects a base that does not descend from the functional baseline', () => {
    const run = (cmd) => {
      if (cmd.startsWith('git merge-base HEAD ')) return BASE;
      if (cmd.startsWith('git cat-file -e')) return '';
      if (cmd.includes(`--is-ancestor ${FB} ${BASE}`)) return null; // does NOT descend
      if (cmd.includes('--is-ancestor')) return ''; // ancestor-of-HEAD passes
      return '';
    };
    const r = resolveLaneBase(run, { integrationRef: INTEG, functionalBaseline: FB });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/does not descend from the functional baseline/);
  });

  it('rejects an absent base object', () => {
    const run = (cmd) => {
      if (cmd.startsWith('git merge-base HEAD ')) return BASE;
      if (cmd.startsWith('git cat-file -e')) return null; // not present
      return '';
    };
    const r = resolveLaneBase(run, { integrationRef: INTEG, functionalBaseline: FB });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/is not present/);
  });

  it('rejects a merge-base that is not a commit SHA', () => {
    const run = (cmd) => (cmd.startsWith('git merge-base HEAD ') ? 'not-a-sha!' : '');
    const r = resolveLaneBase(run, { integrationRef: INTEG, functionalBaseline: FB });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/is not a commit SHA/);
  });
});

describe('decideNoLaneAction — the no-lane default invocation (comment 43)', () => {
  it('SKIPs the integration tip (not diverged)', () => {
    const d = decideNoLaneAction({ diverged: false, allowIntegration: false });
    expect(d.skip).toBe(true);
    expect(d.reason).toMatch(/integration tip/);
  });

  it('FAILS a diverged branch with no lane and no acknowledgement (default false-pass closed)', () => {
    const d = decideNoLaneAction({ diverged: true, allowIntegration: false });
    expect(d.skip).toBe(false);
    expect(d.reason).toMatch(/refusing to silently skip/);
  });

  it('SKIPs a diverged branch ONLY with the conscious integration acknowledgement', () => {
    const d = decideNoLaneAction({ diverged: true, allowIntegration: true });
    expect(d.skip).toBe(true);
    expect(d.reason).toMatch(/acknowledged/);
  });
});

describe('policyMutationReason — reject working-tree policy mutation (comment 43)', () => {
  it('returns null when bytes match and the branch is unchanged', () => {
    expect(
      policyMutationReason({ bytesEqual: true, workingBranch: 'exp/x', canonicalBranch: 'exp/x' }),
    ).toBeNull();
  });

  it('flags any byte difference (widened writable, redirected branch, ...)', () => {
    const r = policyMutationReason({ bytesEqual: false, workingBranch: 'exp/x', canonicalBranch: 'exp/x' });
    expect(r).toMatch(/differs from the conductor-owned canonical policy/);
  });

  it('flags a redirected integration.branch even if a byte compare were somehow equal', () => {
    const r = policyMutationReason({ bytesEqual: true, workingBranch: 'lane', canonicalBranch: 'exp/x' });
    expect(r).toMatch(/integration\.branch was redirected/);
  });
});

describe('fence fixture sanity', () => {
  it('the committed fences.json exists with both lanes and a conductor-owned integration ref', () => {
    expect(existsSync(FENCES_PATH)).toBe(true);
    expect(Object.keys(fences.lanes).sort()).toEqual(['grapes', 'phaser']);
    expect(fences.integration && fences.integration.branch).toBe('experiment/dual-design-frontends');
  });
});
