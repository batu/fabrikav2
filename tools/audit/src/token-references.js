// Linter 10 - token-references (ERROR).
//
// Every CSS var() reference in packages/ui and games/*/{src,design} must either
// name a custom property defined by the UI kit defaults, that game's CSS token
// surface, or local scanned CSS declarations, or provide its own fallback.
// Missing no-fallback vars invalidate the whole CSS value and can silently erase
// visible paint, so this is a hard audit error.

import { join } from 'node:path';
import { listDirs, readText, rel, walkFiles } from './lib.js';

const CSS_EXTS = ['.css'];
const CUSTOM_PROP_RE = /(--[A-Za-z0-9_-]+)\s*:/g;
const VAR_FN_RE = /\bvar\s*\(/gi;
const VAR_NAME_RE = /^--[A-Za-z0-9_-]+/;

function commentBlankedCss(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (comment) =>
    comment
      .split('\n')
      .map((line, index) => (index === 0 ? '' : '\n') + ' '.repeat(line.length))
      .join(''),
  );
}

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (text[i] === '\n') line++;
  return line;
}

function cssFiles(dir) {
  return walkFiles(dir, { exts: CSS_EXTS }).sort();
}

function collectDefinitions(files) {
  const definitions = new Set();
  for (const file of files) {
    const text = commentBlankedCss(readText(file));
    for (const match of text.matchAll(CUSTOM_PROP_RE)) definitions.add(match[1]);
  }
  return definitions;
}

function findVarEnd(text, argsStart) {
  let depth = 1;
  let quote = null;
  let escaped = false;

  for (let i = argsStart; i < text.length; i++) {
    const char = text[i];

    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === '(') depth++;
    else if (char === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }

  return -1;
}

function hasTopLevelFallback(args, nameEnd) {
  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let i = nameEnd; i < args.length; i++) {
    const char = args[i];

    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === '(') depth++;
    else if (char === ')') depth = Math.max(0, depth - 1);
    else if (char === ',' && depth === 0) return true;
    else if (!/\s/.test(char) && depth === 0) return false;
  }

  return false;
}

function varReferences(root, file) {
  const text = commentBlankedCss(readText(file));
  const refs = [];
  let match;

  while ((match = VAR_FN_RE.exec(text))) {
    const argsStart = VAR_FN_RE.lastIndex;
    const argsEnd = findVarEnd(text, argsStart);
    if (argsEnd === -1) continue;

    const args = text.slice(argsStart, argsEnd);
    const leadingWhitespace = args.match(/^\s*/)[0].length;
    const nameMatch = args.slice(leadingWhitespace).match(VAR_NAME_RE);
    if (!nameMatch) {
      VAR_FN_RE.lastIndex = argsEnd + 1;
      continue;
    }

    const token = nameMatch[0];
    refs.push({
      file: rel(root, file),
      line: lineOf(text, match.index),
      token,
      hasFallback: hasTopLevelFallback(args, leadingWhitespace + token.length),
    });
    VAR_FN_RE.lastIndex = argsEnd + 1;
  }

  return refs;
}

function gameCssFiles(gameDir) {
  return [...cssFiles(join(gameDir, 'src')), ...cssFiles(join(gameDir, 'design'))];
}

function unresolvedRefs(root, scope, files, definitions, detailScope) {
  const violations = [];

  for (const file of files) {
    for (const ref of varReferences(root, file)) {
      if (ref.hasFallback || definitions.has(ref.token)) continue;
      violations.push({
        kind: 'unresolved-var',
        scope,
        token: ref.token,
        file: ref.file,
        line: ref.line,
        detail: `var(${ref.token}) has no fallback and no definition in ${detailScope}`,
      });
    }
  }

  return violations;
}

/**
 * @param {string} root
 * @returns {{violations: Array<object>}}
 */
export function lintTokenReferences(root) {
  const violations = [];
  const uiFiles = cssFiles(join(root, 'packages', 'ui'));
  const uiDefinitions = collectDefinitions(uiFiles);

  violations.push(
    ...unresolvedRefs(root, 'packages/ui', uiFiles, uiDefinitions, 'packages/ui CSS defaults'),
  );

  for (const gameDir of listDirs(join(root, 'games')).sort()) {
    const files = gameCssFiles(gameDir);
    const definitions = new Set([...uiDefinitions, ...collectDefinitions(files)]);
    const game = rel(root, gameDir);
    violations.push(
      ...unresolvedRefs(
        root,
        game,
        files,
        definitions,
        `packages/ui CSS defaults or ${game}/src|design CSS declarations`,
      ),
    );
  }

  return { violations };
}
