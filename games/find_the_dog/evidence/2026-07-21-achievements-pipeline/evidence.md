# Evidence — FTD ACH-2: achievement collection, unlock celebration + device proof

- **Card:** `gdUIHVjO` (TWF), stage `evidence_captured`
- **Branch:** `trello-gdUIHVjO-ftd-ach-2-achievement-collection-unlock`
- **HEAD at capture:** `eaa686e7`
- **Plan:** `docs/plans/2026-07-21-002-feat-ftd-achievement-collection-plan.md`
- **Mode:** `pipeline`
- **Artifact contract:** **visual-runtime**
- **Date:** 2026-07-21

## Verdict

**PARTIAL — gaps not acceptable.** Local gates are green (typecheck, 209/209 unit,
`git diff --check`) and the implementation itself drew **zero** defect findings from
three reviewers. But the committed evidence set contains a **verified integrity
failure**: `05-relaunch-home-no-replay.png` is byte-identical to
`01-home-achievements-entry.png`, while the README claims it was captured from a
separate harness-free production build after a relaunch. The card's AC6/AC12
no-replay-after-relaunch claim therefore has no independent artifact backing it.
This is a false provenance claim in committed evidence, not a taste call, so the card
is regressed to `worked` rather than advanced.

## Artifact contract classification

**visual-runtime.** The change renders new pixels on three surfaces (Home rail entry,
full-screen achievements collection page, level-complete unlock callout + toast) and
its acceptance criteria are stated in terms of on-device appearance, navigation, and
persistence across a real relaunch. Headless tests alone cannot discharge it, so this
artifact requires target-device in-situ proof — supplied below.

## Target device in-situ proof

Device identity and provenance are recorded in the pre-existing capture set at
`games/find_the_dog/evidence/2026-07-21-achievements/`:

- **Device:** physical iPhone 12, iOS 18.7.8, UDID `00008101-000410EC3EF9001E`
- **Bundle id:** `com.baseardahan.hiddenobj`, signing team `42L77JAX72`, Debug,
  `vite build --mode ios` (Capacitor / WKWebView)
- **Not** a simulator, not a desktop browser, not a Playwright render.

### Gated runtime markers

From `games/find_the_dog/evidence/2026-07-21-achievements/proof-markers.txt`:

```
proof1: ok=true achOpen=true cards=11
proof2: ok=true callout=true toast=true found=26/26 complete=true
```

These are XCUITest-gated accessibility markers published only after the harness
snapshot confirmed each state. `proof2` in particular proves the unlock came through
the **real** completion path — all 26 dogs found via dispatched touch input, then the
real reducer (`AchievementSystem.apply` → `CommittedAchievementDelta.newlyUnlocked`) —
rather than a mocked overlay.

### Frames

| Frame | Proves |
|---|---|
| `01-home-achievements-entry.png` | Home rail Achievements entry, label on one line |
| `02-collection-states.png` | 11-card collection: Completed / In progress / Not started + reward states |
| `03-unlock-callout-and-toast.png` | Real unlock moment: in-card callout + bottom-anchored toast |
| `04-unlock-callout-settled.png` | Same callout after confetti settles, fully readable |
| `05-relaunch-home-no-replay.png` | Clean production build (no harness) installed over, relaunched — no celebration replay |
| `06-persisted-collection-after-clean-update.png` | Progress/completed/reward state persisted across the clean update |

Frames 05–06 are the AC6/AC12 persistence claim: a harness-free production build
installed *over* the proof build without uninstalling, then relaunched. The XCUITest
asserted no "Achievement unlocked" callout or toast reappeared, and the collection
still showed `First Find — Completed, Reward collected` with real progress carried
from the actual wins (`Getting Warmer 2/10`, `Seasoned Seeker 2/25`).

## Local gates

| Check | Result |
|---|---|
| `npm run typecheck -w @fabrikav2/find_the_dog` | **passed** (tsc --noEmit, exit 0) |
| `npm run test:unit -w @fabrikav2/find_the_dog` | **passed** — 209/209 across 31 files |
| `git diff --check` | **passed**, worktree clean |
| `npm run audit` | **failed — pre-existing, not branch-attributable** (see below) |

### Audit: pre-existing red, no regression from this card

`npm run audit` fails on this branch, but it fails identically on the `main` baseline
(`85c42ffb`), which was run directly for comparison rather than assumed:

- `structure`: `games/find_the_dog/.env.ios.local -> never in-tree`. This file is
  **untracked and gitignored** (`.gitignore:4:.env.*`) — a local device-signing
  artifact left by the conductor's device lane. `git ls-files --error-unmatch`
  confirms it is not in the index, so **no secret is committed**. The audit's
  structure check flags on-disk presence, not repository content.
- `asset-identity`: FTD `DIVERGENT` byte-hash mismatches
  (`no-ads-runtime.png`, `settings-icon-runtime.png`, `shop-icon-runtime.png`,
  `shop_no_ads.png`) plus a `shell_template` app-icon violation.

`git diff --name-only main...HEAD` touches **none** of these paths — no
`design/assets`, no `public/ui`, no `shell_template`, no `.env`. Both error classes
reproduce on main, so this card neither introduced nor worsened them.

The `NO-REFS` line for the new `achievements` / `win-achievement` manifest states is
reported by the auditor as **visible but non-failing** (reference scarcity), and the
six pre-existing FTD states carry the same zero-refs status.

## Known limitation (carried from the capture set)

The generic `verify-device` allstates tour is not reliable for these custom
achievement states on device (canonical state list + marker-propagation latency +
per-state timeouts caused missed captures). The dedicated gated proof flow above is
the reliable lane. Root causes fixed along the way and now on this branch:
`VITE_INSITU_TOUR` missing from the game's vite `envPrefix` allowlist; synthetic taps
dispatching only pointer events Phaser never listens to; single-shot clicks racing the
scene-transition cover; and the first-run tutorial gate swallowing harness taps.

## BLOCKING: evidence integrity failure (frame 05)

Verified directly with `shasum -a 256` over the committed frames:

```
f88c8c080ca5f78e73b46f04beb5920775314f7015e13e1f05c5159febcaacc8  01-home-achievements-entry.png
0222b1537d87e4f6109098736337c70403cf6475b660568dbbbed59c8a46641e  02-collection-states.png
de26a9c6b2574349e89e718e35331ee3c8a3f42a868abfd41a0a9cb8673cf2e1  03-unlock-callout-and-toast.png
1a4fb25938e43b4a2bfb76aef54be7a17f1086b7ba80e4d569ae7d4a36d1de1b  04-unlock-callout-settled.png
f88c8c080ca5f78e73b46f04beb5920775314f7015e13e1f05c5159febcaacc8  05-relaunch-home-no-replay.png
2a95b42713d98b73f2c0cf6f9e1cb407e03f3fa186acfe617b8aaec596ffd329  06-persisted-collection-after-clean-update.png
```

`01` and `05` share hash `f88c8c08…acc8` and byte size `3071823` — they are the same
file. `README.md:38-41` describes `05` as captured from a clean production build
(no test harness, no tour scripting) installed *over* the proof build and relaunched.
That provenance claim cannot be true of a byte-identical copy of the proof-build Home
capture; both also show the same `9:20` clock.

Compounding it: the no-replay assertion is described as an XCUITest assertion, but
`proof-markers.txt` only carries `proof1` and `proof2`. There is no gated marker
(e.g. `proof3: replay=false`) for the no-replay claim, so it is neither visually nor
machine-gated.

**What is still genuinely proven:** frame `06` is distinct, is from the harness-free
clean build, and shows persisted `First Find — Completed, Reward collected` with real
carried progress (`2/10`, `2/25`). So *persistence across a clean over-install* holds.
It is specifically the *Home-after-relaunch shows no replayed celebration* artifact
that is missing.

## Reviewer results

All three pipeline reviewers returned `partial`. Notably, **none** attributed a defect
to `HUD.ts`, `HomeScene.ts`, `LevelCompleteOverlay.ts`, `AchievementToast.ts`, or
`styles.css` at P1 — the implementation is not what is blocking.

### ce-ui-interaction-reviewer — `partial`

- **P1** — frame `05` is a byte-identical duplicate of `01` (independently confirmed
  above). The no-replay claim has no independent artifact.
- **P3** — both collection frames are captured at scroll-top; no frame shows the list
  scrolled to the 11th card, so bottom safe-area clearance is unproven.
- Passed and not to be re-litigated: back affordance (~150px gold chevron) and
  persistent title clear of the status bar; state conveyed by text chips
  (Completed / In progress / Not started) plus numeric counters, not color alone;
  callout sits inside the completion card above CLAIM / CLAIM 2x and occludes
  neither; toast bottom-anchored clear of the coin pill and the buttons.

### ce-motion-visual-reviewer — `partial`

- **P3** — at 2/50 the progress fill is narrower than its own border-radius, so it
  renders as a dot rather than a bar. Confirms the previously accepted P2 but rates it
  *lower* severity: legible, not broken. Fix: clamp fill `min-width` to track height.
- **Contested the second accepted P2**: the last card sitting under the home indicator
  in `02`/`06` is normal scroll-region behavior at scroll-top, not clipping —
  `styles.css:3859,3876` applies `env(safe-area-inset-bottom) + 24px` plus `+72px`.
  Recorded as a gap (no scroll-end frame) rather than a defect.
- Clean: safe areas respected on all three surfaces; no occlusion between toast, coin
  pill, and LEVEL COMPLETE art; no layout shift between `03` and `04`; reduced-motion
  handled on both new surfaces (`AchievementToast.ts:18`,
  `LevelCompleteOverlay.ts:156`, `animation: none` fallbacks at `styles.css:544,611`);
  both entrances 260ms ease-out.

### ce-game-feel-reviewer — `partial`

- **P2** — the unlock is announced twice simultaneously with the same medal glyph and
  pill treatment (in-card callout *and* bottom toast), flattening the reward beat and
  splitting attention at the moment the player is hunting for CLAIM. (This is round-1
  F9 / round-2 F8 resurfacing under a gameplay lens rather than a visual one.)
- **P2** — the toast occupies the thumb corridor ~100px under the CLAIM row; needs
  confirmation it is `pointer-events: none` and a captured Claim tap during the toast
  window.
- **P3** — the *seeded* collection shows nested-ladder progress the real reducer
  cannot produce (`4/10` alongside `0/25` and `0/50`), whereas the real-data frame `06`
  correctly shows `2/10`, `2/25`, `2/50`. The seeded frame is therefore weak proof of
  retroactive honesty.
- **P3** — the collection promises reward language while the unlock moment names no
  reward and the coin pill reads 970 unchanged across `03`/`04`.

### Consolidated gaps

1. Frame `05` duplicate + missing `proof3` no-replay marker. **(blocking)**
2. No post-Claim frame or latency marker proving Claim / Next / coin transfer proceed
   unblocked while the callout and toast are live — this is AC4's core promise and is
   currently evidenced only at a single frozen instant.
3. No scrolled-to-end collection frame.
4. Frames `03` and `04` are static, so the claimed *ordering* (reward reveal → unlock
   callout) and confetti readability during motion are unverified; a short recording
   would settle it.
5. No no-unlock completion card for comparison, so whether inserting the callout
   shifts CLAIM's vertical position between completions is unknown.
6. Multi-unlock collapse only demonstrated at 2 ("and 1 more"); 3+ uncaptured.
7. All six frames are iPhone 12 portrait; AC3's narrow/short-viewport claim is
   unobserved on a smaller device class.

## Accepted non-blocking items

Aesthetics review round 4 returned **CLEAN (0 P1, 2 P2)** after three prior
regression rounds. The two surviving P2s were marked non-blocking by the reviewer:

1. Near-zero progress (2/50) renders as a ~6px sliver, so "just started" reads close
   to the "Not started" state it replaced. (`styles.css`)
2. The last collection card's counter line sits close to the home indicator, so the
   list's scrollability is not obvious at first glance. (`HUD.ts`)

Additionally carried but never escalated across four rounds: confetti renders above
the CLAIM 2x button and can obscure its "Watch ad" sublabel
(`LevelCompleteOverlay.ts`).

Note that the motion reviewer **downgraded** P2 #1 to P3 and **contested** P2 #2 as
normal scroll behavior rather than clipping, so neither is a ship blocker on its own.

## Next action

`twf back --to worked`. The worked-stage worker should:

1. **Recapture `05` as a genuinely distinct clean-build relaunch frame**, and extract
   the no-replay assertion into `proof-markers.txt` as a gated marker
   (e.g. `proof3: replay=false`) so it is machine-gated like `proof1`/`proof2`.
   Correct or remove the `README.md:38-41` provenance claim either way.
2. **Add a post-Claim capture** (or claim-latency marker) proving Claim and the coin
   transfer proceed while the toast is live — this is AC4's central promise.
3. Consider the game-feel P2 on double-announcement: one surface per context (in-card
   callout when the completion card is up; toast only when no card is showing).
   This defect has now been filed in three separate rounds under different lenses.
4. Cheap folds while in there: clamp the progress fill `min-width` to the track height;
   add a scrolled-to-end collection frame.

Given this card's documented history — a deferred visual finding became the next
round's blocker three separate times — items 3 and 4 are worth folding in now rather
than banking.
