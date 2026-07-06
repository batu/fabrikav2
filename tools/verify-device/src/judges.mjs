// Judge registry: parses tools/verify-device/judges.json into a validated set of
// judges + named ensembles, and resolves a run's roster from an ensemble name or a
// `--models` override. Kept PURE and separate from the network path so selection is
// unit-testable without a key or a device (AGENTS.md #6: deterministic config work).
//
// A judge is { id, model, provider, enabled, weight? }:
//   • model    — the OpenRouter id (OpenRouter fronts openai/anthropic/google today)
//   • provider — defaults to 'openrouter'; the seam for a future direct-provider
//                adapter (one-file add in panel.mjs' callModel), unused for now
//   • enabled  — a disabled judge is registered but never selected
//   • weight   — reserved passthrough; aggregation is median-based + count-agnostic
//                (panel.mjs), so weight is carried but not yet consulted.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** The committed registry ships beside the tool. */
export const REGISTRY_PATH = path.join(__dirname, '..', 'judges.json');

/** Ensemble selected when neither --ensemble nor --models is given. */
export const DEFAULT_ENSEMBLE = 'default';

/** Load + validate the committed registry (or an explicit path, for tests). */
export function loadRegistry(filePath = REGISTRY_PATH) {
  return parseRegistry(fs.readFileSync(filePath, 'utf8'));
}

/**
 * Parse + validate a registry JSON string.
 * @param {string} raw
 * @returns {{judges: Map<string, object>, ensembles: Record<string,string[]>}}
 */
export function parseRegistry(raw) {
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch (err) {
    throw new Error(`judges.json is not valid JSON: ${err.message}`);
  }
  const list = Array.isArray(obj.judges) ? obj.judges : [];
  if (!list.length) throw new Error('judges.json must define a non-empty "judges" array');

  const judges = new Map();
  for (const j of list) {
    if (!j || typeof j.id !== 'string' || typeof j.model !== 'string') {
      throw new Error(`judges.json: each judge needs string {id, model}, got ${JSON.stringify(j)}`);
    }
    if (judges.has(j.id)) throw new Error(`judges.json: duplicate judge id "${j.id}"`);
    judges.set(j.id, {
      id: j.id,
      model: j.model,
      provider: j.provider || 'openrouter',
      enabled: j.enabled !== false, // default-on; only an explicit false disables
      ...(typeof j.weight === 'number' ? { weight: j.weight } : {}),
    });
  }

  const ensembles = obj.ensembles && typeof obj.ensembles === 'object' ? obj.ensembles : {};
  for (const [name, ids] of Object.entries(ensembles)) {
    if (!Array.isArray(ids) || !ids.length) {
      throw new Error(`judges.json: ensemble "${name}" must be a non-empty array of judge ids`);
    }
    for (const id of ids) {
      if (!judges.has(id)) throw new Error(`judges.json: ensemble "${name}" references unknown judge id "${id}"`);
    }
  }
  if (!Object.keys(ensembles).length) throw new Error('judges.json must define at least one ensemble');
  return { judges, ensembles };
}

/**
 * Resolve the panel roster. An explicit `models` override wins (synthetic judges,
 * id === model); otherwise the named ensemble's ENABLED judges, in listed order.
 * @param {object} params
 * @param {{judges:Map, ensembles:object}} params.registry
 * @param {string} [params.ensemble] ensemble name (default 'default')
 * @param {string[]} [params.models] --models override; bypasses the registry
 * @returns {Array<{id:string, model:string, provider:string, enabled:boolean, weight?:number}>}
 */
export function resolveJudges({ registry, ensemble = DEFAULT_ENSEMBLE, models } = {}) {
  if (models && models.length) {
    return models.map((model) => ({ id: model, model, provider: 'openrouter', enabled: true }));
  }
  const ids = registry.ensembles[ensemble];
  if (!ids) {
    const known = Object.keys(registry.ensembles).join(', ') || '(none)';
    throw new Error(`unknown ensemble "${ensemble}" (known: ${known})`);
  }
  const selected = ids.map((id) => registry.judges.get(id)).filter((j) => j.enabled);
  if (!selected.length) throw new Error(`ensemble "${ensemble}" has no enabled judges`);
  return selected;
}
