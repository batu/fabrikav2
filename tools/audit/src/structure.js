// Linter 4 — structure.
//
// Guardrail: a game's TOP-LEVEL entries must match the canonical whitelist (the
// games/_template skeleton). v1's failure (docs/research/09-game-folder-chaos-
// analysis.md): games accreted up to 48 top-level entries, 4 competing asset
// homes, 6 test locations, committed .work scratch (4.5GB), plus secrets, key
// files, and archive graveyards checked straight into the tree.
//
// This linter fails on any top-level entry outside the whitelist, naming the
// correct home (from the conductor's approved ban list, card QzqGf6el), and
// verifies each game's `.work/` scratch is gitignored. It intentionally checks
// ONLY the top level — the interior of an allowed dir is that dir's business.
//
// Generated native shells (`ios/`, `android/`) are a CONDITIONAL top-level
// allowance: legitimate only when gitignored (Capacitor-generated, never
// committed — committed native inputs live in `native-resources/`), a violation
// when git-tracked. Checked via the deterministic `.gitignore`-text rule below.

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { listDirs, readText, rel } from './lib.js';

/** Canonical top-level directories (the games/_template skeleton). */
export const ALLOWED_DIRS = new Set([
  'src',
  'design',
  'content',
  'public',
  'tests',
  'native-resources',
  'refs',
  'docs',
  'evidence',
  '.work',
  // Lane authoring home for the dual-design-frontends experiment (card qWCv9tUo,
  // fences.json lane `writable` set). Added as an EXACT top-level entry — a
  // proof/lane game keeps its editor-native authoring project under `authoring/`.
  // This is a single named allowance, NOT a relaxation: near-miss names like
  // `authoring-plugins/` or `Authoring/` still fail the whitelist below.
  'authoring',
]);

/** Canonical top-level files. */
export const ALLOWED_FILES = new Set([
  'game.config.ts',
  'index.html',
  'package.json',
  'tsconfig.json',
  'vite.config.ts',
  'vitest.config.ts',
  'playwright.config.ts',
  'capacitor.config.ts',
  'eslint.config.js',
  'README.md',
  '.gitignore',
]);

// Build/tooling artifacts that are gitignored and never committed. Their local
// presence after an install/build is not a violation, so they are skipped
// rather than whitelisted (they must not be committed either way).
const IGNORED_ARTIFACTS = new Set([
  'node_modules',
  'dist',
  'coverage',
  '.git',
  '.DS_Store',
  '.turbo',
]);

// entry name -> its correct home. Sourced from the conductor's approved ban list.
const REDIRECTS = new Map([
  ['scripts', 'repo tools/'],
  ['tools', 'repo tools/'],
  ['marketing', 'repo docs/marketing'],
  ['todos', 'Trello'],
  ['pipeline', 'packages/services or its own workspace'],
  ['adgen', 'its own workspace (not in-tree)'],
  ['analytics-dashboard', 'packages/services or its own workspace'],
  ['analytics-worker', 'packages/services'],
  ['backups', 'git history'],
  ['archive', 'git history'],
  ['archived_variants', 'git history'],
  ['keys', 'never in-tree — use a secrets manager'],
  ['references', 'refs/ or design/assets'],
  ['REFERENCES', 'refs/ or design/assets'],
  ['demo-assets', 'design/assets or public/'],
  ['test-results', 'gitignored build output'],
]);

const SECRET_HOME = 'never in-tree — use a secrets manager';
const DEFAULT_HOME =
  'not an allowed top-level game entry — see games/_template for the canonical structure';

// Generated Capacitor native shells. Legitimate at a game's top level ONLY when
// gitignored (cap-generated, never committed; committed inputs live in
// native-resources/). See conductor comment + the marble_run ios/ shell case.
const NATIVE_SHELLS = new Set(['ios', 'android']);
const NATIVE_HOME =
  'generated native shell — gitignore it (cap-generated); commit native inputs to native-resources/';

/** Name the correct home for a disallowed entry. */
function redirectFor(name) {
  if (REDIRECTS.has(name)) return REDIRECTS.get(name);
  if (name.endsWith('.p8') || name.endsWith('.mobileprovision')) return SECRET_HOME;
  if (name === '.env' || name.startsWith('.env.')) return SECRET_HOME;
  if (name.includes('archive') || name.includes('backup')) return 'git history';
  return DEFAULT_HOME;
}

/**
 * True if the root `.gitignore` has an active rule mentioning `.work`. A
 * deterministic text check (not full gitignore-semantics): the whole point is
 * "is scratch ignored", and the repo's rule is a games glob ending in .work.
 */
function workIsGitignored(root) {
  const text = readText(join(root, '.gitignore'));
  return text.split('\n').some((raw) => {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('!')) return false;
    return line.includes('.work');
  });
}

/**
 * Deterministic `.gitignore`-text check (conductor Q1): is `relDir` (a repo-
 * relative, forward-slash dir path like `games/marble_run/ios`) covered by an
 * active gitignore rule? Mirrors the workIsGitignored precedent — pure text, no
 * `git ls-files` shell-out, so it can't detect a force-added tracked-but-ignored
 * file (acceptable: the ban is "don't commit", the gitignore line is the
 * committed statement of that policy, and diff review owns a force-add). A
 * gitignore glob is translated to a regex: `**` → any depth, `*` → one segment.
 */
function gitignoreCoversDir(root, relDir) {
  const text = readText(join(root, '.gitignore'));
  return text.split('\n').some((raw) => {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('!')) return false;
    // Normalize the three ways a rule ignores a dir to the bare dir path: a dir
    // rule (`ios/`), and the contents-ignore forms (`ios/*`, `ios/**`) — the
    // latter mean "everything inside is ignored", which for our purpose (is this
    // native shell gitignored) is the same as ignoring the dir.
    const pat = line.replace(/\/\*\*?$/, '').replace(/\/+$/, '');
    const re = new RegExp(
      '^' +
        pat
          .split('/')
          .map((seg) =>
            seg === '**'
              ? '.*'
              : seg.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*'),
          )
          .join('/') +
        '$',
    );
    return re.test(relDir);
  });
}

/**
 * @param {string} root
 * @returns {{violations: Array<{game:string,entry:string,home:string}>}}
 */
export function lintStructure(root) {
  const violations = [];
  const workOk = workIsGitignored(root);

  for (const gameDir of listDirs(join(root, 'games'))) {
    const game = rel(root, gameDir);
    let entries;
    try {
      entries = readdirSync(gameDir, { withFileTypes: true });
    } catch {
      continue;
    }

    let hasWork = false;
    for (const entry of entries) {
      const name = entry.name;
      if (IGNORED_ARTIFACTS.has(name)) continue;
      const isDir = entry.isDirectory();
      if (name === '.work') hasWork = true;

      // Generated native shell: allowed iff gitignored, violation if committed.
      if (isDir && NATIVE_SHELLS.has(name)) {
        if (gitignoreCoversDir(root, `${game}/${name}`)) continue;
        violations.push({ game, entry: `${name}/`, home: NATIVE_HOME });
        continue;
      }

      const allowed = isDir ? ALLOWED_DIRS.has(name) : ALLOWED_FILES.has(name);
      if (allowed) continue;

      violations.push({ game, entry: isDir ? `${name}/` : name, home: redirectFor(name) });
    }

    if (hasWork && !workOk) {
      violations.push({ game, entry: '.work/', home: 'must be gitignored (agent scratch)' });
    }
  }

  return { violations };
}
