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
const PROVENANCE_SOURCES = ['shipped-capture', 'design-sheet', 'generated'];
const MS_PER_DAY = 24 * 60 * 60 * 1000;

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

function manifestStates(manifest) {
  if (!Array.isArray(manifest?.states)) return [];
  return manifest.states
    .filter((state) => isPlainObject(state) && typeof state.name === 'string' && state.name.trim() !== '')
    .map((state) => ({ ...state, name: state.name.trim() }));
}

function stateFromVariant(entry) {
  const variant = entry?.['state-variant'];
  if (typeof variant !== 'string') return null;
  const state = variant.split('/')[0].trim();
  return state || null;
}

function addCoverageRef(refsByState, state, path, entry) {
  if (!state) return;
  if (!refsByState.has(state)) refsByState.set(state, new Map());
  refsByState.get(state).set(path, entry);
}

function ageDays(captured, now) {
  if (typeof captured !== 'string') return null;
  const match = captured.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const capturedDate = new Date(Date.UTC(year, month - 1, day));
  if (
    capturedDate.getUTCFullYear() !== year ||
    capturedDate.getUTCMonth() !== month - 1 ||
    capturedDate.getUTCDate() !== day
  ) {
    return null;
  }

  const nowDate = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(nowDate.getTime())) return null;
  const nowDay = Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), nowDate.getUTCDate());
  return Math.floor((nowDay - capturedDate.getTime()) / MS_PER_DAY);
}

function ageLabelForEntries(entries, now) {
  if (entries.length === 0) return '-';
  const labels = new Set();
  for (const [, entry] of entries) {
    const days = ageDays(entry?.provenance?.captured, now);
    if (days == null) labels.add('unknown');
    else if (days < 0) labels.add('future');
    else labels.add(`${days}d`);
  }
  return [...labels].sort().join(',');
}

function sourceLabelForEntries(entries) {
  if (entries.length === 0) return '-';
  return [...new Set(entries.map(([, entry]) => entry?.provenance?.source || 'unknown'))].sort().join(',');
}

function coverageForGame(game, manifest, refs, now) {
  const states = manifestStates(manifest);
  const refsByState = new Map();

  for (const [path, entry] of refs) {
    if (!isPlainObject(entry)) continue;
    addCoverageRef(refsByState, stateFromVariant(entry), path, entry);
  }

  for (const state of states) {
    const offline = state.reference?.offline;
    if (typeof offline !== 'string') continue;
    const refPath = normalizeRel(offline);
    if (refs.has(refPath)) addCoverageRef(refsByState, state.name, refPath, refs.get(refPath));
  }

  return states.map((state) => {
    const entries = [...(refsByState.get(state.name)?.entries() ?? [])].sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return {
      game,
      state: state.name,
      refs: entries.length,
      provenance: sourceLabelForEntries(entries),
      age: ageLabelForEntries(entries, now),
      entries: entries.map(([path]) => path),
    };
  });
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

  if (!Object.hasOwn(provenance, 'source')) {
    add(violations, {
      ...base,
      kind: 'MISSING-FIELD',
      field: 'provenance.source',
      detail: `provenance.source is required (${PROVENANCE_SOURCES.join(', ')})`,
    });
  } else if (!PROVENANCE_SOURCES.includes(provenance.source)) {
    add(violations, {
      ...base,
      kind: 'INVALID-FIELD',
      field: 'provenance.source',
      detail: `provenance.source must be one of ${PROVENANCE_SOURCES.join(', ')}`,
    });
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
 * @returns {{
 *   violations: Array<{game:string,entry:string,kind:string,field?:string,detail:string,severity?:string}>,
 *   coverage: Array<{game:string,state:string,refs:number,provenance:string,age:string,entries:string[]}>,
 * }}
 */
export function lintRefs(root, { now = new Date() } = {}) {
  const violations = [];
  const coverage = [];

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
    if (manifestStates(manifest).length > 0 && refs.size === 0) {
      add(violations, {
        game,
        entry: 'refs/manifest.yaml',
        kind: 'NO-REFS',
        severity: 'warn',
        detail: 'manifest declares states but has no refs entries; reference scarcity is visible but non-failing',
      });
    }
    for (const [entryPath, entry] of refs) {
      validateRefEntry(violations, gameDir, game, entryPath, entry);
    }
    coverage.push(...coverageForGame(game, manifest, refs, now));
  }

  return { violations, coverage };
}
