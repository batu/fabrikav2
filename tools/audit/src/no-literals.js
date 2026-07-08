// Linter 1 — no-literals.
//
// Guardrail #2 (docs/architecture/v2-architecture.md): `packages/ui` and game
// shell code (`games/*/src/shell/**`) must be token-only — zero literal colors,
// user-facing copy, or asset paths. Design values live in `games/*/design/` and
// resolve through `--fab-*` CSS custom properties + injected copy/asset modules.
//
// Scope scanned: packages/ui/**, games/*/src/shell/**, and each game's
// games/*/game.config.ts manifest (research 10 finding 9 — a config-specific
// copy-key rule; see lintGameConfigs). Anything under a game's design/ dir is
// out of scope by construction (never in the scan set).
//
// Three violation classes:
//   colors  — hex (#rgb/#rgba/#rrggbb/#rrggbbaa) and rgb()/rgba() literals.
//   copy    — quoted user-facing copy. HEURISTIC (documented): this repo is
//             JSX-free, so copy reaches the DOM through APIs. We flag a string
//             literal of >2 whitespace-separated words when it is assigned to /
//             passed to a DOM sink (textContent, innerText, innerHTML,
//             placeholder, title, alt, aria-* via setAttribute, createTextNode,
//             insertAdjacentHTML). >2 words avoids flagging identifiers/keys and
//             short tokens; real copy is phrases. Escape via the allowlist.
//   assets  — string literals ending in a known asset extension (png, svg,
//             mp3, glb, ...). Allowed only under games/*/design/, which is
//             outside the scan set, so any hit here is a violation.
//
// CSS TOKEN CARVE-OUT (conductor policy, card p9eS4dQf comment 3): `packages/ui`
// must ship neutral token defaults in .css (`:root { --fab-color-x: #... }`).
// A hex/rgb literal is PERMITTED in a .css file ONLY when it is the direct
// assigned value of a `--fab-*` custom-property declaration (property name
// matches /^--fab-[\w-]*$/, value not nested inside any function). Direct
// property values (`color: #fff`) AND var() fallbacks (`var(--fab-x, #fff)` —
// which silently fork the token system) remain violations. TS files never get
// this carve-out; there is no token layer there.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  walkFiles, readText, rel, listDirs, hasExt,
  ASSET_EXTS, SOURCE_EXTS, loadAllowlist, fileAllowed,
} from './lib.js';

const HEX_RE = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/g;
const RGB_RE = /\brgba?\s*\([^)]*\)/gi;

// DOM sinks that render user-visible text. Matches `.textContent =`,
// `.setAttribute('aria-label', ...)`, `createTextNode(...)`, etc.
const DOM_SINK_RE =
  /\.(?:textContent|innerText|innerHTML|outerHTML|placeholder|title|alt|label|ariaLabel)\s*=|\.(?:setAttribute|insertAdjacentHTML|insertAdjacentText)\s*\(|createTextNode\s*\(/;

// A quoted string literal (single, double, or template with no ${...}).
const STRING_LITERAL_RE = /(['"])((?:\\.|(?!\1).)*)\1|`([^`$\\]*)`/g;

/**
 * Collect the directories in scope for a given root: packages/ui and each
 * game's src/shell tree. The `games/<game>/src/shell/` path is the REAL, current
 * template layout — both games/_template/src/shell/ and games/marble_run/src/shell/
 * exist on disk (research 10 finding 9's worry that this path "may never match"
 * is stale-resolved; documented here so it is not re-litigated). Each game's
 * game.config.ts manifest is scanned separately (a single file, not a dir) by
 * lintGameConfigs — see below.
 */
function scanRoots(root) {
  const roots = [];
  const uiDir = join(root, 'packages', 'ui');
  roots.push(uiDir);
  for (const gameDir of listDirs(join(root, 'games'))) {
    roots.push(join(gameDir, 'src', 'shell'));
  }
  return roots;
}

function wordCount(s) {
  const t = s.trim();
  if (!t) return 0;
  return t.split(/\s+/).length;
}

const FAB_PROP_RE = /^--fab-[\w-]*$/;

/**
 * Is a color literal at `matchIndex` on a .css `line` a permitted `--fab-*`
 * token default? True only when it is the direct value of a `--fab-*`
 * declaration and not nested inside any function (e.g. a var() fallback).
 */
function isFabTokenDefault(line, matchIndex) {
  // Declaration = text from the previous statement/block boundary to the match.
  let declStart = 0;
  for (let i = matchIndex - 1; i >= 0; i--) {
    const c = line[i];
    if (c === '{' || c === '}' || c === ';') { declStart = i + 1; break; }
  }
  const decl = line.slice(declStart, matchIndex);
  const colon = decl.indexOf(':');
  if (colon === -1) return false; // literal isn't in a value position
  const prop = decl.slice(0, colon).trim();
  if (!FAB_PROP_RE.test(prop)) return false; // not a --fab-* token declaration
  // Value must be direct: no open function paren between the colon and the hit
  // (that's how var() fallbacks and other nested funcs stay violations).
  const value = decl.slice(colon + 1);
  let depth = 0;
  for (const c of value) {
    if (c === '(') depth++;
    else if (c === ')') depth = Math.max(0, depth - 1);
  }
  return depth === 0;
}

/**
 * @param {string} root  Absolute dir to scan (repo root, or a fixture root).
 * @param {object} [opts]
 * @param {string} [opts.allowlistPath]
 * @returns {{violations: Array<{file:string,line:number,kind:string,value:string}>}}
 */
export function lintNoLiterals(root, opts = {}) {
  const allowlist = loadAllowlist(opts.allowlistPath);
  const violations = [];

  for (const dir of scanRoots(root)) {
    for (const file of walkFiles(dir, { exts: [...SOURCE_EXTS, '.css'] })) {
      const relPath = rel(root, file);
      if (fileAllowed(allowlist, relPath)) continue;
      // Test fixtures legitimately assert literal values (e.g. computed-style
      // color checks); the token-discipline rule applies to shipped source only.
      if (/\.(test|spec)\.(ts|tsx|js|mjs)$/.test(file)) continue;
      const isCss = file.endsWith('.css');
      const text = readText(file);
      const lines = text.split('\n');

      lines.forEach((line, idx) => {
        const lineNo = idx + 1;
        const add = (kind, value) => {
          if (allowlist.literals.has(value)) return;
          violations.push({ file: relPath, line: lineNo, kind, value });
        };
        const addColor = (m) => {
          if (isCss && isFabTokenDefault(line, m.index)) return;
          add('color', m[0]);
        };

        for (const m of line.matchAll(HEX_RE)) addColor(m);
        for (const m of line.matchAll(RGB_RE)) addColor(m);

        const isDomSink = DOM_SINK_RE.test(line);
        for (const m of line.matchAll(STRING_LITERAL_RE)) {
          const value = m[2] !== undefined ? m[2] : m[3];
          if (value === undefined) continue;
          // asset path literal
          if (hasExt(value, ASSET_EXTS)) {
            add('asset', value);
            continue;
          }
          // user-facing copy heuristic
          if (isDomSink && wordCount(value) > 2) add('copy', value);
        }
      });
    }
  }

  lintGameConfigs(root, allowlist, violations);
  return { violations };
}

// A copy KEY: a dotted identifier like `game.title` (segments of word chars
// joined by dots, no whitespace) that references design/copy.ts. The sanctioned
// pattern — never flagged.
const COPY_KEY_RE = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/;

/**
 * Scan each game's game.config.ts for user-facing copy literals (research 10
 * finding 9). The declarative manifest must reference copy KEYS (design/copy.ts),
 * never raw user-facing strings — `title: "game.title" satisfies CopyKey` is the
 * sanctioned template pattern; `title: "Marble Run"` is the drift this catches.
 *
 * It has no DOM sinks, so the main scan's DOM-sink copy heuristic never fires
 * here. Config-specific rule: flag a MULTI-WORD (whitespace-containing) string
 * literal as likely user-facing copy. Single-token values pass — ids
 * (`marble_run`), screen names (`HomeMenu`), currency (`coins`), event ids
 * (`level_start`), and dotted copy keys — none contain whitespace. LIMITS
 * (documented): a single-word literal title (e.g. `"Tetris"`) evades this net —
 * the `satisfies CopyKey` typing in the template is the primary guard, this is
 * the secondary net; and a multi-word quoted phrase in a trailing inline comment
 * on a code line could false-positive (comment-only lines are skipped).
 *
 * WARN severity: it has a legit current hit (marble_run's `title: "Marble Run"`),
 * whose fix edits a game's copy module + shell — out of this audit card's blast
 * radius. Report + promote (conductor: checks with legit current hits land WARN).
 */
function lintGameConfigs(root, allowlist, violations) {
  for (const gameDir of listDirs(join(root, 'games'))) {
    const cfg = join(gameDir, 'game.config.ts');
    if (!existsSync(cfg)) continue;
    const relPath = rel(root, cfg);
    if (fileAllowed(allowlist, relPath)) continue;
    readText(cfg).split('\n').forEach((line, idx) => {
      const trimmed = line.trim();
      // Skip comment-only lines (line comments and block-comment bodies) so the
      // manifest's JSDoc/prose never trips the copy heuristic.
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
      for (const m of line.matchAll(STRING_LITERAL_RE)) {
        const value = m[2] !== undefined ? m[2] : m[3];
        if (value === undefined) continue;
        if (allowlist.literals.has(value)) continue;
        if (COPY_KEY_RE.test(value.trim())) continue; // sanctioned copy key
        if (wordCount(value) > 1) {
          violations.push({ file: relPath, line: idx + 1, kind: 'copy', value, severity: 'warn' });
        }
      }
    });
  }
}
