// Load + validate the per-game manifest. Paths inside the manifest are relative
// to the game root (games/<game>/), so consumers resolve them against gameDir.

import fs from 'node:fs';
import path from 'node:path';
import { parseYaml } from './yaml.mjs';

const CANONICAL_STATES = ['menu', 'level', 'settings', 'pause', 'win', 'fail'];

/**
 * @param {string} gameDir absolute path to games/<game>/
 * @returns {{game:string, reference:object, v2:object, states:Array, gameDir:string}}
 */
export function loadManifest(gameDir) {
  const manifestPath = path.join(gameDir, 'refs', 'manifest.yaml');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`manifest not found: ${manifestPath}`);
  }
  const doc = parseYaml(fs.readFileSync(manifestPath, 'utf8'));
  validate(doc, manifestPath);
  return { ...doc, gameDir };
}

function validate(doc, manifestPath) {
  if (!doc || typeof doc !== 'object') {
    throw new Error(`manifest ${manifestPath}: not a mapping`);
  }
  if (!doc.game) throw new Error(`manifest ${manifestPath}: missing "game"`);
  if (!doc.reference || !doc.reference.package) {
    throw new Error(`manifest ${manifestPath}: reference.package is required (package-stamp rule)`);
  }
  if (!Array.isArray(doc.states) || doc.states.length === 0) {
    throw new Error(`manifest ${manifestPath}: "states" must be a non-empty list`);
  }
  const seen = new Set();
  for (const st of doc.states) {
    if (!st || !st.name) throw new Error(`manifest ${manifestPath}: a state is missing "name"`);
    if (seen.has(st.name)) throw new Error(`manifest ${manifestPath}: duplicate state "${st.name}"`);
    seen.add(st.name);
    if (!CANONICAL_STATES.includes(st.name)) {
      throw new Error(
        `manifest ${manifestPath}: state "${st.name}" is not canonical ` +
        `(expected one of ${CANONICAL_STATES.join(', ')})`
      );
    }
    for (const lane of ['reference', 'v2']) {
      const laneDef = st[lane];
      if (!laneDef || typeof laneDef !== 'object') {
        throw new Error(`manifest ${manifestPath}: state "${st.name}" missing "${lane}"`);
      }
      // each lane must have an offline source OR declare an explicit gap
      if (!laneDef.offline && !laneDef.gap) {
        throw new Error(
          `manifest ${manifestPath}: state "${st.name}" ${lane} lane has neither ` +
          `"offline" source nor an explicit "gap" (absence must be documented, not silent)`
        );
      }
    }
  }
}

export { CANONICAL_STATES };
