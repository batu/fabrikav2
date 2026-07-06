---
title: "Reskin drill — acceptance test for zero-code-edit round-trip on marble_run"
date: 2026-07-06
trello: https://trello.com/c/MQPvX0qi
card: MQPvX0qi
stage: brainstormed
depends_on: 9SbVZcm7
status: requirements-locked
---

# Reskin drill — requirements

The **acceptance test of the v2 thesis**. The "Reskin bar" decision
(`docs/DECISIONS-2026-07-06-v2-kickoff.md:25`) says: *"Zero code edits. Designer/agent
edits sheets → ingester/apply regenerates tokens/assets/copy/config → build passes. Any
hand-edit of TS/CSS for a design change is a defect."* This card proves that bar holds
for a real game by running the **actual design-sheets round-trip** end-to-end on
`games/marble_run` and demonstrating the git diff falls **entirely inside
`games/marble_run/design/`**.

All file:line references below were verified live in both repos (fabrikav2 worktree +
`/Users/base/dev/appletolye/design-sheets`), not trusted from the card.

## 0. Constraints (hard)

- **v1 is READ-ONLY.** `/Users/base/dev/appletolye/fabrika` is never written.
- **No PRs, no deploys, no secrets, no external side effects.**
- **The round-trip is REAL, not simulated.** The conductor card-refresh comment supersedes
  the card body: DS9 (copy schema), DS10 (asset-binding apply), DS11 (generic fabrikav2
  ingester) all landed in the design-sheets repo (verified: commits `2ebb430`,
  `038233b`, plus copy/asset apply paths — see §2). The "simulating the apply output"
  fallback in the card body is **DEAD**. It is only permissible if the ingester/apply hits
  a real defect — and that defect is itself a **P1 finding to report**, not a quiet
  fallback.
- **Zero literal colors/copy/asset paths in `packages/ui`** — `--fab-*` tokens + injected
  copy/assets only; `tools/audit` (`npm run audit`) enforces. The drill must not
  regress this.
- ONE Trello column of work per stage; twf handoff between stages. This doc is the
  `todo → brainstormed` artifact; the actual drill executes at the `worked` stage.

## 1. What this card ships (scope)

Run the round-trip, changing **exactly three kinds of design input** and nothing else:

1. **Palette** — change at least one `--fab-*` color token (e.g. the accent
   `--fab-color-accent`, currently `#ff8a3d`). Edited in the sheet, not in `tokens.css`.
2. **5 copy strings** — change exactly 5 leaves in `copy.ts` (e.g. `menu.play`,
   `hud.hint`, `pause.title`, `result.win.title`, `settings.title`). Edited in the
   sheet's `copy/copy.json`, not in `copy.ts`.
3. **1 asset binding** — rebind **one existing slot** in `assets.ts` to a **different
   already-committed asset id** (see the §3 constraint — this must be a *value* change,
   not an add/remove).

Then **rebuild** and prove the diff is design-only.

### Acceptance criteria (unchanged from card)
- `git diff` shows **ZERO changes outside `games/marble_run/design/`** (and
  `docs/evidence/`).
- Build green.
- Before/after screenshot pair captured — **see §4, this is the soft spot**.
- Evidence folder `docs/evidence/2026-07-XX-reskin-drill/` containing: the `git diff
  --stat`, the screenshots (or the capture script + hand-off note), and a verdict.

## 2. The round-trip mechanics (grounded, exact commands)

The design-sheets repo (`/Users/base/dev/appletolye/design-sheets`, on HEAD `b53052c`)
drives everything. The **generic fabrikav2 ingester** is `ingesters/fabrikav2/run.mjs`;
`tests/fabrikav2-ingester.test.js` is a real, passing round-trip test that the plan
should mirror.

The "sheet" is **not** a spreadsheet — it is a local directory tree
(`docs/sheet-spec.md`): `sheet.json` (manifest), `tokens/mechanical.json`,
`copy/copy.json`, `assets/asset-index.json`, `cards/**`, and `.dsync/last-synced/` (the
snapshot `apply` diffs against). **Edits happen by hand-editing those JSON files** (or a
Fab Design Tokens card HTML + `dsheets pull-tokens`).

```sh
# From the design-sheets repo:
GAME=/Users/base/dev/appletolye/.twf-worktrees/trello-MQPvX0qi-.../games/marble_run

# (a) INGEST marble_run → a fresh sheet (game dir is read-only input)
node ingesters/fabrikav2/run.mjs --game "$GAME" --out sheets/marble_run

# (b) EDIT the three inputs in the sheet:
#   - palette:  sheets/marble_run/tokens/mechanical.json  (a --fab-* leaf's $value)
#   - copy:     sheets/marble_run/copy/copy.json          (5 leaves)
#   - asset:    the ts-asset-module binding value in tokens/mechanical.json

# (c) APPLY the sheet back into the game's design/ dir
npm run build
node dist/cli.js apply sheets/marble_run \
  --snapshot sheets/marble_run/.dsync/last-synced \
  --repo-root "$GAME"

# (d) Rebuild the game (from the fabrikav2 game dir)
npm run build --workspace=games/marble_run
```

- **Palette → `tokens.css`:** `apply` rewrites each `--fab-*` declaration in place via
  postcss-anchored `planCssVarReplacement`.
- **Copy → `copy.ts`:** `apply` rewrites TS string leaves in place via
  `planTsStringReplacement` (`src/apply/anchors.ts:41`). (There is a separate `dsheets
  copy codegen` path, but the round-trip contract uses `apply`.)
- **Asset binding → `assets.ts`:** `apply` rewrites a `ts-asset-module` leaf's value in
  place via `planTsAssetModuleReplacement` (`src/apply/anchors.ts:43`).

### Write-scope guarantee (why the zero-diff AC is sound)
`apply` resolves every write target through `resolvePathInsideRoot(repoRoot, ...)`
(`src/apply/edit-plan.ts:51`, `src/sheet/paths.ts:69`), which rejects any path escaping
`--repo-root`. The fabrikav2 ingester only ever emits `sourceMap.file` values of
`design/tokens.css`, `design/copy.ts`, `design/assets.ts` — so `apply --repo-root
<gameDir>` **can only write inside `<gameDir>/design/`**. Its only other writes are inside
the **sheet directory** (`change-brief.json`, `.dsync/last-synced/`), never the game repo.
The zero-diff acceptance test is therefore a genuine property of the pipeline, not luck —
**as long as the diff is scoped to the fabrikav2 game dir and does not also inspect the
design-sheets repo's own `sheets/` state.**

## 3. SURPRISES / defects the plan must design around

- **S1 — "1 asset binding" must be a VALUE rebind, not an add/remove.** DS10's `apply`
  only auto-rewrites `assets.ts` when an existing `ts-asset-module` binding's **value**
  changes. Adding or removing a binding slot is routed to `change-brief.json` and is
  **NOT** auto-applied (`src/commands/apply.ts:92-102`, `routeMechanicalChanges`).
  → The drill must **rebind an existing slot to a different asset id whose bytes are
  already committed** under `design/assets/`. Candidates present but currently unbound:
  `app-icon.png`, `icon-coin-sparkle.png`. NB: `assets.ts` holds asset *ids*; the runtime
  URL + Vite import lives in `theme.ts`. Confirm at plan time whether a rebind that has no
  matching `theme.ts` import still builds green, or whether the chosen rebind must target a
  slot whose id `theme.ts` already imports. **This is the single riskiest design choice in
  the drill** — pick a rebind that (a) is a pure value change and (b) keeps the game
  building. If no clean rebind exists, that gap is itself a **P1 finding** (asset-binding
  coverage hole), reported — not worked around by hand-editing `assets.ts`.

- **S2 — testkit has NO screenshot helper.** The card AC says "captured via testkit
  playwright helpers", but `packages/testkit/src/playwright/` exposes only state-driving
  helpers (`waitForHarness`, `callHarness`, `pollHarness`, `gotoAndWaitForHarness`,
  `waitForSceneActive`, canvas click/drag) and `savePlaywrightVideo` — **image capture
  must use Playwright's own `page.screenshot({ path })` directly.** There is no committed
  reusable capture script; prior evidence PNGs were produced by scripts that lived in
  gitignored `.work/` and were never promoted (`docs/retros/insitu-testing-capability-notes.md`).
  → The "captured via testkit playwright helpers" phrasing is aspirational. The realistic
  path is the card's own fallback: **author a minimal capture script and hand it to the
  conductor** (see §4).

- **S3 — Playwright does not run in the worker sandbox.** Repo convention, stated in code:
  `games/marble_run/tests/e2e/menu-clicks.spec.ts:9-12` ("Playwright does not run in the
  worker sandbox — see the card handoff"). Also, this worktree has **no `node_modules`**
  yet — `npm install` is required before any build/serve/screenshot. Chromium binaries are
  cached at `~/Library/Caches/ms-playwright/`, so no fresh download is needed once
  `npm install` runs. → Screenshot capture is **hand-off-to-conductor** work, not
  agent-inline. The `worked`/`evidence_captured` stages should author + commit the capture
  script and produce screenshots only if the running environment permits; otherwise hand
  the script to the conductor with exact run instructions.

- **S4 — There is currently no committed fabrikav2 sheet for the real marble_run.** The
  design-sheets repo has `sheets/marble-run-sugar3d/` but that is the OLD bespoke
  `ingesters/fabrika-sugar3d/` lineage (targets v1's `sugar3d`, not this design/ dir). The
  drill must generate a **fresh** sheet from `ingesters/fabrikav2/run.mjs`. Do not reuse
  the stale sheet.

## 4. Screenshot capture plan (the soft AC)

- Build depends on `npm install` at the fabrikav2 worktree root first (no `node_modules`).
- marble_run serves via `npm run dev` on port **5210** (`games/marble_run/vite.config.ts:14`);
  `games/marble_run/playwright.config.ts` already wires `webServer` + `baseURL`.
- A minimal capture script uses testkit's `gotoAndWaitForHarness`/`waitForSceneActive` to
  reach deterministic screens (menu, a level, settings, a result modal) then
  `page.screenshot({ path })`. Run it **once before** the round-trip (baseline) and **once
  after** (reskinned) into `docs/evidence/2026-07-06-1359-reskin-drill/`.
- Because of S2/S3, the deliverable at minimum is: the **committed capture script** + a
  hand-off note with exact commands, so the conductor (or a human outside the sandbox) can
  produce the before/after pair. If the executing environment allows it inline, capture
  directly and commit the PNGs.

## 5. Verification (card's own gate)

```sh
npm install                                             # worktree has no node_modules
npm run build --workspace=games/marble_run              # build green
npm run audit                                           # no-literals guard still passes
git diff --stat main -- ':!games/marble_run/design' ':!docs/evidence'   # MUST be empty
```

The empty scoped diff is the acceptance proof. Note the pathspec already excludes
`docs/evidence` and `games/marble_run/design` — the whole thesis is that **nothing else
moves**.

## 6. Decisions carried to the plan stage (not Batu's — plan-owned)

1. **Exact 5 copy strings** to change (visible-on-a-screen keys preferred so the
   before/after screenshots are legible).
2. **Which palette token(s)** to change (accent is the most visually obvious single edit).
3. **Which asset slot to rebind and to which committed id** — gated by S1 (must build
   green; may be a P1 finding if none is clean).
4. **Whether screenshots are captured inline or handed to the conductor** — gated by S3.

## 7. Open question for Batu (only if it blocks)

None blocking. The round-trip is real and landed; the only genuine unknown is whether a
clean asset-binding value-rebind exists (S1) — resolvable at the `worked` stage by trying
it, and if it fails, reporting the coverage gap rather than hand-editing. No Batu decision
is required to proceed.
