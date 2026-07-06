# Harness ledger — what failed driving marble_run to terminal states, and the fix

Live ledger (Batu-requested, 2026-07-06). Records why on-device/reference capture
of win/fail states kept failing and the principles that fix it. Feeds the
testkit GameHarness contract + the reference-fidelity harness.

## The failures (in order they happened)

1. **Blind coordinate tapping on the ANDROID reference.** No harness exists in
   com.basegamelab.marblerun (a third-party APK). I drove it via `adb input tap`
   at pixel coordinates read off screenshots. Problems, all real:
   - **Coordinate drift**: guessed marble centers missed; the board barely moved
     across ~40 taps.
   - **No state readback**: I couldn't ask "did I win / how many hearts / which
     marbles are blocked" — only screenshot-and-eyeball, which is slow and I
     misread it (declared a capture attempt while still in the level).
   - **Mistakes are inherent to guessing**: tapping movable marbles clears them
     (no progress toward a fail), tapping blindly burns hearts unpredictably.
     The sweep "won some, lost some" RANDOMLY, then a low tap hit Watch-Ad →
     played a test ad → clicked through to the Play Store.
   - **Terminal-state race**: even when a win/fail card appeared, the same tap
     stream dismissed it before capture.

2. **The v2 in-app tour played RANDOMLY.** insituTour used `tapUnlockedMarble`
   with `Math.random()` rolls — so it also won/lost by luck, not design. It
   also `sleep`-guessed timings instead of confirming state.

## Root cause (Batu's diagnosis, correct)

Two things were LLM/guess-bound that must be MACHINE-bound:

- **Playing-to-win is a deterministic search problem** — the marble-board solver
  (`solveLevel()`, A-star/wave peel) already exists and returns the exact winning
  tap `order`. Gameplay drivers must REPLAY solver output, never sample a policy.
  "In-game A*/search-bound, not LLM-bound."
- **State must be QUERYABLE** — the harness `snapshot()` reports
  `{scene, status, inputReady, hearts...}`. A driver must gate every transition
  on a state query, never assume ("did I actually win?" was the tell).

## The fix (landed 2026-07-06)

- `App.harness().autoWin(stepMs?)` — replays `solveLevel(currentLevelDef).order`
  via `tapCell`, stops if status leaves 'playing', returns `status==='won'`.
  Deterministic; verified in browser: `autoWin=true scene=complete status=won`.
- `App.harness().autoFail(stepMs?)` — taps genuinely-BLOCKED marbles
  (`allMarbles() − movableMarbles()`) until `status==='failed'`. Verified:
  `autoFail=true scene=failed status=failed`.
- `GameController.currentLevelDef()` — exposes the active level to the solver.
- insituTour rewritten: solver-bound win/fail + confirms each via `snapshot()`
  before dwelling for capture; logs its state decisions to the device console.

## Principles for the GameHarness contract (portfolio-wide)

1. **Every game exposes a deterministic `autoWin`/`autoLose` (or `driveTo(state)`)
   bound to its own solver/AI, not to the caller's guesses.** A game without a
   solver ships a scripted deterministic move list instead.
2. **Every driver gates on `snapshot()` state, never on sleep-and-assume.**
3. **Capture is a separate step from driving** — drive to state, CONFIRM state,
   then screenshot. Never in one tap stream.

## The android-reference exception (honest gap)

The third-party APK has none of this — no harness, no state query, no solver
access. Driving it is inherently blind. What worked: settings + fail were
reachable by careful single-target taps (fail = repeatedly tap one blocked
marble, screenshot the instant the card shows, tap nothing else). WIN on the
reference remains the one state I could not reliably reach by blind taps on a
complex level (green marbles' gate alignment unknown; no solver for THAT board).

Resolution options (Batu's call):
- (a) Accept the reference WIN card is inferable — settings + fail prove the
  ribbon/card visual language (red 'FAILED' ribbon + blue card; win = green
  'LEVEL COMPLETE' equivalent), which is enough for the fidelity delta.
- (b) A CV-assisted android driver: detect marble grid + colors from a
  screenshot, feed a board state into `solveLevel()`, map `order` back to pixel
  taps. This is the general "clone off a running reference" capability — bigger,
  but it makes ANY reference game drivable. Worth a card if we do more clones.

## UPDATE: solver-bound android replay ALSO failed — root cause is 3D projection

Applied the deterministic approach to the reference: computed `solveLevel(LEVELS[3]).order`
(level 4, 19 moves, waves [6,6,6,1]), verified the fresh android board matches the
level def (blue@col4/row0, the col1 gap in the bottom row — orientation confirmed),
calibrated a uniform 6x6 cell→pixel grid, and replayed the 19 solver cells as adb taps.

Result: only move 1 ({4,0}, top row) cleared; moves 2-19 landed in the GAPS between
marbles. Hearts stayed 5 (no blocked mis-hits), so taps hit empty space, not wrong
marbles. Retried with 1.6s settle (ruled out animation-lock). Root cause:

**The reference board is rendered in 3D PERSPECTIVE, not a flat grid.** A uniform
cell→pixel mapping is only correct for row 0; lower rows are foreshortened by the
camera. External tapping needs the game's own projection matrix, which a third-party
APK does not expose. This is the hard limit of driving a reference game blind.

Confirms the harness thesis from the other direction: v2 games are drivable because
they expose state + solver + a coordinate accessor (`cellClientPoint`); a reference
game exposes NONE of these, so it is fundamentally not auto-drivable by coordinates.

**The only reliable reference-driver is CV** (detect marble pixel centres per-frame,
tap detected positions) — carded as the general "clone off a running reference"
capability if the studio does more reference-driven ports. Not built today.

**Android WIN reference: documented gap.** Captured on the reference: menu, settings
(from-menu RESTART/HOME + in-level RESTART/HOME), level, FAIL (red-ribbon 'LEVEL n
FAILED' + blue card + crying emoji + green primary/yellow RETRY). The WIN card is the
green-ribbon 'LEVEL COMPLETE' analog of that proven card language — inferable for the
fidelity finding without the exact pixel. v2 WIN captured on device (flat cream card).
