# Judge backend calibration decision — 2026-07-31 (plan 2026-07-31-002 U4)

## Setup

60 stratified cases from the shipped 282-sprite corpus (31 deterministic-axis
failures + 29 passes, all 20 levels). Gold labels: `codex exec -m gpt-5.6-sol`
(60/60). Binary rule: subject < 0.5 = blocker-class defect → gold finds 32.

Original plan used OpenRouter `google/gemini-3.6-flash` for gold; the account
ran out of credits mid-run (402 at 740/740 used) after 9 labels, so gold moved
to the strongest subscription model. **Caveat:** gold and the codex contender
share a model family and CLI, which can inflate codex's agreement; mitigated by
(a) all codex disagreements sitting in the 0.4–0.6 gray zone, none on clear
defects, and (b) codex's verdicts matching the human visual audit on every
audit-known blocker (barrel, blob, parchment, lantern). Re-verify against
gemini-3.6-flash gold when credits exist.

## Results (vs gold-sol, n = judged cases)

| backend                        | n  | agree | FN | FP | MAE   | s/case | cost |
|--------------------------------|----|-------|----|----|-------|--------|------|
| codex (gpt-5.6 default)        | 59 | 95%   | 2  | 1  | 0.063 | 8.7s   | subscription |
| openrouter gemini-2.5-flash    | 60 | 82%   | 5  | 6  | 0.157 | 2.7s   | ~$0.01/case |
| ollama qwen3.5:27b (4090)      | 14 | 79%   | 2  | 1  | 0.096 | 68.7s  | free |
| openrouter gpt-5.6-luna        | 60 | 75%   | 14 | 1  | 0.181 | 7.6s   | ~$0.001/case |

Luna is disqualified outright: 14 false negatives including gold=0.0 cases
scored 0.9+ — it ships barrels. Flash false-alarms on clean birds. Ollama's
accuracy is fine but 69s/case makes a 282-sprite pass a 5.4-hour job, and it
monopolizes the 4090 that SAM2 masking needs.

## Decision

- **Default semantic judge: `codex` (CodexExecJudge, default model).**
  Free on subscription, 95% agreement, ~42 min per full-corpus pass.
- **Fallback batch lane: `ollama` on pato** when the codex usage window is
  exhausted (accuracy adequate, time abundant overnight).
- **Paid API lane** reserved for gold-label refresh and cross-family audits
  once OpenRouter credits are topped up; use the *current* catalog
  (gemini-3.6-flash tier), never recalled model ids.

Files: `cases.json`, `results_*.json`, `panels/`, `analyze.py`,
`results_gold-g25pro-superseded.json` (23 labels from the aborted 2.5-pro
run, kept for the record).
