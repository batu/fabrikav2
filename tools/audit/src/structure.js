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
