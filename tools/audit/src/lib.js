// Shared helpers + constants for the tools/audit linters.
//
// One home for every value the three linters would otherwise each hardcode
// (directory names to skip, source extensions, the @fabrikav2 scope, import
// regexes). Keeping them here is the whole point of this card's title: no
// literal-value duplication across the linters themselves.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The workspace package scope this monorepo publishes under. */
export const SCOPE = '@fabrikav2';

/** Directories never worth walking into for any linter. */
export const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.git',
  // Test scaffolding: fixture trees deliberately contain violations, so a
  // linter walking the real repo must never descend into them and self-trip.
  'test',
  'tests',
  '__tests__',
  'fixtures',
  '__fixtures__',
]);

/** Source extensions the linters read. */
export const SOURCE_EXTS = ['.ts', '.tsx', '.js', '.mjs', '.cts', '.mts'];

/** Extensions treated as design assets when they appear as string literals. */
export const ASSET_EXTS = [
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif',
  '.mp3', '.wav', '.ogg', '.m4a',
  '.mp4', '.webm',
  '.woff', '.woff2', '.ttf', '.otf',
  '.glb', '.gltf', '.json', '.atlas',
];

/** Repo root inferred from this file's location (tools/audit/src/lib.js). */
export function repoRoot() {
  const here = fileURLToPath(import.meta.url);
  // src/lib.js -> src -> audit -> tools -> repo root
  return join(here, '..', '..', '..', '..');
}

/** True when `name` (a file basename) has one of the given extensions. */
export function hasExt(name, exts) {
  const lower = name.toLowerCase();
  return exts.some((e) => lower.endsWith(e));
}

/**
 * Recursively collect files under `dir` (absolute), skipping SKIP_DIRS.
 * Returns absolute file paths. Missing dirs yield [].
 */
export function walkFiles(dir, { exts } = {}) {
  const out = [];
  if (!existsSync(dir)) return out;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        stack.push(full);
      } else if (entry.isFile()) {
        if (!exts || hasExt(entry.name, exts)) out.push(full);
      }
    }
  }
  return out;
}

/** List immediate subdirectories of `dir` (absolute paths). [] if missing. */
export function listDirs(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !SKIP_DIRS.has(e.name))
    .map((e) => join(dir, e.name));
}

/** Read + parse a JSON file; returns null on missing/invalid. */
export function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

export function readText(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

/** Repo-relative, forward-slash path for stable messages across platforms. */
export function rel(root, path) {
  return relative(root, path).split(sep).join('/');
}

/**
 * Enumerate workspace directories under `root` from the npm workspaces globs
 * in the root package.json. Only the two shapes this repo uses are supported:
 * a literal dir ("tools/audit") and a one-level glob ("packages/*").
 * Returns absolute dirs that actually contain a package.json.
 */
export function listWorkspaces(root) {
  const pkg = readJson(join(root, 'package.json'));
  const globs = (pkg && pkg.workspaces) || [];
  const dirs = [];
  for (const glob of globs) {
    if (glob.endsWith('/*')) {
      const base = join(root, glob.slice(0, -2));
      dirs.push(...listDirs(base));
    } else {
      dirs.push(join(root, glob));
    }
  }
  return dirs.filter((d) => existsSync(join(d, 'package.json')));
}

/**
 * Load an allowlist. Shape (all fields optional):
 *   { "literals": ["#fff"], "files": ["packages/ui/legacy.ts"] }
 * `literals` skips exact matched literal strings; `files` skips any repo-relative
 * path that contains one of the listed substrings. Returns a normalized object.
 */
export function loadAllowlist(path) {
  const empty = { literals: new Set(), files: [] };
  if (!path || !existsSync(path)) return empty;
  const data = readJson(path);
  if (!data) return empty;
  return {
    literals: new Set(Array.isArray(data.literals) ? data.literals : []),
    files: Array.isArray(data.files) ? data.files : [],
  };
}

/** True if `relPath` is covered by the allowlist's file substrings. */
export function fileAllowed(allowlist, relPath) {
  return allowlist.files.some((f) => relPath.includes(f));
}

/**
 * Extract the top-level named exports declared in a source file's text.
 * Covers the export shapes this codebase uses; `export default` and
 * `export * from` contribute no names (there is nothing to collide on).
 * `reExports` (default false) controls whether `export { x } from '...'`
 * re-export names are included.
 */
export function extractExportNames(text, { includeReExportsFromScope = true } = {}) {
  const names = new Set();
  // Strip comments only — string contents stay so `export {x} from '@scope/y'`
  // re-export sources remain readable. `export`-keyword-inside-a-string is rare
  // enough in source to ignore.
  const stripped = stripComments(text);

  // export const/let/var/function/class/type/interface/enum NAME
  const declRe =
    /\bexport\s+(?:default\s+)?(?:async\s+)?(?:const|let|var|function\*?|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g;
  for (const m of stripped.matchAll(declRe)) names.add(m[1]);

  // export { a, b as c } [from '...']
  const braceRe = /\bexport\s*\{([^}]*)\}(?:\s*from\s*['"]([^'"]+)['"])?/g;
  for (const m of stripped.matchAll(braceRe)) {
    const source = m[2];
    // Re-exports FROM a workspace package are re-uses, not reimplementations.
    if (source && source.startsWith(SCOPE) && !includeReExportsFromScope) continue;
    for (const part of m[1].split(',')) {
      const piece = part.trim();
      if (!piece) continue;
      const asMatch = piece.match(/\bas\s+([A-Za-z_$][\w$]*)/);
      const name = asMatch ? asMatch[1] : piece.split(/\s+/)[0];
      if (name && name !== 'default') names.add(name);
    }
  }
  return names;
}

/**
 * Remove line and block comments while preserving string/template literals
 * (their contents are needed to read import paths and re-export sources).
 * A char-scanner, not a full parser: it tracks string state so a `//` or `/*`
 * inside a string is not mistaken for a comment.
 */
export function stripComments(text) {
  let out = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    const next = text[i + 1];
    if (c === '/' && next === '/') {
      while (i < n && text[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out += quote;
      i++;
      while (i < n && text[i] !== quote) {
        if (text[i] === '\\') {
          out += text[i] + (text[i + 1] || '');
          i += 2;
          continue;
        }
        out += text[i];
        i++;
      }
      out += quote;
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}
