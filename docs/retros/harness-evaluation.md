# Harness evaluation — use it, grade it, improve it

Card **KEghp3x4**. This doc grades the reference-fidelity / GameHarness testkit by
_using_ it for the marble_run fidelity drill, then records the frictions each
consumer hit, the top-3 fixes landed in-card, and concrete card drafts for the rest.

Method: dogfood, not survey. Every grade below comes from actually driving the
surface (or, where noted, from reading the code + a prior committed run). The
fidelity surface was exercised end-to-end and its evidence is committed at
`games/marble_run/evidence/2026-07-06-1534-fidelity-harness/`.

- Verification for this card: `npm run typecheck && npm run test:unit && npm run audit` — all green (audit passes with the pre-existing sdk-duplication + copy-literal warnings).
- v1 is READ-ONLY; nothing in this card touched it.

## What was produced (USE)

- **Harness-produced fidelity grid** — `games/marble_run/tests/e2e/fidelity.spec.ts`
  drives ONE continuous harness session through the four reference-locked states
  (menu, settings, level-start, level-mid) using `SharedShellDriver` real DOM
  clicks (the gear→settings modal is a real click, dead-button-safe) + the
  `capture()` canvas witness, assembles the run with `collectRun()`, and pairs
  each v2 capture with its v1 Android reference into
  `evidence/2026-07-06-1534-fidelity-harness/fidelity-grid.html`. Regenerate with
  `PROMOTE_EVIDENCE=1 npx playwright test tests/e2e/fidelity.spec.ts`.
- **One real Gemini tier-2 verdict** — `evidence/2026-07-06-1534-fidelity-harness/tier2-gemini/tier2-gemini-verdict.json`
  (10 element-by-element findings on the menu pair). Reproduce with
  `tier2-gemini/judge_menu_pair.py`.

## Grading — friction per consumer surface

Friction score: **1** = frictionless (contract fit the need) … **5** = blocked /
had to hand-roll around the contract.

| Surface | Friction | What the contract gave | What it lacked |
|---|---|---|---|
| **chaos** (`tests/e2e/chaos.spec.ts`) | **1** | Seeded kernel `rand`, typed verbs (both flavours), `drainEvents()` — a chaos run is reproducible and side-effect-free by construction (landed in `f44dbcc`; not re-run here, read from code). | Nothing material. This is the surface the contract was designed for; it fits. |
| **fidelity** (this card) | **3** | `collectRun()` cleanly bundled screenshots/snapshots/events/perf. `SharedShellDriver.openSettings()` drove the real gear click. | No reference-pairing / grid primitive: ~90 lines of hand-written grid HTML + ref-copy fs glue per consumer. No reach-recipe manifest (state→refPath→axes is prose in a README, re-encoded per spec). `capture()` canvas witness is near-useless for DOM-chrome states (see below). **→ fixes 1–3 landed.** |
| **drill / reskin** (`docs/evidence/2026-07-06-1359-reskin-drill/`) | **4** | The in-page harness bridge (`window.__MARBLE_RUN_HARNESS__`) existed to drive states. | The drill's `capture-reskin-screenshots.mjs` is a **standalone `node` script** that re-implements the harness bridge, navigation, screenshotting, and fs writing by hand — it does NOT use `SharedShellDriver` or `collectRun`. Its evidence was harness-*bridged* but not testkit-*produced*. This card re-produces those states (menu/settings via `fidelity.spec.ts`; menu/settings/playing/pause/result via `collect-run.spec.ts`) through the real testkit, retiring the drill's hand-script provenance. |
| **device pull** (`capture.ts` `captureToDeviceDocuments`) | **5** (by design) | An honest typed stub that throws with a ledger-gap reference. | The path itself: no native documents-dir bridge exists, so no on-device v2 capture is possible. The stub is the _correct_ behaviour (loud, not silent) but the capability is a hard gap. Every v2 frame in this card is a Chromium/browser capture; this is stated in each artifact's README. |
| **page-card capture** (fabrikav2 ingester) | **n/a — not run** | `capture()` is the pipeline DS11 wanted. | Not exercised in this card (lives in the fabrikav2 ingester + design-sheets, other repos). Filed as **card draft DS13** below. |
| **Gemini tier-2 judge** (merceka-core) | **2** | Read the committed `refs/menu.png` + `screenshots/menu.png` straight out of the `collectRun` dir — the run layout was clean to consume. Returned 10 structured findings with severity+confidence. | Two frictions, neither in `collectRun`: (a) the Google-direct lane (GOOGLE_API_KEY, the card's intended path) is **billing-dead** — `429 RESOURCE_EXHAUSTED, prepayment credits depleted`; had to fall back to the OpenRouter Gemini lane (still merceka-core, still real Gemini). (b) merceka-core's `generate_with_resource` takes a **single** image, so the ref+candidate had to be composed side-by-side into one PNG — the two-image judge shape isn't a first-class merceka-core call. |

### Does the Gemini judge read collectRun artifacts cleanly?

**Yes.** The judge consumed the run dir's `refs/` and `screenshots/` PNGs with
zero adaptation to the `collectRun` layout. The only massaging was image
_composition_ (side-by-side), forced by the merceka-core `generate_with_resource`
single-resource signature — a merceka-core wrapper limitation, not a collectRun
one. Verdict: the run bundle is judge-ready.

### The tier-2 pilot's headline insight: state drift reads as skin drift

The Gemini verdict's top-severity findings were **game-state** differences, not
skin defects:

- "primary LEVEL button is LEVEL 1 vs LEVEL 2" (P1)
- "saga chain starts at 1 not 2 / current medal differs" (P1)
- "coin pill shows 0 vs 25" (P2)

These are **false positives** a human grader strikes: the v1 reference was
captured on a save with level 1 already cleared and 25 coins; the v2 harness run
starts from a fresh save. The reach-recipe never pinned save-state/economy before
capturing, so the judge cannot separate "the skin drifted" from "the save differs."
This is the single most actionable evaluation finding and is filed as a card draft
(pin deterministic state in the reach-recipe, or record the reference's state in
the manifest so the judge is told what's intentional).

## IMPROVE — top-3 fixes landed in `packages/testkit` (with tests)

All three target the **fidelity** surface (the worst-scoring one that this card
actually exercised). Each is dogfooded: `fidelity.spec.ts` was refactored to
consume them and re-run green.

1. **`buildFidelityGrid()`** (`src/harness/fidelityGrid.ts`) — a PURE, browser-safe
   HTML builder for the reference-vs-candidate grid (mirrors `runLayout.ts`).
   Kills the ~90-line hand-written grid every fidelity consumer was copying.
   Tests: `src/harness/fidelityGrid.test.ts` (rows, escaping, empty list).
2. **`writeFidelityGrid()`** (`src/playwright/fidelityRun.ts`) — the runner-side fs
   writer: copies matched refs into the run dir, writes the grid, and **reports
   paired/missing states** (the hand code detected a missing pair only via an ad-hoc
   `existsSync` filter, so a reference with no candidate could silently vanish).
   Tests: `src/playwright/fidelityRun.test.ts` (copy+pair, missing-by-side).
3. **`resolveEvidenceOutDir()`** (`src/playwright/fidelityRun.ts`) — centralizes the
   `.work`-vs-`evidence` promotion convention (`PROMOTE_EVIDENCE=1`) that every
   evidence spec was copy-pasting as a bare string literal.
   Tests: `src/playwright/fidelityRun.test.ts` (default work, promote env, explicit flag).

Net effect on the consumer: `fidelity.spec.ts` dropped its entire `gridHtml()`
function, its `ensureDir` + ref-copy loop, and its inline promotion check.

## Card drafts — the rest of the frictions (file these on the board)

> **CARD DRAFT — Fidelity reach-recipes must pin deterministic state.**
> The tier-2 judge flagged LEVEL 1-vs-2, saga-start, and coin 0-vs-25 as P1/P2
> deltas — all game-STATE, not skin. Before capturing a reference-locked state,
> the reach-recipe must set save/economy to match the reference (e.g. `unlockAll()`
> + `grantCoins(25)` + start at the reference's level) OR the manifest must record
> the reference's state so the judge is told what's intentional. AC: menu/level
> captures reproduce the reference's progression; tier-2 false-positive rate on
> state drops to zero. Depends on the manifest card below.

> **CARD DRAFT — `refs/manifest.yaml` (reach-recipe + axes) for marble_run.**
> Component 1 of `reference-fidelity-harness.md` does not exist. State→refPath→
> reach-recipe→per-axis strictness lives as prose in
> `refs/captures/android-basegamelab/README.md` and is re-encoded in each spec
> (`STATES` in `fidelity.spec.ts`, `enterLevel` duplicated between fidelity and
> collect-run specs). Ship a typed manifest both specs + the grid consume. AC:
> one source of truth for the state list; `enterLevel` de-duplicated into a shared
> testkit helper.

> **CARD DRAFT — `capture()` should signal a blank canvas witness.**
> `captureCanvasPng` rasterises only the canvas. For DOM-chrome states (marble_run
> menu/settings/saga), the canvas witness is empty/partial and a consumer can
> silently commit a blank PNG (`screenshots/level-start-canvas-witness.png` is the
> only meaningful one this card produced). Either detect an all-transparent capture
> and annotate it, or expose per-state "is this canvas-backed?" in the contract so
> the runner knows when the canvas witness is worthless and only the page composite
> counts. AC: a blank canvas witness is detectable, not silently shipped.

> **CARD DRAFT — merceka-core two-image judge call.**
> `generate_with_resource` takes one resource, forcing ref+candidate composition
> into a side-by-side PNG for a pair judgment. Add a two-image (or N-image) vision
> call so the tier-2 judge gets the images as distinct inputs (matches the
> `reference-fidelity-harness.md` tier-2 "ref+candidate pair" shape and dual-judge
> escalation). Also: the OpenRouter lane didn't enforce the JSON `response_schema`
> (the Google-direct lane did) — `overall_fidelity` came back as prose, not the
> enum; wire OpenRouter `response_format` for the judge. AC: a pair judgment with
> two image inputs + schema-validated JSON on both lanes.

> **CARD DRAFT — Google Gemini billing is dead (prepay credits depleted).**
> The card's intended tier-2 lane (GOOGLE_API_KEY direct) returns
> `429 RESOURCE_EXHAUSTED`. Top up AI Studio prepay or standardize the fidelity
> judge on the OpenRouter Gemini lane. Blocks making tier-2 a hard aesthetics gate.

> **CARD DRAFT — DS13: page-card capture round-trip.**
> Feed ONE harness `capture()` into the fabrikav2 ingester's page card for
> marble_run and confirm the design-sheet renders it (closes DS11's
> "structural-only page cards" follow-up). Not run in this card — lives in the
> fabrikav2 ingester + design-sheets repos. The DS13 webp-ingest fix is landed on
> design-sheets main, so `dsheets ingest games/marble_run` should now embed a real
> screen. AC: a design-sheet page card shows a harness-captured marble_run screen.

> **CARD DRAFT — design-sheets token round-trip re-run (cite on MQPvX0qi).**
> Re-run ingest→edit-one-token→apply→verify→REVERT on `games/marble_run` now that
> the DS13 webp fix is on design-sheets main, retiring the reskin drill's
> simulation caveat. Not run in this card (design-sheets is a separate repo and the
> drill card MQPvX0qi owns the caveat). AC: a real token round-trip, main's skin
> left untouched; caveat retired on MQPvX0qi.

> **CARD DRAFT (minor) — e2e leaves an audit-failing `test-results/` dir.**
> Running the harness e2e creates `games/marble_run/test-results/` (Playwright's
> default output), which the audit `structure` linter rejects even though it's
> gitignored. Either point Playwright's `outputDir` into `.work/` or teach the
> audit to ignore it. Low priority; cleaned by hand this card.

## Remaining for downstream stages / other repos

- **DS13 page-card capture** and the **design-sheets token round-trip** need the
  fabrikav2 ingester + design-sheets repos; carded above, not landed here.
- **Google-direct tier-2 lane** is billing-blocked; the pilot used the OpenRouter
  Gemini lane. Real Gemini verdict is committed regardless.
