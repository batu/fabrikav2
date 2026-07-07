// Linter 8 - refs-lint.
//
// Every committed capture under games/<game>/refs/captures/ must be documented
// in games/<game>/refs/manifest.yaml under a top-level `refs:` mapping. The
// manifest entry is the machine-readable provenance contract for reference
// images: state variant, capture recipe, at-rest safety, and provenance.

import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { parseYaml } from '../../refcap-compare/src/yaml.mjs';
import { listDirs, readText, rel, walkFiles } from './lib.js';

const CAPTURE_EXTS = ['.png', '.jpg', '.jpeg', '.webp'];
const REQUIRED_FIELDS = ['state-variant', 'capture-recipe', 'at-rest', 'provenance'];
const FALSE_AT_REST_FIELDS = ['not-at-rest-reason', 'recapture-note'];

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeRel(path) {
  return path.replace(/\\/g, '/').replace(/^\.\//, '');
}

function isCaptureImage(path) {
  return CAPTURE_EXTS.includes(extname(path).toLowerCase());
}

function add(violations, fields) {
  violations.push(fields);
}

function loadRefsManifest(gameDir) {
  const manifestPath = join(gameDir, 'refs', 'manifest.yaml');
  if (!existsSync(manifestPath)) return null;
  try {
    return parseYaml(readText(manifestPath));
  } catch (err) {
    return { __parseError: err.message };
  }
}

function captureFiles(gameDir) {
  return walkFiles(join(gameDir, 'refs', 'captures'), { exts: CAPTURE_EXTS })
    .filter(isCaptureImage)
    .map((file) => normalizeRel(rel(gameDir, file)))
    .sort();
}

function entryMap(manifest) {
  if (!isPlainObject(manifest?.refs)) return new Map();
  return new Map(Object.entries(manifest.refs).map(([key, value]) => [normalizeRel(key), value]));
}

function validateStringField(violations, base, entry, field) {
  if (typeof entry[field] !== 'string' || entry[field].trim() === '') {
    add(violations, {
      ...base,
      kind: entry[field] == null ? 'MISSING-FIELD' : 'INVALID-FIELD',
      field,
      detail: `${field} must be a non-empty string`,
    });
  }
}

function validateProvenance(violations, base, provenance) {
  if (!isPlainObject(provenance)) {
    add(violations, {
      ...base,
      kind: provenance == null ? 'MISSING-FIELD' : 'INVALID-FIELD',
      field: 'provenance',
      detail: 'provenance must be a mapping',
    });
    return;
  }

  const checks = [
    ['package', (p) => typeof p.package === 'string' && p.package.trim() !== ''],
    ['device|lane', (p) =>
      (typeof p.device === 'string' && p.device.trim() !== '') ||
      (typeof p.lane === 'string' && p.lane.trim() !== '')],
    ['host|tool', (p) =>
      (typeof p.host === 'string' && p.host.trim() !== '') ||
      (typeof p.tool === 'string' && p.tool.trim() !== '')],
    ['captured', (p) => typeof p.captured === 'string' && p.captured.trim() !== ''],
  ];
  for (const [field, ok] of checks) {
    if (!ok(provenance)) {
      add(violations, {
        ...base,
        kind: 'MISSING-FIELD',
        field: `provenance.${field}`,
        detail: `provenance requires ${field}`,
      });
    }
  }
}

function validateRefEntry(violations, gameDir, game, entryPath, entry) {
  const base = { game, entry: entryPath };
  if (!entryPath.startsWith('refs/captures/')) {
    add(violations, {
      ...base,
      kind: 'INVALID-PATH',
      detail: 'refs entries must point under refs/captures/',
    });
  }
  if (!isCaptureImage(entryPath)) {
    add(violations, {
      ...base,
      kind: 'INVALID-PATH',
      detail: `refs entries must use one of ${CAPTURE_EXTS.join(', ')}`,
    });
  }

  const abs = join(gameDir, entryPath);
  if (!existsSync(abs)) {
    add(violations, {
      ...base,
      kind: 'STALE-ENTRY',
      detail: 'manifest entry points at a missing capture file',
    });
  }

  if (!isPlainObject(entry)) {
    add(violations, {
      ...base,
      kind: 'INVALID-ENTRY',
      detail: 'refs entry must be a mapping',
    });
    return;
  }

  for (const field of REQUIRED_FIELDS) {
    if (!Object.hasOwn(entry, field)) {
      add(violations, {
        ...base,
        kind: 'MISSING-FIELD',
        field,
        detail: `${field} is required`,
      });
    }
  }
  validateStringField(violations, base, entry, 'state-variant');
  validateStringField(violations, base, entry, 'capture-recipe');
  if (typeof entry['at-rest'] !== 'boolean') {
    add(violations, {
      ...base,
      kind: entry['at-rest'] == null ? 'MISSING-FIELD' : 'INVALID-FIELD',
      field: 'at-rest',
      detail: 'at-rest must be a boolean',
    });
  }
  validateProvenance(violations, base, entry.provenance);

  if (entry['at-rest'] === false) {
    for (const field of FALSE_AT_REST_FIELDS) {
      validateStringField(violations, base, entry, field);
    }
  }
}

/**
 * @param {string} root
 * @returns {{violations: Array<{game:string,entry:string,kind:string,field?:string,detail:string}>}}
 */
export function lintRefs(root) {
  const violations = [];

  for (const gameDir of listDirs(join(root, 'games'))) {
    const game = rel(root, gameDir);
    const captures = captureFiles(gameDir);
    const manifest = loadRefsManifest(gameDir);

    if (!manifest && captures.length === 0) continue;
    if (!manifest) {
      add(violations, {
        game,
        entry: 'refs/manifest.yaml',
        kind: 'MISSING-MANIFEST',
        detail: 'capture files exist but refs/manifest.yaml is missing',
      });
      continue;
    }
    if (manifest.__parseError) {
      add(violations, {
        game,
        entry: 'refs/manifest.yaml',
        kind: 'INVALID-MANIFEST',
        detail: manifest.__parseError,
      });
      continue;
    }

    const refs = entryMap(manifest);
    for (const capture of captures) {
      if (!refs.has(capture)) {
        add(violations, {
          game,
          entry: capture,
          kind: 'MISSING-ENTRY',
          detail: 'capture file has no refs manifest entry',
        });
      }
    }
    for (const [entryPath, entry] of refs) {
      validateRefEntry(violations, gameDir, game, entryPath, entry);
    }
  }

  return { violations };
}
