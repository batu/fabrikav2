// Multi-model vision PANEL scorer — the PRIMARY fidelity verdict for verify-device
// (phash stays a secondary advisory signal). For each canonical state we send the
// (device shot, reference shot) pair + a fixed diff prompt to N vision models via
// OpenRouter and aggregate their judgements:
//
//   • panel score  = MEDIAN of the per-model fidelity %s (robust to one outlier)
//   • consensus    = a finding key flagged by a MAJORITY of the models that scored
//   • state verdict= FAIL if panel score < threshold OR a blocker-severity finding
//                    reaches consensus; PASS otherwise; UNSCORED if no model scored
//
// BUILD/RUN SPLIT (mirrors the device steps): the aggregation/consensus/verdict
// logic here is PURE and unit-tested with MOCKED model responses. The live model
// calls (callModel/runPanel) need OPENROUTER_API_KEY + network and are
// CONDUCTOR-run; runPanel degrades gracefully (skipped, UNVERIFIED) with no key.

/** Default panel — all confirmed working on OpenRouter (card comment 2). Any that
 *  404 (model absent) or 401/402/403/429 (credit/quota) are skipped-with-note,
 *  never a silent gap. The registry (judges.json) is the source of truth for the
 *  live roster; this constant is the no-registry fallback + the `default` ensemble
 *  contract the unit tests pin. */
export const DEFAULT_MODELS = [
  'anthropic/claude-opus-4.1',
  'anthropic/claude-sonnet-5',
  'google/gemini-3.5-flash',
];

/** HTTP statuses that mean "this judge can't answer right now" (missing key,
 *  no budget, rate-limited) rather than a bug. Each is skipped-and-recorded so the
 *  panel runs with whoever answered — Gemini's real failure mode is 402/429, and
 *  Codex/openai is registered-but-broke until it has budget. 404 is kept distinct
 *  (model absent from OpenRouter) for a clearer note. */
export const CREDIT_STATUSES = new Set([401, 402, 403, 429]);

/** Default per-judge network timeout (ms). A judge that hangs is skipped like a
 *  credit-depleted one, never blocking the whole panel. */
export const DEFAULT_TIMEOUT_MS = 60000;

/** Classify a non-2xx status into a skip reason string ({judge, skipped, reason}). */
export function classifySkip(status) {
  if (status === 404) return 'model not found on OpenRouter (404)';
  if (CREDIT_STATUSES.has(status)) return `credit/quota unavailable (HTTP ${status})`;
  return `HTTP ${status}`;
}

/** Controlled finding vocabulary. Free-text descriptions are kept for display,
 *  but consensus is computed on these keys so "same finding across models" is a
 *  DETERMINISTIC set-membership test, not an LLM re-match (AGENTS.md #6). */
export const FINDING_KEYS = [
  'layout', 'color', 'typography', 'text-content', 'missing-element',
  'extra-element', 'sizing', 'spacing', 'iconography', 'background', 'other',
];

/** Severity ranks (higher = worse). A blocker at consensus fails the state. */
export const SEVERITY_RANK = { blocker: 3, major: 2, minor: 1 };
const SEVERITIES = Object.keys(SEVERITY_RANK);

/** The fixed diff prompt sent with every (reference, device) pair. Stable so runs
 *  are comparable; replicates the structure proven in the card's session. */
export const DIFF_PROMPT = `You are comparing two screenshots of the SAME app screen.
IMAGE 1 is the REFERENCE (the target design). IMAGE 2 is OURS (rendered on-device).
List the visual differences that make OURS deviate from the REFERENCE.

Respond with ONLY a JSON object, no prose, in this exact shape:
{
  "fidelity": <integer 0-100, how faithfully OURS matches the REFERENCE>,
  "findings": [
    {
      "key": <one of: ${FINDING_KEYS.join(', ')}>,
      "severity": <one of: blocker, major, minor>,
      "description": "<short: what differs>",
      "reference": "<what the reference shows>",
      "ours": "<what ours shows>"
    }
  ]
}
Order findings most-severe first. Use "blocker" only for differences that break the
screen's identity or usability. If the screens match, return an empty findings array.`;

/** Median of a numeric array (mean of the two middle values for even length). */
export function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Parse a single model's raw text response into { fidelity, findings }.
 * Tolerates ```json fences / surrounding prose by extracting the first {...} block.
 * Normalises keys/severities to the controlled vocab (unknown -> 'other'/'minor').
 * @param {string} text
 * @returns {{fidelity:number, findings:Array<{key:string,severity:string,description:string,reference?:string,ours?:string}>}}
 */
export function parseModelResponse(text) {
  if (typeof text !== 'string') throw new Error('model response is not text');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('no JSON object in model response');
  let obj;
  try {
    obj = JSON.parse(text.slice(start, end + 1));
  } catch (err) {
    throw new Error(`model response is not valid JSON: ${err.message}`);
  }
  const fidelity = clampPct(obj.fidelity);
  if (fidelity === null) throw new Error('model response missing a numeric fidelity');
  const findings = Array.isArray(obj.findings) ? obj.findings.map(normFinding) : [];
  return { fidelity, findings };
}

function clampPct(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, n));
}

function normFinding(f) {
  const key = FINDING_KEYS.includes(f && f.key) ? f.key : 'other';
  const severity = SEVERITIES.includes(f && f.severity) ? f.severity : 'minor';
  return {
    key,
    severity,
    description: String((f && f.description) || '').slice(0, 400),
    reference: f && f.reference ? String(f.reference).slice(0, 400) : undefined,
    ours: f && f.ours ? String(f.ours).slice(0, 400) : undefined,
  };
}

/**
 * Aggregate one state's per-model judgements into a panel verdict.
 * @param {string} state
 * @param {Array<{model:string, ok:boolean, fidelity?:number, findings?:Array, skipped?:string}>} perModel
 * @param {number} thresholdPct fidelity floor (0..100); below it the state FAILs
 * @returns {{state, score:number|null, status:'pass'|'fail'|'unscored'|'skipped',
 *   reason:string, models:Array, consensus:Array}}
 */
export function aggregateState(state, perModel, thresholdPct) {
  const scored = perModel.filter((m) => m.ok);
  const models = perModel.map((m) => ({
    judge: m.judge || m.model,
    model: m.model,
    ok: !!m.ok,
    fidelity: m.ok ? m.fidelity : null,
    skipped: m.ok ? undefined : m.skipped || 'no response',
  }));
  if (!scored.length) {
    return { state, score: null, status: 'unscored', reason: 'no model scored this state', models, consensus: [] };
  }
  const n = scored.length;
  const majority = Math.floor(n / 2) + 1;
  const score = median(scored.map((m) => m.fidelity));

  // Group every model's findings by controlled key; a key is CONSENSUS when a
  // majority of the scoring models flagged it. Aggregated severity = the highest
  // severity that a majority of the flaggers agreed on, else the most common.
  const byKey = new Map();
  for (const m of scored) {
    const seen = new Set();
    for (const f of m.findings || []) {
      if (seen.has(f.key)) continue; // one vote per model per key
      seen.add(f.key);
      if (!byKey.has(f.key)) byKey.set(f.key, []);
      byKey.get(f.key).push({ model: m.model, severity: f.severity, description: f.description });
    }
  }
  const consensus = [];
  for (const [key, votes] of byKey) {
    if (votes.length < majority) continue;
    consensus.push({
      key,
      count: votes.length,
      of: n,
      severity: aggregateSeverity(votes.map((v) => v.severity), majority),
      descriptions: votes.map((v) => v.description).filter(Boolean),
    });
  }
  consensus.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.count - a.count);

  const blocker = consensus.find((c) => c.severity === 'blocker');
  const belowFloor = score < thresholdPct;
  const status = blocker || belowFloor ? 'fail' : 'pass';
  const reason = status === 'pass'
    ? `panel ${score}% ≥ ${thresholdPct}%, no blocker consensus`
    : [
      belowFloor ? `panel ${score}% < ${thresholdPct}%` : null,
      blocker ? `consensus blocker: ${blocker.key} (${blocker.count}/${blocker.of})` : null,
    ].filter(Boolean).join('; ');
  return { state, score, status, reason, models, consensus };
}

// Highest severity that a majority of the flaggers rated; else the modal severity.
function aggregateSeverity(severities, majority) {
  const counts = { blocker: 0, major: 0, minor: 0 };
  for (const s of severities) counts[s] += 1;
  for (const sev of ['blocker', 'major', 'minor']) {
    // count of votes AT LEAST this severe
    const atLeast = SEVERITIES.filter((s) => SEVERITY_RANK[s] >= SEVERITY_RANK[sev])
      .reduce((sum, s) => sum + counts[s], 0);
    if (atLeast >= majority) return sev;
  }
  // no majority at any floor — report the single most common severity
  return ['blocker', 'major', 'minor'].reduce((best, s) => (counts[s] > counts[best] ? s : best), 'minor');
}

/**
 * Roll per-state panel verdicts into an overall panel verdict.
 * @param {Array} states aggregateState results
 * @param {number} thresholdPct
 * @returns {{pass:boolean, summary:string, states:Array, score:number|null}}
 */
export function aggregatePanel(states, thresholdPct) {
  const fails = states.filter((s) => s.status === 'fail');
  const unscored = states.filter((s) => s.status === 'unscored');
  const skipped = states.filter((s) => s.status === 'skipped');
  const passes = states.filter((s) => s.status === 'pass');
  const scores = states.map((s) => s.score).filter((v) => typeof v === 'number');
  const overall = median(scores);
  // UNSCORED never silently passes: it holds the gate open (not a clean PASS).
  const pass = fails.length === 0 && unscored.length === 0;
  const summary = `${pass ? 'PASS' : 'FAIL'} — panel median ${overall == null ? 'n/a' : `${overall}%`}`
    + ` · ${passes.length} pass, ${fails.length} fail, ${unscored.length} unscored, ${skipped.length} skipped`
    + ` (floor ${thresholdPct}%)`;
  return { pass, summary, states, score: overall };
}

export function withPanelMetadata(panel, { game, lane = 'device', generatedAt }) {
  return {
    ...panel,
    game,
    lane,
    generatedAt,
  };
}

/**
 * Call one vision judge on OpenRouter with the (reference, device) pair.
 * Network path — CONDUCTOR-run. `fetchImpl` is injectable for tests. A judge that
 * is absent (404), out of credit / keyless / rate-limited (401/402/403/429), times
 * out, or emits junk resolves to { ok:false, skipped } rather than throwing, so one
 * broke or missing judge never sinks the panel. Every return carries the judge id
 * so the grid can list participated-vs-skipped explicitly ({judge, skipped, reason}).
 * @param {string} model OpenRouter model id
 * @param {object} opts
 * @param {string} [opts.judge] registry judge id (defaults to the model id)
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<{judge:string, model:string, ok:boolean, fidelity?:number, findings?:Array, skipped?:string}>}
 */
export async function callModel(model, {
  referenceB64, deviceB64, apiKey, prompt = DIFF_PROMPT, fetchImpl = fetch,
  judge = model, timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  const skip = (reason) => ({ judge, model, ok: false, skipped: reason });
  const body = {
    model,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${referenceB64}` } },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${deviceB64}` } },
      ],
    }],
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetchImpl('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    return err && err.name === 'AbortError'
      ? skip(`timeout after ${timeoutMs}ms`)
      : skip(`request failed: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) return skip(classifySkip(res.status));
  let text;
  try {
    const json = await res.json();
    text = json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
  } catch (err) {
    return skip(`unparseable API envelope: ${err.message}`);
  }
  try {
    const parsed = parseModelResponse(text);
    return { judge, model, ok: true, fidelity: parsed.fidelity, findings: parsed.findings };
  } catch (err) {
    return skip(`bad model output: ${err.message}`);
  }
}

/**
 * Normalise the roster into judge objects. Prefer `judges` (registry-resolved
 * {id, model, ...}); fall back to `models` (id === model); else DEFAULT_MODELS.
 * A bare string in `judges` is tolerated as a model id.
 * @returns {Array<{id:string, model:string}>}
 */
function normalizeRoster({ judges, models }) {
  if (judges && judges.length) {
    return judges.map((j) => (typeof j === 'string' ? { id: j, model: j } : j));
  }
  const ms = models && models.length ? models : DEFAULT_MODELS;
  return ms.map((m) => ({ id: m, model: m }));
}

/**
 * Run the full panel over the built rows. Graceful skip (no throw) when there is
 * no API key. States missing either image are reported unscored (never invented).
 * Aggregation is count-agnostic, so a per-judge credit-skip just shrinks the panel
 * for that state — whoever answered still produces a verdict.
 * @param {object} params
 * @param {Array} params.rows compare.buildRows rows (device/reference carry base64)
 * @param {Array<{id:string, model:string}>} [params.judges] registry-resolved roster
 * @param {string[]} [params.models] legacy roster (id === model); used if no judges
 * @param {string} [params.apiKey]
 * @param {number} [params.thresholdPct]
 * @param {number} [params.timeoutMs]
 * @param {Function} [params.fetchImpl]
 * @param {Function} [params.budgetCheck] async guard run before each billable model call
 * @returns {Promise<{skipped?:string, models?:string[], judges?:Array,
 *   thresholdPct?:number, states?:Array, verdict?:object}>}
 */
export async function runPanel({
  rows, judges, models, apiKey, thresholdPct = 85,
  timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = fetch, budgetCheck,
}) {
  if (!apiKey) {
    return { skipped: 'no OPENROUTER_API_KEY — panel scoring UNVERIFIED (set it to run the vision panel)' };
  }
  const roster = normalizeRoster({ judges, models });
  const states = [];
  let budgetHalted = false;
  for (const row of rows) {
    if (row.reference?.skipJudging || row.device?.skipJudging) {
      states.push({
        state: row.state,
        score: null,
        status: 'skipped',
        reason: row.reference?.gap || row.device?.gap || 'excluded from panel scoring',
        models: [],
        consensus: [],
      });
      continue;
    }
    const refB64 = row.reference && !row.reference.gap ? row.reference.base64 : null;
    const devB64 = row.device && !row.device.gap ? row.device.base64 : null;
    if (!refB64 || !devB64) {
      states.push({
        state: row.state, score: null, status: 'unscored',
        reason: !devB64 ? 'no device capture to score' : 'no reference to score against',
        models: [], consensus: [],
      });
      continue;
    }
    const perModel = [];
    for (const j of roster) {
      if (budgetCheck) {
        const budget = await budgetCheck({ state: row.state, judge: j });
        if (budget?.halted) {
          budgetHalted = true;
          perModel.push({
            judge: j.id,
            model: j.model,
            ok: false,
            skipped: `${budget.reason} (budget halted before model call)`,
          });
          continue;
        }
      }
      perModel.push(await callModel(j.model, {
        referenceB64: refB64, deviceB64: devB64, apiKey, fetchImpl, judge: j.id, timeoutMs,
      }));
    }
    states.push(aggregateState(row.state, perModel, thresholdPct));
  }
  return {
    models: roster.map((j) => j.model), judges: roster,
    thresholdPct, states, verdict: aggregatePanel(states, thresholdPct),
    budgetHalted,
  };
}
