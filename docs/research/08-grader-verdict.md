I have completed the full grading pass, including the mandatory independent sweep of both god-files, verification of the design-sheets gaps, and five quantitative spot-checks against the research files and the live v1 repo. Here is my verdict.

---

## VERDICT PER DONE-BAR ITEM

**1. Ranked bottleneck list — PASS (with one hard-number finding).**
Five items, ranked by measured cost, each tagged by evidence strength (Hard numbers / Doc-cited / labeled inference) with a concrete v2 fix. The failed session source is disclosed up front as an evidence caveat. Churn/fix-ratio numbers (styles.css 9,923 churn / 56 commits / 41 fix; GameScene 6,600/78/53; HUD 3,900/52/34; 52% of 552 commits) all reproduce exactly against research 03.
FINDING: bottleneck #4 ships a **false, now-stale CI claim** — see spot-checks below.

**2. v2 architecture — PASS.**
kernel/ui/sdk/services/testkit + tools/{create-game,audit} + configs + games layout, a layer diagram, a package-responsibility table with named v1 carry-overs, and 5 *enforced* guardrails. Concrete enough to scaffold from. The kernel/game boundary (zero-dep kernel, DOM-only ui, free gameplay canvas) is consistent with the locked substrate rule. Caveat: guardrail #4 repeats the stale "v1 covered 2 of 5" number.

**3. Extraction backlog — PASS (thorough, accurate citations; a few small helpers left buried).**
Spot-checked cited ranges against the actual files — all accurate: Toast HUD.ts:1370–1423 ✓, slide-up page shell 493–595 ✓, restore-purchases machine 964–1147 (183 lines ≈ "~180") ✓, prewarmLevel GameScene:444–527 ✓, capTextureLongEdge 2994–3017 ✓, playRestorationPickupAnimation 2308–2368 ✓, fail/continue 2014–2089 ✓. Dead-code claim (refreshCacheStatsLabel 1334–1350 / handleClearCacheTap 1351–1369, no referencing markup) confirmed. Rows carry sites + API shape + migration note, not generic filler.

**Reusable components the backlog MISSED (my own god-file sweep):**
- **Canvas↔DOM coordinate bridge — `counterTargetPoint()` (GameScene.ts:2254–2271), `viewportToScrollFactorZeroPoint()` (2244–2252), `levelToViewportPoint()` (2236–2242).** `counterTargetPoint` resolves a DOM HUD element's `getBoundingClientRect` into a Phaser canvas coordinate. This is the load-bearing primitive that lets a canvas sprite fly to a DOM HUD counter — i.e. it is exactly what the backlog's own "EconomyTransfer coin-fly" row's cross-substrate `to`-target depends on, yet it is never itself listed with a home/API. Research 07 flagged these (R43/R44) but the report dropped them. **Most significant miss.**
- **`pulseDogCounter()` → `retriggerCssAnimation(el, className)` (GameScene.ts:2300–2306).** The "force reflow (`void el.offsetWidth`) to re-trigger a CSS animation" idiom — a generic DOM-shell utility. Research R46 explicitly named it a candidate; backlog omits it.
- **`isTapRelease()` tap-vs-drag squared-distance discriminator (GameScene.ts:1143–1149).** Reusable input primitive for any canvas game; backlog omits it.
- Minor: `getRendererKind` (2167–2172), `refreshCanvasTexture`/`desaturateImageDataInPlace` (2975–2992) — small reusable Phaser/canvas utils, omitted.

No *large* subsystem was left buried — the misses are small helpers — so this stays a PASS, but the coordinate bridge should be added because the report leans on it implicitly.

**4. design-sheets wiring — PASS; named gaps VERIFIED.**
Mechanism is explicit: standardized `games/<g>/design/` (tokens.css/copy.ts/assets.ts), one generic ingester, three new design-sheets capabilities, and a `dsheets build → claude.ai/design → diff/apply` round-trip with structural changes routed to a change-brief card. Both claimed gaps hold against the actual repo:
- **No copy schema** — CONFIRMED: 4 schemas only; tokens sourceMap `enum` is `css-var|ts-const|ts-string`, none model natural-language copy.
- **apply refuses DOM-import asset bindings** — CONFIRMED: `src/apply/change-brief.ts` `serializeAssetBindingChangeContent` emits literally `"reason: v0 apply does not rewrite DOM import asset bindings"`. (Minor: report cites lines 79–90; the string sits in that function — worth a line-range recheck.)

**5. Migration path + your-decisions — PASS.**
7 ordered steps with live status tags (matches locked pilot = marble_run/sugar3d and the cheapest-first SDK order), plus 6 decision cards including the session-history tooling gap this research surfaced. No contradiction with the locked decisions.

---

## ADDITIONAL CHECKS

- **Evidence honesty (failed session source): PASS.** The §2 callout and §7 decision card both present research 02 plainly as a failed source, name the missing `ce-session-inventory`/`ce-session-extract` skills, and state no synthesis was done — matching 02-session-history-FAILED-SOURCE.md. Not synthesized around.
- **Placeholder rule: PASS.** The only "placeholder"/"TODO" hit is content *describing* design-sheets' own disclosed "TODO capture" page cards — legitimate, not filler.
- **Self-containedness: PASS.** No external script/font/style/image URLs (grep clean); system font stack; charts are pure CSS (no images). Light + dark handled via `prefers-color-scheme` plus `data-theme` overrides in both directions.
- **Consistency with locked decisions: PASS.** DOM-shell/free-canvas, thin kernel, zero-code reskin, pilot = marble_run, full-SDK bar all honored; nothing contradicts DECISIONS.

**Five quantitative spot-checks (+ the failure):**
1. Churn/commit/fix numbers — VERIFIED exact vs research 03.
2. Audio rewrite line counts — VERIFIED vs live repo: arrow 80, block_blast 44+337=381, FTD 458+551=1009, marble 145+245=390, ≈1,860 total (block_blast files live at `src/audio/`, not `src/ui/`, but the report gives no path).
3. Haptics extraction dates (core 2026-04-27, after block_blast 03-05 / FTD 04-14 / arrow 04-18) — VERIFIED vs research 03.
4. Phantom deps (find_the_dog/block_blast/arrow import `@fabrika/core` with no package.json dep; only sugar3d declares it) — VERIFIED vs live package.json + research 06.
5. Broken `grep-affected-games.sh` (greps `from "@fabrika/core` double-quoted; all game imports single-quoted → always "safe to remove") — VERIFIED vs the live script (line 39) + FTD imports.
6. §1c coin-fly magic numbers (marble_run drift 84px / 760ms) — VERIFIED in dom.ts:690,695.

**FAILED spot-check → the report's one hard error:** Bottleneck #4 states *"CI runs exactly 2 jobs (core, find_the_dog) out of 5… block_blast, arrow, and marble_run have zero CI"* and guardrail #4 says *"v1 covered 2 of 5."* The **live v1 `ci.yml` has FIVE unconditional jobs**: `core`, `find_the_dog`, `arrow`, `block_blast`, `sugar3d`. Git shows commit `b2a18cf39 "ci: add root workspace gates for zero-CI games"` added the missing jobs *after* research 01 was written but before the report's HEAD (2026-07-06). Research 01 was true when captured; the report shipped it stale. An independent grader checking the read-only v1 repo now finds the claim false. The *rest* of #4 (phantom deps, no build/version discipline, broken audit script, toolchain drift vitest ^3 vs ^4 / Capacitor ^8.1 vs ^8.3) remains verified-true, so the bottleneck is directionally sound but leads with a wrong headline number.

**Soft numeric note:** §3 (No design pipeline) cites style.css "197 hex literals (112 unique)… 817 px". My independent regex on the current file gives ~140 hex / 797 px / 2,509 lines (rgba 227 matches exactly). Traceable to research 05 (so not fabricated), but the hex figure isn't cleanly reproducible — likely a counting-method difference. Minor.

---

## PRIORITIZED FIX LIST

1. **[HIGH] Fix the CI claim** in bottleneck #4 and guardrail #4. v1 now runs 5 CI jobs (core + all 4 live games) after `b2a18cf39`. Either restate as current reality or reframe as "was 2 of 5 until a late fix," and re-ground the v2-fix rationale on the gaps that are still true (phantom deps, no built/versioned core artifact, broken audit script, toolchain drift).
2. **[MED] Add a backlog row for the canvas↔DOM coordinate bridge** — `counterTargetPoint` (GameScene.ts:2254–2271) + `viewportToScrollFactorZeroPoint` (2244–2252) + `levelToViewportPoint` (2236–2242) → v2 home kernel (or ui); API e.g. `resolveDomAnchorToCanvasPoint(el, canvas, logicalW, logicalH)`. It is the reusable dependency of the existing EconomyTransfer row and is currently buried.
3. **[LOW] Add `retriggerCssAnimation(el, className)`** (from `pulseDogCounter`, GameScene.ts:2300–2306) and **`isTapRelease`/tap-vs-drag threshold** (GameScene.ts:1143–1149) to the backlog (kernel/ui). Optionally note `getRendererKind` / `refreshCanvasTexture` / `desaturateImageDataInPlace` as minor Phaser/canvas utils.
4. **[LOW] Reconcile the style.css hex count** (report 197 vs independent ~140) — soften to a range or document the counting method.
5. **[LOW] Recheck the change-brief.ts line citation** (report says :79–90; the load-bearing string is in `serializeAssetBindingChangeContent`).

**Bottom line:** All five done-bar items PASS. The report is self-contained, placeholder-free, honest about the failed session source, and consistent with the locked decisions; its design-sheets gap claims and most quantitative claims verify true. Two things keep it from clean: (a) one hard, cheaply-checkable false number (CI job count in bottleneck #4/guardrail #4), and (b) a small but real completeness gap in the extraction backlog — chiefly the canvas↔DOM coordinate bridge that its own EconomyTransfer row silently depends on.