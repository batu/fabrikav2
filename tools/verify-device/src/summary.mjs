import fs from 'node:fs';
import path from 'node:path';

const MAJOR_OR_WORSE = new Set(['major', 'blocker']);

/**
 * Build the stable per-state summary the conductor used to reconstruct from
 * panel.json by hand: state -> { score, majorConsensusCount, verdict }.
 * Blocker consensus is counted in majorConsensusCount because it is worse than
 * major and should not disappear from the trajectory signal.
 *
 * @param {object} params
 * @param {object} [params.panel] runPanel result
 * @param {object} [params.phashVerdict] computeVerdict result used when panel skipped
 * @param {Record<string,object>} [params.viewportMetrics] state -> parsed viewport metrics
 * @param {Array<object>} [params.viewportMetricAssertions] manifest range assertion results
 * @returns {Record<string,{
 *   score:number|null,
 *   majorConsensusCount:number,
 *   verdict:string,
 *   viewportMetrics?:object,
 *   viewportMetricAssertions?:Array<object>,
 * }>}
 */
export function buildSummary({ panel, phashVerdict, viewportMetrics = {}, viewportMetricAssertions = [] }) {
  let summary;
  if (Array.isArray(panel?.states)) {
    summary = Object.fromEntries(panel.states.map((state) => [state.state, summarizePanelState(state)]));
  } else {
    const states = Array.isArray(phashVerdict?.states) ? phashVerdict.states : [];
    summary = Object.fromEntries(states.map((state) => [state.state, {
      score: null,
      majorConsensusCount: 0,
      verdict: String(state.status || 'unknown'),
    }]));
  }

  const assertionsByState = groupAssertionsByState(viewportMetricAssertions);
  for (const state of new Set([
    ...Object.keys(viewportMetrics || {}),
    ...Object.keys(assertionsByState),
  ])) {
    if (!summary[state]) {
      summary[state] = { score: null, majorConsensusCount: 0, verdict: 'unknown' };
    }
    if (isPlainObject(viewportMetrics?.[state])) {
      summary[state].viewportMetrics = viewportMetrics[state];
    }
    if (assertionsByState[state]?.length > 0) {
      summary[state].viewportMetricAssertions = assertionsByState[state];
    }
  }

  return summary;
}

export function writeSummaryJson(outDir, summary) {
  const file = path.join(outDir, 'summary.json');
  fs.writeFileSync(file, `${JSON.stringify(summary, null, 2)}\n`);
  return file;
}

export function loadRunSummary(runDir) {
  const dir = path.resolve(runDir);
  const summaryPath = path.join(dir, 'summary.json');
  if (fs.existsSync(summaryPath)) {
    return normalizeSummary(JSON.parse(fs.readFileSync(summaryPath, 'utf8')));
  }

  const panelPath = path.join(dir, 'panel.json');
  if (fs.existsSync(panelPath)) {
    return buildSummary({ panel: JSON.parse(fs.readFileSync(panelPath, 'utf8')), phashVerdict: null });
  }

  throw new Error(`compare run has no summary.json or panel.json: ${dir}`);
}

export function normalizeSummary(raw) {
  const source = raw?.states && isPlainObject(raw.states) ? raw.states : raw;
  if (!isPlainObject(source)) throw new Error('summary.json must be an object keyed by state');
  return Object.fromEntries(Object.entries(source).map(([state, value]) => {
    const score = value?.score;
    const majorConsensusCount = Number(value?.majorConsensusCount);
    const normalized = {
      score: Number.isFinite(score) ? score : null,
      majorConsensusCount: Number.isFinite(majorConsensusCount) ? majorConsensusCount : 0,
      verdict: String(value?.verdict || value?.status || 'unknown'),
    };
    if (isPlainObject(value?.viewportMetrics)) {
      normalized.viewportMetrics = value.viewportMetrics;
    }
    if (Array.isArray(value?.viewportMetricAssertions)) {
      normalized.viewportMetricAssertions = value.viewportMetricAssertions;
    }
    return [state, normalized];
  }));
}

export function compareSummaries(current, previous) {
  const currentSummary = normalizeSummary(current);
  const previousSummary = normalizeSummary(previous);
  const states = [
    ...Object.keys(currentSummary),
    ...Object.keys(previousSummary).filter((state) => !Object.hasOwn(currentSummary, state)),
  ];
  return states.map((state) => {
    const cur = currentSummary[state] || null;
    const prev = previousSummary[state] || null;
    return {
      state,
      current: cur,
      previous: prev,
      scoreDelta: numericDelta(cur?.score, prev?.score),
      majorConsensusDelta: numericDelta(cur?.majorConsensusCount, prev?.majorConsensusCount),
      verdictChanged: (cur?.verdict || null) !== (prev?.verdict || null),
    };
  });
}

export function formatSummaryTable(summary) {
  const entries = Object.entries(normalizeSummary(summary));
  const stateWidth = Math.max(5, ...entries.map(([state]) => state.length));
  const lines = [
    '  states:',
    `    ${'state'.padEnd(stateWidth)}  score  majors  verdict`,
    ...entries.map(([state, value]) =>
      `    ${state.padEnd(stateWidth)}  ${formatNumber(value.score).padStart(5)}  `
      + `${formatNumber(value.majorConsensusCount).padStart(6)}  ${value.verdict}`),
  ];
  return `${lines.join('\n')}\n`;
}

export function formatCompareTable(deltas, previousLabel) {
  const stateWidth = Math.max(5, ...deltas.map((delta) => delta.state.length));
  const lines = [
    `  compare: ${previousLabel}`,
    `    ${'state'.padEnd(stateWidth)}  score delta      majors delta    verdict`,
    ...deltas.map((delta) => {
      const score = `${formatDelta(delta.scoreDelta)} (${formatNumber(delta.previous?.score)}->${formatNumber(delta.current?.score)})`;
      const majors = `${formatDelta(delta.majorConsensusDelta)} `
        + `(${formatNumber(delta.previous?.majorConsensusCount)}->${formatNumber(delta.current?.majorConsensusCount)})`;
      const verdict = delta.verdictChanged
        ? `${delta.previous?.verdict || '-'}->${delta.current?.verdict || '-'}`
        : (delta.current?.verdict || delta.previous?.verdict || '-');
      return `    ${delta.state.padEnd(stateWidth)}  ${score.padEnd(16)}  ${majors.padEnd(14)}  ${verdict}`;
    }),
  ];
  return `${lines.join('\n')}\n`;
}

function summarizePanelState(state) {
  const consensus = Array.isArray(state.consensus) ? state.consensus : [];
  return {
    score: Number.isFinite(state.score) ? state.score : null,
    majorConsensusCount: consensus.filter((finding) => MAJOR_OR_WORSE.has(finding?.severity)).length,
    verdict: String(state.status || 'unknown'),
  };
}

function groupAssertionsByState(assertions) {
  const byState = {};
  for (const assertion of Array.isArray(assertions) ? assertions : []) {
    const state = assertion?.state;
    if (typeof state !== 'string' || state.length === 0) continue;
    if (!byState[state]) byState[state] = [];
    byState[state].push(assertion);
  }
  return byState;
}

function numericDelta(current, previous) {
  return Number.isFinite(current) && Number.isFinite(previous) ? current - previous : null;
}

function formatDelta(value) {
  if (!Number.isFinite(value)) return 'n/a';
  if (value > 0) return `+${formatNumber(value)}`;
  return formatNumber(value);
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return '-';
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}
