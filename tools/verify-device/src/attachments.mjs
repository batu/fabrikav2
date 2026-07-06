// Extract device screenshots from an .xcresult attachment export.
//
// `xcrun xcresulttool export attachments --path <run>.xcresult --output-path <dir>`
// writes the attachment PNGs plus a `manifest.json` that maps each on-disk file
// (`exportedFileName`) to the runner's screenshot name (`suggestedHumanReadableName`,
// e.g. "04-pause_0_<uuid>.png"). We turn that manifest into a canonical
// state -> file map. Pure parse (no fs) so it unit-tests off a fixture manifest.

import fs from 'node:fs';
import path from 'node:path';
import { stateFromShotName, CANONICAL_STATES } from './states.mjs';

/**
 * Map an xcresulttool attachments manifest onto canonical states.
 * @param {any} manifest parsed manifest.json (array of {attachments:[...]})
 * @returns {{byState: Record<string,{file:string, humanName:string, timestamp:number}>,
 *   unmapped: Array<{file:string, humanName:string}>}}
 *   When several attachments map to the same state, the latest timestamp wins
 *   (deterministic: a re-captured state supersedes an earlier one).
 */
export function mapAttachmentsToStates(manifest) {
  const byState = {};
  const unmapped = [];
  const entries = Array.isArray(manifest) ? manifest : [];
  for (const test of entries) {
    const attachments = Array.isArray(test?.attachments) ? test.attachments : [];
    for (const att of attachments) {
      const file = att?.exportedFileName;
      const humanName = att?.suggestedHumanReadableName || file || '';
      if (!file) continue;
      const state = stateFromShotName(humanName);
      if (!state) {
        unmapped.push({ file, humanName });
        continue;
      }
      const timestamp = Number(att?.timestamp) || 0;
      const prev = byState[state];
      if (!prev || timestamp >= prev.timestamp) {
        byState[state] = { file, humanName, timestamp };
      }
    }
  }
  return { byState, unmapped };
}

/**
 * Resolve device captures from an xcresulttool export directory.
 * @param {string} exportDir dir containing manifest.json + the exported PNGs
 * @returns {{byState: Record<string,string>, unmapped: Array}} state -> abs PNG path
 */
export function extractFromExportDir(exportDir) {
  const manifestPath = path.join(exportDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`no manifest.json in xcresult export dir: ${exportDir}`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const { byState, unmapped } = mapAttachmentsToStates(manifest);
  const resolved = {};
  for (const [state, info] of Object.entries(byState)) {
    resolved[state] = path.join(exportDir, info.file);
  }
  return { byState: resolved, unmapped };
}

/**
 * Load device captures from a plain directory of <state>.png files (the
 * --captures path: pre-extracted or hand-placed device shots, no xcresult).
 * @param {string} dir
 * @returns {Record<string,string>} state -> abs PNG path
 */
export function loadCapturesDir(dir) {
  const byState = {};
  for (const state of CANONICAL_STATES) {
    const p = path.join(dir, `${state}.png`);
    if (fs.existsSync(p)) byState[state] = p;
  }
  return byState;
}
