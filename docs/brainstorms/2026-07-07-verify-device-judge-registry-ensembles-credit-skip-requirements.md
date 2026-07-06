---
title: "tools/verify-device — EXTENSIBILITY: judge registry + judges.json + Codex + --ensemble kitchen-sink + credit-skip (requirements)"
date: 2026-07-07
trello: https://trello.com/c/5ty8uUzR
card: 5ty8uUzR
stage: brainstormed
status: requirements-locked
source_readonly: tools/verify-device
note: "Retrospective-honest — the implementation landed in ca28220 BEFORE this doc. This artifact locks the requirements the built code must (and does) satisfy, so the card advances through the pipeline with a real spec instead of a rubber-stamp."
---

# tools/verify-device: judge registry + ensembles + credit-skip — requirements & approach

Requirements/approach artifact for the `brainstormed → planned` transition. This card is an
**EXTENSIBILITY layer on top of the already-landed** `tools/verify-device` multi-model vision
panel (commit `eb55475`). The card body is blunt about why it exists: a prior respawn *claimed*
this layer was "already built" but only added a plan doc — `panel.mjs` had NO registry, NO Codex
judge, NO kitchen-sink roster, NO broadened credit-skip. This doc front-loads the four requirements
so any downstream worker can confirm the build against a spec rather than a promise.

## Honesty note (read first)

The implementation **already landed** in commit `ca28220` ("verify-device EXTENSIBILITY: judge
registry + ensembles + credit-skip"), verified at 77/77 vitest green. This doc is written *after*
that build to give the card a real requirements artifact for the pipeline — not to re-plan work.
Everything below was checked against the committed source (`judges.json`, `src/judges.mjs`,
`src/panel.mjs`, `src/args.mjs`, `src/grid.mjs`, `src/cli.mjs`) on 2026-07-07, not asserted from
the card text. Where the card's wording and the as-built code differ, the code is the ground truth
and the difference is called out.

## The headline that reframes the card

The panel that this card extends is **already count-agnostic and provider-uniform**: OpenRouter
fronts openai / anthropic / google behind one HTTP path, and aggregation is median-based over
*whoever answered*. That means the entire "extensibility" ask reduces to **selection + graceful
degradation**, not new transport or new adapters:

- **Selection** — move the hard-coded `DEFAULT_MODELS` list into a data file (`judges.json`) that
  names judges and groups them into ensembles, plus a pure resolver that turns
  `--ensemble <name>` / `--models a,b,c` into a roster.
- **Graceful degradation** — broaden the panel's existing per-judge skip from 404-only to the full
  credit/quota family (401/402/403/429) + timeout, recording each skip as `{judge, skipped, reason}`
  so a keyless or broke judge is *dropped, not fatal*.

No new provider adapters are needed *today*; the design only has to leave a **one-file seam** for a
future direct-provider adapter. That seam is the `provider` field (defaulting to `'openrouter'`),
consumed by `panel.mjs`'s model-call switch when a non-openrouter provider ever appears.

## Requirements (from the card AC, made testable)

### R1 — Judge registry in `tools/verify-device/judges.json`
Each judge is `{ id, model, provider, enabled, weight? }` where `model` is the OpenRouter id.
Two **named ensembles** ship:
- `default` — `opus` (anthropic/claude-opus-4.1), `sonnet` (anthropic/claude-sonnet-5),
  `gemini-flash` (google/gemini-3.5-flash) — the proven-working trio matching the panel's prior
  `DEFAULT_MODELS`.
- `kitchen-sink` — the full roster: the default trio **plus** `codex` (openai/gpt-5),
  `opus-4`, `sonnet-4.5`, `gemini-pro`.

`--ensemble <name>` selects a roster; `--models a,b,c` overrides (synthetic judges, `id === model`).
`provider` defaults to `'openrouter'` and is the future direct-provider seam.

**Acceptance:** loading the committed `judges.json` parses/validates; `resolveJudges({ensemble:'kitchen-sink'})`
returns all 7 enabled judges in listed order incl. `openai/gpt-5`; `--models` bypasses the registry.

### R2 — Codex/OpenAI as a registered kitchen-sink judge
`codex` → `openai/gpt-5` via OpenRouter, `enabled: true`, present only in `kitchen-sink`. It is
"enabled but auto-skipped until it has budget" — meaning it participates in selection but is dropped
at runtime by the credit-skip path (R3) when OpenRouter returns 402/404 for a judge with no budget.

**Acceptance:** `codex` appears in the resolved kitchen-sink roster; when its call returns 402/404 the
panel records `{judge:'codex', skipped, reason}` and still scores on the remaining judges.

### R3 — Broaden credit-skip in `panel.mjs` from 404-only to the credit/quota family
The per-judge skip must catch **401 / 402 / 403 / 429** (keyless / no-credit / forbidden /
rate-limited) **and timeout** (via `AbortController`), in addition to the existing **404** (model
absent, kept as a distinct reason). Each skip is recorded as `{judge, skipped, reason}` and the run
continues with whoever answered. This is load-bearing: **Gemini's real failure mode is 402/429**, not
404, so a 404-only skip would make a broke Gemini fatal.

**Acceptance:** a judge returning any of {401,402,403,404,429} or timing out resolves to
`{ok:false, skipped:<reason>}` rather than throwing; the panel PASSes on the judges that answered; the
grid lists participated-vs-skipped explicitly.

### R4 — Aggregation stays count-agnostic; tests cover selection + skip (mocked)
The median-based aggregation already tolerates any number of responders — **keep it, don't rework it**.
Extend the existing unit tests (no key, no device — mocked transport) to cover: registry parse/validate,
ensemble select, `--models` override, disabled-judge exclusion, the 401/402/403/429 + timeout skips,
judge-id threading onto every per-model record, and a `runPanel` roster where a 402 Codex is
skipped-and-recorded yet the panel still scores PASS.

**Acceptance:** `npx vitest run` green; `npx eslint .` clean.

## Footprint & non-goals

- **Footprint:** `tools/verify-device/**` only. No changes elsewhere. No PRs; one column; twf handoff.
- **Non-goals (explicitly deferred):**
  - No direct-provider adapters now — only the `provider` seam. Adding one later is a one-file change
    in `panel.mjs`'s model-call switch.
  - No `weight`-based aggregation now — `weight` is carried through the registry but not consulted
    (aggregation is median + count-agnostic). Reserved passthrough, not a feature.
  - No live-panel run here — that needs `OPENROUTER_API_KEY` + a real device/game manifest and is
    **conductor-run**. The non-device selection/skip logic (what this card is actually about) is fully
    exercisable with mocked transport.

## As-built confirmation (checked 2026-07-07, not assumed)

All four requirements are satisfied in `ca28220`:
- **R1** `judges.json` ships 7 judges + `default`/`kitchen-sink` ensembles; `src/judges.mjs`
  (`loadRegistry`/`parseRegistry`/`resolveJudges`) is a pure, key-free, device-free loader/resolver.
- **R2** `codex` → `openai/gpt-5` registered in kitchen-sink, `enabled: true`.
- **R3** `panel.mjs` defines `CREDIT_STATUSES = {401,402,403,429}`, keeps 404 distinct, adds an
  `AbortController` timeout, and `classifySkip(status)` returns the `{judge, skipped, reason}` note.
- **R4** aggregation untouched (median, count-agnostic); `npx vitest run` = **77/77 green** (was 63;
  +14 for the new selection/skip cases), `npx eslint .` clean.

## What `planned`/`worked` inherit

Because the code already exists and passes, the downstream `planned` and `worked` columns are
**honestly fast-trackable** — the card body + this requirements doc + commit `ca28220` are the spec and
the implementation. The only remaining *runtime* verification is the live OpenRouter vision panel with a
real key and a real device/game manifest (no `games/*/refs/manifest.yaml` exists in this worktree), which
is a **conductor-run** step outside this card's `tools/verify-device/**` footprint. Kitchen-sink model
ids for the non-default judges (`opus-4`, `sonnet-4.5`, `gemini-3.5-pro`, `openai/gpt-5`) are plausible
OpenRouter ids that auto-skip via 404/402 if absent or unbudgeted — swap for exact ids when those judges
get budget.
