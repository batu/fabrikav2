// Linter 9 - token-consumers (WARN).
//
// Every generated game design token should have at least one static var()
// consumer in shared UI or that game's source. This catches design-sheet tokens
// that survive generation but no longer influence rendered code.

import { basename, join } from 'node:path';
import {
  listDirs,
  readJson,
  readText,
  rel,
  SOURCE_EXTS,
  stripComments,
  walkFiles,
} from './lib.js';

const TOKEN_RE = /^--fab-[A-Za-z0-9_-]+$/;
const TOKEN_DECL_RE = /(--fab-[A-Za-z0-9_-]+)\s*:\s*([^;{}]+);/g;
const VAR_RE = /var\(\s*(--fab-[A-Za-z0-9_-]+)/g;
const CONSUMER_EXTS = [...SOURCE_EXTS, '.css'];

function allowlistKey(game, token) {
  return `${game}::${token}`;
}

function isTestFile(relPath) {
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(relPath);
}

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

function varRefs(text) {
  const refs = new Set();
  for (const match of text.matchAll(VAR_RE)) refs.add(match[1]);
  return refs;
}

function extractTokenDefinitions(root, tokensPath) {
  const text = commentBlankedCss(readText(tokensPath));
  const tokens = new Map();
  for (const match of text.matchAll(TOKEN_DECL_RE)) {
    tokens.set(match[1], {
      token: match[1],
      value: match[2].trim().replace(/\s+/g, ' '),
      file: rel(root, tokensPath),
      line: lineOf(text, match.index),
    });
  }
  return tokens;
}

function consumerFiles(root, gameDir) {
  const roots = [join(root, 'packages', 'ui'), join(gameDir, 'src')];
  const files = [];
  for (const dir of roots) files.push(...walkFiles(dir, { exts: CONSUMER_EXTS }));
  return files.filter((file) => !isTestFile(rel(root, file)));
}

function directConsumers(root, gameDir) {
  const consumed = new Set();
  for (const file of consumerFiles(root, gameDir)) {
    const text = stripComments(readText(file));
    for (const token of varRefs(text)) consumed.add(token);
  }
  return consumed;
}

function liveTokens(tokens, consumed) {
  const live = new Set();
  const queue = [];
  for (const token of consumed) {
    if (!tokens.has(token)) continue;
    live.add(token);
    queue.push(token);
  }

  while (queue.length) {
    const token = queue.shift();
    for (const ref of varRefs(tokens.get(token).value)) {
      if (!tokens.has(ref) || live.has(ref)) continue;
      live.add(ref);
      queue.push(ref);
    }
  }

  return live;
}

function invalidAllowlistEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return 'entry must be an object with game, token, and reason';
  }
  if (typeof entry.game !== 'string' || entry.game.trim() === '') {
    return 'entry requires a non-empty game';
  }
  if (typeof entry.token !== 'string' || !TOKEN_RE.test(entry.token)) {
    return 'entry requires a --fab-* token';
  }
  if (typeof entry.reason !== 'string' || entry.reason.trim() === '') {
    return 'entry requires a non-empty reason';
  }
  return '';
}

function loadOrphanAllowlist(path) {
  const data = path ? readJson(path) : null;
  const raw = Array.isArray(data?.orphanTokens) ? data.orphanTokens : [];
  const valid = new Map();
  const invalid = [];

  raw.forEach((entry, index) => {
    const detail = invalidAllowlistEntry(entry);
    if (detail) {
      invalid.push({
        kind: 'invalid-allowlist',
        game: typeof entry?.game === 'string' && entry.game.trim() ? entry.game : '<missing>',
        token: typeof entry?.token === 'string' && entry.token.trim() ? entry.token : '<missing>',
        detail: `orphanTokens[${index}]: ${detail}`,
        severity: 'warn',
      });
      return;
    }
    valid.set(allowlistKey(entry.game.trim(), entry.token), {
      game: entry.game.trim(),
      token: entry.token,
      reason: entry.reason.trim(),
    });
  });

  return { valid, invalid };
}

/**
 * @param {string} root
 * @param {object} [opts]
 * @param {string} [opts.allowlistPath]
 * @returns {{violations: Array<object>}}
 */
export function lintTokenConsumers(root, opts = {}) {
  const allowlist = loadOrphanAllowlist(opts.allowlistPath);
  const violations = [...allowlist.invalid];
  const seen = new Map();

  for (const gameDir of listDirs(join(root, 'games'))) {
    const gameName = basename(gameDir);
    const game = rel(root, gameDir);
    const tokensPath = join(gameDir, 'design', 'tokens.css');
    const tokens = extractTokenDefinitions(root, tokensPath);
    if (tokens.size === 0) continue;

    const live = liveTokens(tokens, directConsumers(root, gameDir));
    for (const token of tokens.keys()) {
      const key = allowlistKey(gameName, token);
      seen.set(key, { live: live.has(token), game, token });
    }

    for (const definition of tokens.values()) {
      if (live.has(definition.token)) continue;
      if (allowlist.valid.has(allowlistKey(gameName, definition.token))) continue;
      violations.push({
        kind: 'orphaned-token',
        game,
        token: definition.token,
        file: definition.file,
        line: definition.line,
        detail: `orphaned token has no var() consumer in packages/ui or ${game}/src`,
        severity: 'warn',
      });
    }
  }

  for (const entry of allowlist.valid.values()) {
    const seenEntry = seen.get(allowlistKey(entry.game, entry.token));
    if (!seenEntry) {
      violations.push({
        kind: 'stale-allowlist',
        game: `games/${entry.game}`,
        token: entry.token,
        detail: 'allowlist entry does not match a defined token',
        severity: 'warn',
      });
    } else if (seenEntry.live) {
      violations.push({
        kind: 'stale-allowlist',
        game: seenEntry.game,
        token: entry.token,
        detail: 'allowlist entry is no longer needed because the token has a consumer',
        severity: 'warn',
      });
    }
  }

  return { violations };
}
