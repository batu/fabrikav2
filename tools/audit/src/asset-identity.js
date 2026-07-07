// Linter 7 - asset identity.
//
// A covered game commits design/asset-identity.json. The manifest maps shipped
// design/assets/* bytes to repo-resolvable reference bytes, documents known
// intentional differences, covers emoji glyphs used as art stand-ins, and pins
// reference font metrics against design tokens.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';
import { decodePng } from '../../refcap-compare/src/png.mjs';
import {
  DUP_THRESHOLD,
  digest,
  distance,
  signature,
} from '../../refcap-compare/src/phash.mjs';
import { ASSET_EXTS, listDirs, readJson, readText, rel, stripComments, walkFiles } from './lib.js';

const MANIFEST_REL = 'design/asset-identity.json';
const DEFAULT_METRICS_REL = 'design/reference-metrics.json';
const MODES = new Set(['exact-bytes', 'perceptual', 'intentionally-different']);
const EMOJI_RE = /\p{Extended_Pictographic}/u;

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function inRepo(root, path) {
  const r = relative(root, path);
  return r === '' || (!r.startsWith('..') && !r.split(sep).includes('..'));
}

function coverageIsComplete(manifest) {
  return manifest.coverage === 'complete' || manifest.complete === true;
}

function add(violations, manifest, fields, { warnWhenIncomplete = true, severity } = {}) {
  const violation = { ...fields };
  if (severity) violation.severity = severity;
  else if (warnWhenIncomplete && !coverageIsComplete(manifest)) violation.severity = 'warn';
  violations.push(violation);
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function normalizeAssetKey(key) {
  if (key.startsWith('assets/')) return `design/${key}`;
  return key;
}

function resolveRepoPath(root, gameDir, raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const path = raw.trim();
  if (path.startsWith('/') || path.startsWith('./') || path.startsWith('../')) {
    return resolve(gameDir, path);
  }
  if (
    path.startsWith('games/') ||
    path.startsWith('packages/') ||
    path.startsWith('tools/') ||
    path.startsWith('docs/')
  ) {
    return resolve(root, path);
  }
  return resolve(gameDir, path);
}

function expectationOf(entry) {
  return entry.expectation || entry.mode;
}

function sourceOf(entry) {
  return entry.source || entry.canonicalSource;
}

function referenceOf(entry) {
  return sourceOf(entry) || entry.reference || '';
}

function reasonOf(entry) {
  return typeof entry.reason === 'string' ? entry.reason.trim() : '';
}

function validateMode(violations, manifest, base, entry) {
  const expectation = expectationOf(entry);
  if (!MODES.has(expectation)) {
    add(
      violations,
      manifest,
      {
        ...base,
        kind: 'INVALID-MANIFEST',
        expectation: expectation || '<missing>',
        detail: `expectation must be one of ${Array.from(MODES).join(', ')}`,
      },
      { warnWhenIncomplete: false },
    );
    return null;
  }
  return expectation;
}

function validateIntentionalDifference(violations, manifest, base, entry) {
  if (!reasonOf(entry)) {
    add(
      violations,
      manifest,
      {
        ...base,
        kind: 'INVALID-MANIFEST',
        expectation: 'intentionally-different',
        detail: 'intentionally-different entries require a non-empty reason',
      },
      { warnWhenIncomplete: false },
    );
    return;
  }
  add(
    violations,
    manifest,
    {
      ...base,
      kind: 'INTENTIONAL-DIFFERENCE',
      expectation: 'intentionally-different',
      detail: reasonOf(entry),
    },
    { severity: 'warn' },
  );
}

function compareExact(violations, manifest, base, shippedPath, sourcePath) {
  const shippedHash = sha256(shippedPath);
  const sourceHash = sha256(sourcePath);
  if (shippedHash !== sourceHash) {
    add(violations, manifest, {
      ...base,
      kind: 'DIVERGENT',
      expectation: 'exact-bytes',
      expectedHash: sourceHash.slice(0, 12),
      actualHash: shippedHash.slice(0, 12),
      detail: 'byte hash mismatch',
    });
  }
}

function comparePerceptual(violations, manifest, base, shippedPath, sourcePath, entry) {
  if (extname(shippedPath).toLowerCase() !== '.png' || extname(sourcePath).toLowerCase() !== '.png') {
    add(
      violations,
      manifest,
      {
        ...base,
        kind: 'UNSUPPORTED-PERCEPTUAL',
        expectation: 'perceptual',
        detail: 'perceptual mode currently supports PNG only',
      },
      { warnWhenIncomplete: false },
    );
    return;
  }

  let actual;
  let expected;
  try {
    actual = signature(decodePng(readFileSync(shippedPath)));
    expected = signature(decodePng(readFileSync(sourcePath)));
  } catch (err) {
    add(
      violations,
      manifest,
      {
        ...base,
        kind: 'UNSUPPORTED-PERCEPTUAL',
        expectation: 'perceptual',
        detail: err.message,
      },
      { warnWhenIncomplete: false },
    );
    return;
  }

  const maxDistance =
    typeof entry.maxDistance === 'number'
      ? entry.maxDistance
      : typeof entry.threshold === 'number'
        ? entry.threshold
        : DUP_THRESHOLD;
  const measured = distance(actual, expected);
  if (measured > maxDistance) {
    add(violations, manifest, {
      ...base,
      kind: 'DIVERGENT',
      expectation: 'perceptual',
      distance: Number(measured.toFixed(3)),
      maxDistance,
      expectedHash: digest(expected),
      actualHash: digest(actual),
      detail: `perceptual distance ${measured.toFixed(3)} > ${maxDistance}`,
    });
  }
}

function validateSource(violations, manifest, root, gameDir, base, entry) {
  const source = sourceOf(entry);
  const sourcePath = resolveRepoPath(root, gameDir, source);
  if (!sourcePath) {
    add(
      violations,
      manifest,
      { ...base, kind: 'INVALID-MANIFEST', detail: 'entry requires a source path' },
      { warnWhenIncomplete: false },
    );
    return null;
  }
  if (!inRepo(root, sourcePath)) {
    add(
      violations,
      manifest,
      { ...base, kind: 'SOURCE-OUTSIDE-REPO', source, detail: 'source must resolve inside repo' },
      { warnWhenIncomplete: false },
    );
    return null;
  }
  if (!existsSync(sourcePath)) {
    add(
      violations,
      manifest,
      { ...base, kind: 'SOURCE-MISSING', source, detail: 'source file does not exist' },
      { warnWhenIncomplete: false },
    );
    return null;
  }
  return sourcePath;
}

function lintAssetEntry(violations, manifest, root, gameDir, game, assetKey, shippedPath, entry) {
  const base = {
    game,
    entry: assetKey,
    source: referenceOf(entry),
  };
  if (!isPlainObject(entry)) {
    add(
      violations,
      manifest,
      { ...base, kind: 'INVALID-MANIFEST', detail: 'asset entry must be an object' },
      { warnWhenIncomplete: false },
    );
    return;
  }

  const expectation = validateMode(violations, manifest, base, entry);
  if (!expectation) return;
  if (expectation === 'intentionally-different') {
    validateIntentionalDifference(violations, manifest, base, entry);
    return;
  }

  const sourcePath = validateSource(violations, manifest, root, gameDir, base, entry);
  if (!sourcePath) return;
  if (expectation === 'exact-bytes') {
    compareExact(violations, manifest, base, shippedPath, sourcePath);
  } else if (expectation === 'perceptual') {
    comparePerceptual(violations, manifest, base, shippedPath, sourcePath, entry);
  }
}

function manifestAssetEntries(manifest) {
  const raw = isPlainObject(manifest.assets) ? manifest.assets : {};
  const out = new Map();
  for (const [key, entry] of Object.entries(raw)) out.set(normalizeAssetKey(key), entry);
  return out;
}

function decodeStringLiteral(raw) {
  try {
    return JSON.parse(`"${raw.replace(/"/g, '\\"')}"`);
  } catch {
    return raw;
  }
}

function copyGlyphs(root, gameDir) {
  const copyPath = join(gameDir, 'design', 'copy.ts');
  const text = stripComments(readText(copyPath));
  if (!text) return [];
  const out = [];
  const pairRe = /['"]([^'"]+)['"]\s*:\s*(['"])((?:\\.|(?!\2).)*)\2/gs;
  for (const match of text.matchAll(pairRe)) {
    const key = match[1];
    const value = decodeStringLiteral(match[3]);
    if (EMOJI_RE.test(value)) {
      out.push({
        key: `copy:${key}`,
        copyKey: key,
        value,
        file: rel(root, copyPath),
      });
    }
  }
  return out;
}

function lintGlyphs(violations, manifest, game, glyphEntries, glyphs) {
  for (const glyph of glyphs) {
    const entry = glyphEntries[glyph.key];
    const base = {
      game,
      entry: glyph.key,
      source: entry ? referenceOf(entry) : '',
      value: glyph.value,
      file: glyph.file,
    };
    if (!entry) {
      add(violations, manifest, {
        ...base,
        kind: 'GLYPH-VS-ASSET',
        expectation: '<missing>',
        detail: 'emoji/pictographic copy value must be mapped as asset identity',
      });
      continue;
    }
    if (!isPlainObject(entry)) {
      add(
        violations,
        manifest,
        { ...base, kind: 'INVALID-MANIFEST', detail: 'glyph entry must be an object' },
        { warnWhenIncomplete: false },
      );
      continue;
    }
    const expectation = validateMode(violations, manifest, base, entry);
    if (!expectation) continue;
    if (expectation === 'intentionally-different') {
      validateIntentionalDifference(violations, manifest, base, entry);
    }
  }
}

function cssTokens(path) {
  const text = stripComments(readText(path));
  const tokens = new Map();
  const tokenRe = /(--fab-[A-Za-z0-9_-]+)\s*:\s*([^;]+);/g;
  for (const match of text.matchAll(tokenRe)) {
    tokens.set(match[1], match[2].trim().replace(/\s+/g, ' '));
  }
  return tokens;
}

function expectedMetricValue(spec) {
  if (typeof spec === 'string') return spec;
  if (isPlainObject(spec) && typeof spec.expected === 'string') return spec.expected;
  if (isPlainObject(spec) && typeof spec.value === 'string') return spec.value;
  return '';
}

function metricKind(token, spec) {
  if (isPlainObject(spec) && typeof spec.kind === 'string') return spec.kind;
  if (token.includes('font-family')) return 'font-family';
  if (token.includes('font')) return 'font-size';
  return 'font';
}

function normalizeCssValue(value) {
  return value.trim().replace(/\s+/g, ' ');
}

function lintReferenceMetrics(violations, manifest, root, gameDir, game) {
  const metricsRel = manifest.referenceMetrics || (manifest.fontMetrics ? manifest.fontMetrics : null);
  const metricsPath = metricsRel
    ? resolveRepoPath(root, gameDir, metricsRel)
    : existsSync(join(gameDir, DEFAULT_METRICS_REL))
      ? join(gameDir, DEFAULT_METRICS_REL)
      : null;
  if (!metricsPath) return;

  if (!inRepo(root, metricsPath) || !existsSync(metricsPath)) {
    add(
      violations,
      manifest,
      {
        game,
        entry: metricsRel || DEFAULT_METRICS_REL,
        kind: 'REFERENCE-METRICS-MISSING',
        source: metricsRel || DEFAULT_METRICS_REL,
        detail: 'reference metrics file is missing',
      },
      { warnWhenIncomplete: false },
    );
    return;
  }

  const metrics = readJson(metricsPath);
  const metricTokens = metrics && isPlainObject(metrics.tokens) ? metrics.tokens : null;
  if (!metricTokens) {
    add(
      violations,
      manifest,
      {
        game,
        entry: rel(root, metricsPath),
        kind: 'INVALID-MANIFEST',
        source: rel(root, metricsPath),
        detail: 'reference metrics requires a tokens object',
      },
      { warnWhenIncomplete: false },
    );
    return;
  }

  const tokens = cssTokens(join(gameDir, 'design', 'tokens.css'));
  for (const [token, spec] of Object.entries(metricTokens)) {
    const expected = expectedMetricValue(spec);
    const base = {
      game,
      entry: token,
      kind: 'FONT-METRIC-MISMATCH',
      expectation: metricKind(token, spec),
      source: rel(root, metricsPath),
    };
    if (!expected) {
      add(
        violations,
        manifest,
        { ...base, kind: 'INVALID-MANIFEST', detail: 'font metric requires expected/value' },
        { warnWhenIncomplete: false },
      );
      continue;
    }
    if (!tokens.has(token)) {
      add(violations, manifest, {
        ...base,
        kind: 'FONT-METRIC-MISSING',
        detail: `token missing, expected ${expected}`,
      });
      continue;
    }
    const actual = tokens.get(token);
    if (normalizeCssValue(actual) !== normalizeCssValue(expected)) {
      add(violations, manifest, {
        ...base,
        expected,
        actual,
        detail: `expected ${expected}, got ${actual}`,
      });
    }
  }
}

/**
 * @param {string} root
 * @returns {{violations: Array<object>}}
 */
export function lintAssetIdentity(root) {
  const violations = [];
  for (const gameDir of listDirs(join(root, 'games'))) {
    const manifestPath = join(gameDir, MANIFEST_REL);
    if (!existsSync(manifestPath)) continue;

    const game = rel(root, gameDir);
    const manifest = readJson(manifestPath);
    if (!isPlainObject(manifest)) {
      violations.push({
        game,
        entry: MANIFEST_REL,
        kind: 'INVALID-MANIFEST',
        source: MANIFEST_REL,
        detail: 'manifest is missing or invalid JSON',
      });
      continue;
    }

    const entries = manifestAssetEntries(manifest);
    const shipped = walkFiles(join(gameDir, 'design', 'assets'), { exts: ASSET_EXTS });
    const shippedKeys = new Set();
    for (const shippedPath of shipped) {
      const assetKey = rel(gameDir, shippedPath);
      shippedKeys.add(assetKey);
      const entry = entries.get(assetKey);
      if (!entry) {
        add(violations, manifest, {
          game,
          entry: assetKey,
          kind: 'MISSING-MAPPING',
          expectation: '<missing>',
          source: '',
          detail: 'shipped design asset has no asset-identity entry',
        });
        continue;
      }
      lintAssetEntry(violations, manifest, root, gameDir, game, assetKey, shippedPath, entry);
    }

    for (const key of entries.keys()) {
      if (key.startsWith('design/assets/') && !shippedKeys.has(key)) {
        add(violations, manifest, {
          game,
          entry: key,
          kind: 'MISSING-SHIPPED-ASSET',
          expectation: '<missing>',
          source: sourceOf(entries.get(key)) || '',
          detail: 'manifest entry points at a shipped asset that does not exist',
        });
      }
    }

    const glyphEntries = isPlainObject(manifest.glyphs) ? manifest.glyphs : {};
    lintGlyphs(violations, manifest, game, glyphEntries, copyGlyphs(root, gameDir));
    lintReferenceMetrics(violations, manifest, root, gameDir, game);
  }

  return { violations };
}
