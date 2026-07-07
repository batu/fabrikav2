// Pure, DETERMINISTIC classifier for the claim-gated verify Stop-hook (card
// elkcIthD). No LLM, no filesystem, no git — every function here takes plain
// values and returns plain values so the logic is unit-tested directly. The IO
// (transcript read, git diff, mtime stat, ledger append) lives in the sibling
// modules and the two CLIs; this file is the decision brain both share.
//
// The whole point (per the card): GATE ON THE CLAIM, NOT THE FILE. A refactor
// that changes a visual file but makes no done-claim must NOT block.

/**
 * Sentence-level done-language. The gate should catch ordinary final-status
 * claims ("implemented and tested") without false-firing on unresolved pixel
 * notes or device names like "Pixel 8". Precision matters because this hook
 * runs at turn end.
 */
export const DONE_LANGUAGE_RES = [
  /\b(done|verified|validated|confirmed|tested|fixed|implemented|shipped|complete(?:d)?|works|working|pass(?:es|ed|ing)?|landed)\b/i,
  /\brenders?\s+correctly\b/i,
  /\blooks?\s+right\b/i,
  /\bmatches?\s+(?:the\s+)?reference\b/i,
  /\b(?:pixel|fidelity)[-\s]?(?:perfect|pass(?:es|ed)?|match(?:es|ed)?|verified|clean|ok|good)\b/i,
];

export const INCOMPLETE_LANGUAGE_RE =
  /\b(?:unverified|untested|unfixed|unimplemented|unresolved|incomplete|partial|blocked|failing|fails|broken|wip)\b|\b(?:not|never)\s+(?:done|verified|validated|confirmed|tested|fixed|implemented|complete|working|passing|rendering|matching)\b|\b(?:needs?|requires?|still)\s+(?:test|testing|verification|fix|work|unresolved|failing|broken)|\b(?:issue|bug|problem)\s+(?:still\s+)?(?:unresolved|open|remaining)\b/i;

/** The escape-hatch marker. Exact-case UPPERCASE so it is an INTENTIONAL token,
 *  never triggered by ordinary prose. `UNVERIFIED: <reason>` bypasses the block
 *  and is recorded in the ledger instead. */
export const UNVERIFIED_RE = /UNVERIFIED:[ \t]*([^\n]*)/;

/** Globs whose files render on-device — a done-claim touching these needs
 *  verify-device evidence. Card-specified. */
export const VISUAL_GLOBS = ['games/*/src/**', 'games/*/design/**', 'packages/ui/**'];
const NON_RENDERED_DESIGN_RES = [
  /^games\/[^/]+\/design\/asset-identity\.json$/,
  /^games\/[^/]+\/design\/reference-metrics\.json$/,
];

export const RUBBER_STAMP_EXEMPT_LABELS = [
  'doc',
  'docs',
  'documentation',
  'research',
  'brainstorm',
  'brainstorming',
  'spike',
];

export const RUBBER_STAMP_EXEMPT_PREFIX_RE =
  /^\s*(?:DOCS?|DOCUMENTATION|RESEARCH|BRAINSTORM(?:ED|ING)?|SPIKE)\s*[:-]/i;

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

function repoPath(file) {
  return String(file || '').replace(/^\.\//, '');
}

/** True when a repo-relative path matches any visual glob. */
export function isVisualFile(file) {
  const f = repoPath(file);
  // games/_template is scaffold source, not an installable game with an iOS
  // platform. Its device proof path is scaffold-a-real-game, then verify that
  // generated game; demanding device evidence for _template itself is impossible.
  if (f.startsWith('games/_template/')) return false;
  // Audit metadata under design/ records asset provenance and hand-measured
  // token expectations. It is not loaded by the runtime, so it should not make
  // a headless audit/tooling card require a device visual panel.
  if (NON_RENDERED_DESIGN_RES.some((re) => re.test(f))) return false;
  return VISUAL_RES.some((re) => re.test(f));
}

/** True when the path is exactly under docs/ and is Markdown. */
export function isDocsMarkdownFile(file) {
  return /^docs\/.+\.md$/.test(repoPath(file));
}

function normalizeLabels(labels) {
  return (labels || [])
    .map((label) => {
      if (typeof label === 'string') return label;
      if (label && typeof label.name === 'string') return label.name;
      return '';
    })
    .map((label) => label.trim().toLowerCase())
    .filter(Boolean);
}

/** Doc/research/spike cards may legitimately land docs-only diffs. */
export function isRubberStampExempt({ cardTitle = '', cardLabels = [] } = {}) {
  const exempt = new Set(RUBBER_STAMP_EXEMPT_LABELS);
  if (normalizeLabels(cardLabels).some((label) => exempt.has(label))) return true;
  return RUBBER_STAMP_EXEMPT_PREFIX_RE.test(String(cardTitle || ''));
}

/**
 * Refuse implementation-card branches that changed only requirements/planning
 * Markdown under docs/. This catches rubber-stamped "worked" stages that landed
 * a plan/requirements doc but no implementation.
 */
export function decideRubberStamp({ changedFiles, cardTitle = '', cardLabels = [] }) {
  const files = (changedFiles || []).map(repoPath).filter(Boolean);
  if (files.length === 0) return { ok: true, reason: 'no changed files' };
  if (!files.every(isDocsMarkdownFile)) {
    return { ok: true, reason: 'diff includes non-docs implementation files' };
  }
  if (isRubberStampExempt({ cardTitle, cardLabels })) {
    return { ok: true, reason: 'docs-only diff allowed for doc/research/spike card' };
  }
  return {
    ok: false,
    reason: 'rubber-stamp refusal: non-exempt implementation card changed only docs/**/*.md',
    files,
  };
}

/** True when the message makes a done/verified claim. */
export function hasDoneLanguage(message) {
  const sentences = String(message || '')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return sentences.some((sentence) =>
    !INCOMPLETE_LANGUAGE_RE.test(sentence)
    && DONE_LANGUAGE_RES.some((re) => re.test(sentence))
  );
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
 * Evidence freshness: is there a device-lane verify-device panel newer than the
 * newest visual change for every affected game? The panel verdict/score is
 * recorded for humans, but it is not the landing bar. Dogfooding found the
 * previous `verdict.pass === true` requirement deadlocked fidelity fixes: a
 * fresh marble_run device panel honestly reporting FAIL could not land the code
 * needed to make that same panel pass. The merge/stop gate proves observation
 * happened on the real device; the fidelity floor stays a phase/conductor bar.
 * @param {number|null} newestVisualMtimeMs newest changed-visual-file/change time
 * @param {Array|number[]} panelEvidence structured panel records, or legacy mtimes
 * @param {string[]} affectedGames game slugs extracted from visual files. When
 *   empty (e.g. packages/ui), any fresh device panel is accepted.
 */
export function evidenceIsFresh(newestVisualMtimeMs, panelEvidence, affectedGames = []) {
  if (newestVisualMtimeMs == null) return false;
  const panels = panelEvidence || [];

  // Backward-compatible pure helper path for older tests/callers. The CLIs pass
  // structured records and therefore enforce game/lane/verdict.
  if (panels.every((p) => typeof p === 'number')) {
    return panels.some((t) => t > newestVisualMtimeMs);
  }

  const valid = freshDevicePanels(newestVisualMtimeMs, panels);
  if (affectedGames.length === 0) return valid.length > 0;
  return affectedGames.every((game) => valid.some((p) => p.game === game));
}

function freshDevicePanels(newestVisualMtimeMs, panels) {
  return (panels || []).filter((p) =>
    p && p.valid === true
    && p.lane === 'device'
    && typeof p.generatedAtMs === 'number'
    && p.generatedAtMs > newestVisualMtimeMs
  );
}

function bestPanelForGame(panels, game) {
  const candidates = panels.filter((p) => p.game === game);
  if (candidates.length === 0) return null;
  return candidates.reduce((best, panel) => (
    !best || panel.generatedAtMs > best.generatedAtMs ? panel : best
  ), null);
}

function freshEvidenceDetails(newestVisualMtimeMs, panels, affectedGames = []) {
  if (newestVisualMtimeMs == null) return [];
  if ((panels || []).every((p) => typeof p === 'number')) return [];

  const fresh = freshDevicePanels(newestVisualMtimeMs, panels);
  if (affectedGames.length === 0) {
    return fresh.length === 0
      ? []
      : [fresh.reduce((best, panel) => (
          !best || panel.generatedAtMs > best.generatedAtMs ? panel : best
        ), null)].filter(Boolean);
  }
  return affectedGames.map((game) => bestPanelForGame(fresh, game)).filter(Boolean);
}

function panelVerdictSummary(panel) {
  const verdict = panel.verdictPass === true ? 'PASS' : 'FAIL';
  const score = Number.isFinite(panel.verdictScore) ? `, score ${panel.verdictScore}%` : '';
  const summary = panel.verdictSummary ? `, ${panel.verdictSummary}` : '';
  return `${panel.game || 'unknown'}: verdict ${verdict}${score}${summary}`;
}

function freshEvidenceCovers({ visualFiles, newestVisualMtimeMs, panelEvidence, panelMtimesMs }) {
  const panels = panelEvidence || panelMtimesMs || [];
  const affectedGames = gamesFromVisualFiles(visualFiles);
  const ok = evidenceIsFresh(newestVisualMtimeMs, panels, affectedGames);
  const details = ok ? freshEvidenceDetails(newestVisualMtimeMs, panels, affectedGames) : [];
  return { ok, details };
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
  panelEvidence,
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
  const fresh = freshEvidenceCovers({ visualFiles, newestVisualMtimeMs, panelEvidence, panelMtimesMs });
  if (fresh.ok) {
    const detail = fresh.details.length
      ? ` (${fresh.details.map(panelVerdictSummary).join('; ')})`
      : '';
    return { action: 'pass', reason: `fresh verify-device evidence covers the change${detail}` };
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
  panelEvidence,
  ledgerEntryCount = 0,
  worktreeDirtyFiles = [],
  cardTitle = '',
  cardLabels = [],
  toolPresent,
  gamesDirPresent,
}) {
  if ((worktreeDirtyFiles || []).length > 0) {
    return {
      ok: false,
      reason: 'uncommitted worktree changes cannot land: worker must commit or discard them before landing',
      dirtyFiles: worktreeDirtyFiles,
    };
  }
  const rubberStamp = decideRubberStamp({ changedFiles, cardTitle, cardLabels });
  if (!rubberStamp.ok) {
    return {
      ok: false,
      reason: rubberStamp.reason,
      docsOnlyFiles: rubberStamp.files,
    };
  }
  if (!toolPresent || !gamesDirPresent) {
    return { ok: true, reason: 'self-disabled: verify-device tool or games/ dir absent' };
  }
  const visualFiles = (changedFiles || []).filter(isVisualFile);
  if (visualFiles.length === 0) {
    return { ok: true, reason: 'no visual files in diff — merge gate not applicable' };
  }
  const fresh = freshEvidenceCovers({ visualFiles, newestVisualMtimeMs, panelEvidence, panelMtimesMs });
  if (fresh.ok) {
    const detail = fresh.details.length
      ? ` (${fresh.details.map(panelVerdictSummary).join('; ')})`
      : '';
    return { ok: true, reason: `fresh verify-device panel.json observed the visual change on device${detail}` };
  }
  const detail = ledgerEntryCount > 0
    ? `the only evidence is ${ledgerEntryCount} UNVERIFIED ledger ${ledgerEntryCount === 1 ? 'entry' : 'entries'} `
      + '(escape hatch) — no panel.json newer than the changed visual files'
    : 'no verify-device panel.json newer than the changed visual files, and no UNVERIFIED ledger entries';
  return { ok: false, reason: `visual change cannot land: ${detail}`, visualFiles };
}
