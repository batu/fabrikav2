// Device-verification state parsing. The effective vocabulary comes from the
// loaded per-game refs/manifest.yaml, not from this module.

/**
 * Extract a manifest state from a shot / attachment name.
 * Handles: "1-menu", "01-menu", "6-fail", and xcresult export names like
 * "04-pause_0_8A262C31-...png" or "1-menu_0_<uuid>.png". Also maps runner
 * failure inspection shots like "6-fail-MISSING". Returns null for names that
 * don't carry a manifest state (e.g. "7-final", "screenshot").
 * @param {string} name
 * @param {readonly string[]} states
 * @returns {string|null}
 */
export function stateFromShotName(name, states = []) {
  if (typeof name !== 'string') return null;
  const token = shotToken(name).replace(/-missing$/i, '');
  return stateSet(states).has(token) ? token : null;
}

/**
 * Whether the runner attachment name is an inspection shot taken after the exact
 * tourstate marker failed to appear. These PNGs are useful evidence, but they
 * are not gated captures of the named state.
 * @param {string} name
 * @returns {boolean}
 */
export function isMissingShotName(name) {
  if (typeof name !== 'string') return false;
  return /-missing$/i.test(shotToken(name));
}

/**
 * Normalize an XCUITest shot / attachment name to its ordered shot token.
 * Strips file extensions, xcresult's right-side "_<index>_<uuid>" suffix, and
 * the optional "<digits>-" runner order prefix while preserving underscores in
 * valid state names such as "level_intro".
 * @param {string} name
 * @returns {string}
 */
export function shotToken(name) {
  const base = String(name).replace(/\.[a-z0-9]+$/i, '');
  const withoutXcresultSuffix = base.replace(/_\d+_[^_]+$/, '');
  return withoutXcresultSuffix.replace(/^\d+[-.]/, '').toLowerCase();
}

function stateSet(states) {
  return new Set(Array.isArray(states) ? states : []);
}
