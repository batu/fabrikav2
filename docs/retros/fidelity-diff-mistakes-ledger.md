# Fidelity-diff mistakes ledger (2026-07-06)

Captured at Batu's instruction after the marble_run android→apple diff review.
Three failure classes: (A) diff-finding gaps, (B) lack of diffing rigor,
(C) harness problems. Each maps to a fix (twf card) below.

## A. Diff-finding gaps (recall failures — Batu caught, I missed)

A1. **App icon missing** — never checked the home-screen icon at all. Zero coverage.
A2. **Saga topology got BACKWARDS** — I claimed the *reference* saga had "alternating
    offsets"; reality: reference is a STRAIGHT-LINE saga, v2 is the one offsetting
    nodes left/right. A wrong finding, not just a miss.
A3. **Connector line intricacy** — reference level-connector is more detailed; missed.
A4. **Background is ANIMATED** — I said "flat/dot pattern"; missed that the reference
    background moves. Motion deltas need motion capture, not stills.
A5. **Fonts wrong** — Batu stressed this 4×; I consistently resolved font/asset
    differences to "flat/cheap polish" and color tokens. UNDER-WEIGHTED the single
    most important axis for a CLONE.
A6. **Logo text size differs** (possible sidegrade) — missed.
A7. **Particles are BETTER** — a positive delta; I reported zero positives (a diff
    should note improvements too, they're still deltas from the clone target).
A8. **Rotating menu board clashes with the static saga** — missed the clash.
A9. **No red glare on a blocked/mistaken hit** — missed the missing feedback.
A10. **Extra QUIT button on the fail card** that the reference lacks — caught the fail
     card broadly, missed the specific invented control.
A11. **"Settings has a Settings button in it"** — the invented Pause/Settings
     composition oddity; noted the invented pause, not this.

Precision (over-calls): flagged the menu board tilt/placement as a defect; Batu says
it's fine. Inferred the win card before capturing it.

**Systemic root cause:** for a CLONE, the core question is "is this the ACTUAL
reference asset/font/animation?" — I kept answering "close color/layout" and treating
asset identity as polish. Asset & font identity must be a FIRST-CLASS, per-asset diff
axis, not an inline aside.

## B. Lack of diffing rigor (process failures)

B1. **Not actually paired.** I compared v2 mostly against v1-WEB captures and inferred
    the android deltas, instead of placing android-device next to apple-device for
    each page. Only the WIN pair got a real side-by-side table. This directly caused
    A2 (backwards saga) and the loose findings.
B2. **Near-duplicate captures labeled as distinct states.** android level-start.png and
    level-mid.png are the same state (marbles barely move); I treated them as two.
    Same class as the level-1..4 terminal dupes Batu caught earlier.
B3. **Weak evidence presentation.** v2 settings(02)/fail(06) WERE captured but never
    shown paired, so the review read as "did you even screenshot these?" — the files
    existing isn't enough; the paired artifact is the deliverable.
B4. **Inference substituted for capture.** Asserted the win-card finding before the
    android win was captured. Findings must be evidence-backed, never inferred-then-
    presented-as-observed.

## C. Harness problems (why driving/capture kept failing)

C1. **Gameplay was LLM/random-bound, not solver-bound.** FIXED (card gknHRQYg):
    autoWin replays solveLevel().order; autoFail taps blocked marbles; both landed.
C2. **No queryable state gating.** FIXED: tour confirms snapshot().scene before capture.
C3. **Third-party reference is undrivable externally** — 3D-perspective board, no state,
    no solver, no coordinate accessor. Blind cell→pixel mapping only works for row 0.
    The only reference-driver is CV. See harness-ledger.md.
C4. **No paired-capture tool.** Every android+apple capture was hand-scripted ad hoc
    (adb one-liners, XCUITest runner, capture .mjs). Nothing lays a canonical-state
    grid side-by-side repeatably — the root enabler of B1/B3.
C5. **No per-state "driveTo" convenience.** Reaching each state for capture was bespoke
    (gear-tap, tap-storm, dev tour). A driveTo(state) that deterministically navigates
    to any named state would make capture-every-state one call.

## Fix map → twf cards
- C4 → paired-diff comparison tool (tools/refcap-compare): capture android(adb)+apple
  + auto side-by-side grid per canonical state.
- C5 → game harness driveTo(state) + full snapshot fields.
- A5/asset-identity → rigorous re-diff card with a first-class per-asset inventory.
- B1-B4 → rigor rules baked into the comparison tool's output (forces paired,
  evidence-backed, dedup'd) + the diff card's method section.
- UI findings (A1-A11 + Batu's list) → ranked fidelity-fix cards.
