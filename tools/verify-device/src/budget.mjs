// BUDGET-GUARD: check remaining OpenRouter credit before the panel runs, so an
// unattended overnight run can't silently drain the shared OpenRouter budget to
// $0. `checkBudget` is a pure-ish gate (fetchImpl injectable for tests) that
// never throws — a failed /credits call is logged and treated as pass-through
// (the panel's own per-judge credit-skip, panel.mjs CREDIT_STATUSES, is the last
// line of defense), so one flaky credit check never blocks a run that would
// otherwise succeed. Only a CONFIRMED remaining balance below the floor halts.

export const CREDITS_ENDPOINT = 'https://openrouter.ai/api/v1/credits';

/** Default credit floor (USD). Below this the panel halts rather than risking
 *  a drain to $0 mid-overnight-run. */
export const DEFAULT_BUDGET_FLOOR = 5;

/**
 * Extract remaining credit (USD) from the OpenRouter /credits response body.
 * @param {object} json `{ data: { total_credits, total_usage } }`
 * @returns {number|null} remaining, or null if the shape is unexpected
 */
export function remainingFromCreditsPayload(json) {
  const data = json && json.data;
  if (!data) return null;
  const total = Number(data.total_credits);
  const used = Number(data.total_usage);
  if (!Number.isFinite(total) || !Number.isFinite(used)) return null;
  return total - used;
}

/**
 * Fetch remaining OpenRouter credit. Throws on a non-2xx response or an
 * unparseable/unexpected body — callers (checkBudget) treat that as
 * "couldn't check" rather than "confirmed depleted".
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {Function} [opts.fetchImpl]
 * @returns {Promise<number>} remaining credit in USD
 */
export async function fetchRemainingCredits({ apiKey, fetchImpl = fetch }) {
  const res = await fetchImpl(CREDITS_ENDPOINT, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`OpenRouter /credits HTTP ${res.status}`);
  const json = await res.json();
  const remaining = remainingFromCreditsPayload(json);
  if (remaining === null) throw new Error('OpenRouter /credits: unexpected payload shape');
  return remaining;
}

/**
 * The budget-guard gate. Call before every panel run.
 * @param {object} opts
 * @param {string} [opts.apiKey] no key -> the panel already skips (UNVERIFIED),
 *   so the budget check is a no-op (not-halted, not-checked).
 * @param {number} [opts.floor] USD floor (default 5 / DEFAULT_BUDGET_FLOOR).
 * @param {Function} [opts.fetchImpl]
 * @returns {Promise<{halted:boolean, checked:boolean, reason?:string,
 *   remaining?:number, floor?:number}>}
 */
export async function checkBudget({ apiKey, floor = DEFAULT_BUDGET_FLOOR, fetchImpl = fetch }) {
  if (!apiKey) {
    return { halted: false, checked: false, reason: 'no OPENROUTER_API_KEY — budget check skipped' };
  }
  let remaining;
  try {
    remaining = await fetchRemainingCredits({ apiKey, fetchImpl });
  } catch (err) {
    return { halted: false, checked: false, reason: `budget check failed, proceeding: ${err.message}` };
  }
  if (remaining < floor) {
    return {
      halted: true,
      checked: true,
      remaining,
      floor,
      reason: `PANEL HALTED: OpenRouter credit floor — remaining $${remaining.toFixed(2)} < floor $${floor.toFixed(2)}`,
    };
  }
  return { halted: false, checked: true, remaining, floor };
}
