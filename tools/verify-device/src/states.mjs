// Canonical device-verification states and the mapping from an XCUITest shot
// name (or an xcresult attachment's human-readable name) to a canonical state.
//
// The `allstates` insitu tour (@fabrikav2/testkit/testing) drives these
// six states in order, marking body[data-tour-state]. The committed XCUITest
// runner captures one screenshot per state, named "<order>-<state>" (e.g.
// "1-menu", "01-menu", "6-fail"). We normalise both the runner's names and the
// canonical reference states (refcap-compare manifest) onto this shared vocab so
// the device lane and the reference lane line up row-for-row.

/** Canonical states, in tour order. Mirrors refcap-compare CANONICAL_STATES. */
export const CANONICAL_STATES = ['menu', 'level', 'settings', 'pause', 'win', 'fail'];

const CANONICAL_SET = new Set(CANONICAL_STATES);

/**
 * Extract a canonical state from a shot / attachment name.
 * Handles: "1-menu", "01-menu", "6-fail", and xcresult export names like
 * "04-pause_0_8A262C31-...png" or "1-menu_0_<uuid>.png". Also maps runner
 * failure inspection shots like "6-fail-MISSING". Returns null for names that
 * don't carry a canonical state (e.g. "7-final", "screenshot").
 * @param {string} name
 * @returns {string|null}
 */
export function stateFromShotName(name) {
  if (typeof name !== 'string') return null;
  // Strip a trailing extension, then split on the first '_' (xcresult appends
  // "_<addIndex>_<uuid>"). Left of it is the runner's shot name.
  const base = name.replace(/\.[a-z0-9]+$/i, '');
  const shot = base.split('_')[0];
  // shot is like "01-menu" or "menu" — drop a leading "<digits>-" order prefix.
  const token = shot.replace(/^\d+[-.]/, '').replace(/-missing$/i, '').toLowerCase();
  return CANONICAL_SET.has(token) ? token : null;
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
  const base = name.replace(/\.[a-z0-9]+$/i, '');
  const shot = base.split('_')[0];
  return /-missing$/i.test(shot);
}
