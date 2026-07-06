// Pure, DETERMINISTIC classifier for the claim-gated verify Stop-hook (card
// elkcIthD). No LLM, no filesystem, no git — every function here takes plain
// values and returns plain values so the logic is unit-tested directly. The IO
// (transcript read, git diff, mtime stat, ledger append) lives in the sibling
// modules and the two CLIs; this file is the decision brain both share.
//
// The whole point (per the card): GATE ON THE CLAIM, NOT THE FILE. A refactor
// that changes a visual file but makes no done-claim must NOT block.

/**
 * Done-language: the claim that work is finished/verified. Case-insensitive.
 * Word boundaries (\b) are deliberate — the card lists these tokens without
 * boundaries, but "done" as a bare substring matches "abandoned" and "works"
 * matches "frameworks", which would block innocent refactors. Precision is the
 * whole point of this card, so we anchor to whole words/phrases.
 */
export const DONE_LANGUAGE_RE =
  /\b(done|verified|works|renders? correctly|looks right|matches the reference|pixel|fidelity|shipped|complete on device)\b/i;

/** The escape-hatch marker. Exact-case UPPERCASE so it is an INTENTIONAL token,
 *  never triggered by ordinary prose. `UNVERIFIED: <reason>` bypasses the block
 *  and is recorded in the ledger instead. */
export const UNVERIFIED_RE = /UNVERIFIED:[ \t]*([^\n]*)/;

/** Globs whose files render on-device — a done-claim touching these needs
 *  verify-device evidence. Card-specified. */
export const VISUAL_GLOBS = ['games/*/src/**', 'games/*/design/**', 'packages/ui/**'];

// Minimal glob -> RegExp (no dependency). `**` -> any chars incl. `/`;
// `*` -> any chars except `/`; everything else literal.
function globToRegExp(glob) {
  let re = '^';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i++;
        if (glob[i + 1] === '/') i++; // `**/` also matches zero path segments
      } else {
        re += '[^/]*';
      }
    } else if ('/.+?^${}()|[]\\'.includes(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  return new RegExp(re + '$');
}

const VISUAL_RES = VISUAL_GLOBS.map(globToRegExp);

/** True when a repo-relative path matches any visual glob. */
export function isVisualFile(file) {
  const f = String(file || '').replace(/^\.\//, '');
  return VISUAL_RES.some((re) => re.test(f));
}

/** True when the message makes a done/verified claim. */
export function hasDoneLanguage(message) {
  return DONE_LANGUAGE_RE.test(String(message || ''));
}

/** Detect the UNVERIFIED escape hatch. Returns {present, reason}. */
export function detectUnverified(message) {
  const m = UNVERIFIED_RE.exec(String(message || ''));
  if (!m) return { present: false, reason: null };
  const reason = (m[1] || '').trim();
  return { present: true, reason: reason || '(no reason given)' };
}

/** Extract the `<game>` slugs referenced by the changed visual files. */
export function gamesFromVisualFiles(files) {
  const s = new Set();
  for (const f of files || []) {
    const m = /^games\/([^/]+)\//.exec(String(f));
    if (m) s.add(m[1]);
  }
  return [...s];
}

/**
 * Evidence freshness: is there any verify-device panel newer than the newest
 * changed visual file? A stale panel (older than the change) does NOT count.
 * @param {number|null} newestVisualMtimeMs newest changed-visual-file mtime
 * @param {number[]} panelMtimesMs mtimes of discovered panel.json files
 */
export function evidenceIsFresh(newestVisualMtimeMs, panelMtimesMs) {
  // No stat-able visual file (e.g. deletions only) => nothing to be stale
  // against; don't gate on it.
  if (newestVisualMtimeMs == null) return true;
  return (panelMtimesMs || []).some((t) => t > newestVisualMtimeMs);
}

/**
 * The Stop-hook decision. Pure. BLOCK IFF ALL of: done-language AND a changed
 * visual file AND no fresh evidence AND no UNVERIFIED marker.
 *
 * @returns {{action:'noop'|'pass'|'ledger'|'block', reason:string,
 *   visualFiles?:string[], games?:string[], ledgerReason?:string}}
 */
export function decideStop({
  message,
  changedFiles,
  newestVisualMtimeMs,
  panelMtimesMs,
  toolPresent,
  gamesDirPresent,
}) {
  if (!toolPresent || !gamesDirPresent) {
    return { action: 'noop', reason: 'self-disabled: verify-device tool or games/ dir absent' };
  }
  const visualFiles = (changedFiles || []).filter(isVisualFile);
  if (visualFiles.length === 0) {
    return { action: 'noop', reason: 'no changed file matches a visual glob' };
  }
  const unv = detectUnverified(message);
  if (unv.present) {
    // Escape hatch: skipping is possible but RECORDED, never silent.
    return {
      action: 'ledger',
      reason: 'UNVERIFIED marker present — recorded to the ledger, not blocked',
      visualFiles,
      ledgerReason: unv.reason,
    };
  }
  if (!hasDoneLanguage(message)) {
    // Gate on the CLAIM, not the file: a refactor with no done-claim passes.
    return { action: 'pass', reason: 'visual change but no done-claim — not gated' };
  }
  if (evidenceIsFresh(newestVisualMtimeMs, panelMtimesMs)) {
    return { action: 'pass', reason: 'fresh verify-device evidence covers the change' };
  }
  return {
    action: 'block',
    reason: 'done-claim on visual change with no fresh verify-device evidence and no UNVERIFIED marker',
    visualFiles,
    games: gamesFromVisualFiles(visualFiles),
  };
}

/** Render the Stop-hook block reason: names the files, the exact command, and
 *  cites AGENTS.md #8. */
export function buildBlockMessage({ visualFiles, games }) {
  const g = games && games.length ? games : ['<game>'];
  const cmds = g.map((name) => `  npm run verify-device -- --game ${name}`).join('\n');
  return [
    'BLOCKED (AGENTS.md #8): your final message claims the work is done/verified, but the diff',
    'changes on-device-rendered visual files and there is NO fresh verify-device evidence',
    '(no panel.json newer than your changed files).',
    '',
    'Changed visual files:',
    ...visualFiles.map((f) => `  - ${f}`),
    '',
    'Capture on-device evidence and diff it against the reference before you finish:',
    cmds,
    '',
    'A web/simulator render is NOT the device (AGENTS.md #7). If you are DELIBERATELY',
    'skipping on-device verification, declare it in your final message as:',
    '  UNVERIFIED: <why on-device verification was skipped>',
    'which records the skip in .work/verify-ledger.jsonl instead of blocking.',
  ].join('\n');
}

/**
 * The merge/land gate decision. Pure. A card whose diff touches visual globs
 * HARD-FAILS if there is no fresh real panel.json covering the change — the
 * ship-time backstop for the UNVERIFIED escape hatch.
 *
 * @returns {{ok:boolean, reason:string, visualFiles?:string[]}}
 */
export function decideMerge({
  changedFiles,
  newestVisualMtimeMs,
  panelMtimesMs,
  ledgerEntryCount = 0,
  toolPresent,
  gamesDirPresent,
}) {
  if (!toolPresent || !gamesDirPresent) {
    return { ok: true, reason: 'self-disabled: verify-device tool or games/ dir absent' };
  }
  const visualFiles = (changedFiles || []).filter(isVisualFile);
  if (visualFiles.length === 0) {
    return { ok: true, reason: 'no visual files in diff — merge gate not applicable' };
  }
  if (evidenceIsFresh(newestVisualMtimeMs, panelMtimesMs)) {
    return { ok: true, reason: 'fresh verify-device panel.json covers the visual change' };
  }
  const detail = ledgerEntryCount > 0
    ? `the only evidence is ${ledgerEntryCount} UNVERIFIED ledger ${ledgerEntryCount === 1 ? 'entry' : 'entries'} `
      + '(escape hatch) — no panel.json newer than the changed visual files'
    : 'no verify-device panel.json newer than the changed visual files, and no UNVERIFIED ledger entries';
  return { ok: false, reason: `visual change cannot land: ${detail}`, visualFiles };
}
