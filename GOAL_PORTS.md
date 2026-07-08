# GOAL: Port the portfolio — FTD, block_blast, arrow onto fabrika v2 (and mine the platform through it)

You are Claude Fable, CONDUCTOR for fabrikav2 (board scratch-2). Batu is asleep. Do not block; decide
reversible things, post taste decisions to Gallery as you make them (proceed on best-guess; morning verdicts
become revision cards). Keep appending to .work/overnight-ledger.md — the per-game platform-gap scorecards
and the cross-game synthesis are THE PRIMARY DELIVERABLE alongside the ports themselves.

## Worker fleet policy (Batu, explicit)
GPT-5.5 (codex) ONLY for subagents/workers. If codex hits capacity: WAIT and retry on a timer (conductor
requeue loop; capacity-park where twf supports it) — do NOT reroute to claude. Headless codex invocations
use `command codex exec ... </dev/null` (the shell-wrapper stdin-hang) and prompts instruct COMMIT AFTER
EACH COHERENT UNIT (capacity deaths ×2 were salvaged from uncommitted trees — don't rely on salvage).
Conductor (you) still does: landings (`twf land` — live-fire it on its first real landing), device runs,
Gallery posts, reviews. Cards get `Classification: direct-to-work` in the body — the feature is live; no
more stage-crawl.

## The two IRON LAWS + the practice rules (AGENTS.md — binding)
Device-first (NEVER web — Batu re-affirmed for this run: FTD verifies on the iPhone, arrow+block_blast on
the Pixel; a web render is never evidence). Autonomy in agents, not tools. First live run is part of the
build. Verify per-SURFACE with pixel evidence (crops, eyes) — a score is not verification of a named
defect. Composed-surface tests over component-flag tests.

## Sources & targets
- v1 sources (READ-ONLY): /Users/base/dev/appletolye/fabrika/games/{find_the_dog, block_blast, arrow}
- Ports land in fabrikav2/games/{find_the_dog, block_blast, arrow} via create-game + port-carry
  (engines carried near-verbatim; discretionary bug fixes allowed; flow → kernel; shell/harness/design per
  the marble_run pattern; REQUIRED harness incl. solver-bound winLevel/failLevel + driveTo + tour).
- Bundle/application IDs: com.basegamelab.<game>.dev (NOT appletolye).
- References (shipped builds, capture at-rest state-normalized refs):
  · FTD: com.baseardahan.hiddenobj v1.0.2 — INSTALLED ON THE IPHONE. FTD is the most polished app; the bar
    is FOR-SURE-COPY: preserve its saga EXACTLY, converge screens vs its captures (marble-run loop).
  · arrow: com.ecffri.arrows — INSTALLED ON THE PIXEL (adb -s 27091JEGR22183 via ssh ubuntu-server;
    VERIFY foreground via dumpsys before every capture).
  · block_blast: shipped android build exists — find its package on the Pixel (pm list) or ask the v1 repo
    docs; capture refs likewise.
- ANDROID BUILD LANE (new machinery — budget a first-live-run shakedown): v1's android builds live at
  ubuntu-server::utolye/fabrika — study how v1 built (gradle, SDK at /home/batu/android-sdk). For v2:
  sync/checkout fabrikav2 on ubuntu-server, cap add android per game, gradle build, adb install to the
  Pixel. Android capture driver: the tour's tourstate markers are in the a11y tree — element-gate via
  `adb shell uiautomator dump` polling for EXACT tourstate:<state> (port the publish/retire protocol
  semantics), screencap via adb. Wire as a driver behind the existing capture interface (pixelsmith/
  verify-device lane) — this IS the android driver those tools were designed for. Content-inset per the
  Pixel's bars. All of this lands as normal carded work.

## The saga question (Batu's test — figure it out, don't ask)
FTD HAS a saga: preserve it exactly. arrow + block_blast DON'T: ADD the saga using the v2 kit. Derive the
progression semantics from each game's own structure (hypothesis to verify in their code: each already has
internal level/stage data or a natural difficulty progression to surface — e.g. authored puzzles/boards).
WRITE THE DERIVATION + reasoning in the ledger BEFORE implementing; post the saga-skin taste choices to
Gallery. Leeway lives here — house-kit-native, reference-consistent, your best judgment. Workers designing
NEW (no-reference) surfaces for these two may load the frontend-design skill; fidelity-copy work never
needs it.

## Sequencing
0. Land in-flight first: eyebrow attempt-2 (device-crop close-out, eyes on), MINE2 trio (crops-mode,
   orphaned-token, create-game-deps — create-game-deps ESPECIALLY lands before scaffolding 3 games).
1. UI-KIT single-path refactor (DtGn2S4J) LANDS BEFORE the ports — three new consumers must consume the
   cleaned kit, and the ports are its proof. Then MINE2-1/2-4 agency polish + MINE-3 + MINE2-2 gallery as
   codex capacity allows.
2. FTD port (iPhone lane, machinery proven): scaffold → carry engine+saga+levels → design/assets ingested
   from v1 (asset-identity manifest from day one) → reference captures from the shipped app (at-rest,
   state-normalized) → marble-run convergence loop (worker fix → land → device panel → judge → iterate)
   toward ≥85/floor or honest plateau-park with grids.
3. Android lane bring-up (can start in parallel with FTD's convergence turns): build+install+capture-driver
   proven on ONE game first (block_blast or arrow, whichever builds cleaner), then both games: scaffold →
   carry engine → ADD saga (derived semantics) → refs from shipped builds → converge as far as the night
   allows.
4. Gallery: post every taste decision + each game's before/after as it stabilizes; morning queue for Batu.

## Floor commitment (Batu-agreed)
If the android lane fights back: acceptable morning state = FTD deep/converging + android build+capture
lane ESTABLISHED + arrow & block_blast scaffolded and playable with sagas, convergence pending. Overshoot
if the night is kind. Never fake progress past the floor — park with evidence.

## The learning half (do not skimp — "this is the important bit")
Per game, a ledger scorecard: what create-game/_template/kit/harness/audit got right, what needed manual
work (that delta = the platform gap-list), which task classes reworked vs sailed, saga-derivation notes,
android-lane findings. End with a CROSS-GAME SYNTHESIS: where fabrika v2 genuinely works, where it should
improve, concrete next cards. Mine the ledger as a CLOSING RITUAL (it grew after the last mining — sweep
again before drain).

## Machinery & budget notes
- twf land (live-fire pending), classification, rubber-stamp/commit gates, land-gate exit-checked, on-main
  before cleanup, quota auto-resume (workers) + --and-wake (conductor) all live. caffeinate stays on.
- OpenRouter ≈$50, floor $5, default ensemble only. Panels ~$1/run — FTD convergence fits comfortably.
- iPhone must stay plugged/unlocked; Pixel via ubuntu-server adb. Never web. No deploys/stores/publishing;
  fabrika v1 stays READ-ONLY; sandbox creds only.
