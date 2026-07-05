// Linter 1 — no-literals.
//
// Guardrail #2 (docs/architecture/v2-architecture.md): `packages/ui` and game
// shell code (`games/*/src/shell/**`) must be token-only — zero literal colors,
// user-facing copy, or asset paths. Design values live in `games/*/design/` and
// resolve through `--fab-*` CSS custom properties + injected copy/asset modules.
//
// Scope scanned: packages/ui/** and games/*/src/shell/**. Anything under a
// game's design/ dir is out of scope by construction (never in the scan set).
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

/** Collect the directories in scope for a given root. */
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
      const text = readText(file);
      const lines = text.split('\n');

      lines.forEach((line, idx) => {
        const lineNo = idx + 1;
        const add = (kind, value) => {
          if (allowlist.literals.has(value)) return;
          violations.push({ file: relPath, line: lineNo, kind, value });
        };

        for (const m of line.matchAll(HEX_RE)) add('color', m[0]);
        for (const m of line.matchAll(RGB_RE)) add('color', m[0]);

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

  return { violations };
}
