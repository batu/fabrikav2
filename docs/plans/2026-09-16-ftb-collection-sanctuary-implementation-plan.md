# FTB Collection + Sanctuary: release 1 implementation plan

Status: ready for implementation by an autonomous agent. Branch
`feat/ftd-collection-sanctuary` (worktree `fabrikav2/.worktrees/ftd-collection`,
sparse: `games/find_the_bird`, `games/shared`, `packages`, `docs/plans`,
`docs/solutions`, `docs/sanctuary-exploration`). Design doc:
`docs/plans/2026-09-16-ftb-collection-and-sanctuary.md` (its top
"Simplification" block is authoritative). All art is generated and installed;
this plan needs **no new art**.

Read before touching code: `games/find_the_bird/README.md`, `AGENTS.md`,
`design/style-guide.json`, `src/ui/HUD.ts` (openPage), `src/ui/homeNavigation.ts`,
`src/ui/AchievementsPage.ts` (closest sibling page), `src/core/GameState.ts`
(wallet, persistence, storage keys), `src/scenes/GameScene.ts` (`onDogFound`),
`src/ui/EconomyTransfer.ts`, `src/ui/iconPreload.ts`,
`public/ui/sanctuary/manifest.json`.

## 1. Goal

Ship the first slice of the bird meta-game in Find the Bird on the physical
iPhone build:

- **Collection** page: a swipe deck with two cards. Card 1 is the **Sparrow** in
  four states (silhouette → plain → hat → cardigan) driven by a pickup counter.
  Card 2 is the **? card** (locked placeholder).
- **Sanctuary** page: one tree, one nest box the player **buys**, upgradable
  through **three tiers**, a **coin pickup** that accrues while away, and the
  **placed sparrow** standing on the pedestal in its current costume.
- **Gating**: Collection tile unlocks after **level 5** is completed. Sanctuary
  tile unlocks when **10 sparrows** have been collected.

Definition of done: every row of the verification checklist (§9) is captured on
the iPhone, judged PASS by the agy image pass (§8), unit suites are green, and
the PR carries the evidence folder. "It builds" and "tests pass" are not done.

## 2. Player journey (acceptance script)

1. **Levels 1–4.** Home shows the Sanctuary and Collection tiles locked exactly
   as today (padlock, roll-shake on tap). Sparrow pickups count silently from
   install; no back-fill for older saves.
2. **Level 5 completed.** Next time home renders, the Collection tile is
   unlocked and plays a one-shot pop (scale bounce, padlock fades). Persist that
   the pop played.
3. **Collection, first open.** Deck of two cards, snap-scrolled horizontally,
   page dots under the deck. Card 1: frame + **silhouette** portrait, plaque
   "Sparrow", ribbon "Garden bird", bubble shows three dashed lines, progress
   "n / 10" with label "Unlock". Card 2: frame + **? portrait**, plaque "? ? ?",
   ribbon "Coming soon", dashed lines, no progress bar.
4. **In level.** On a sparrow pickup a small chip "+1 sparrow" appears at the
   find point (same slot as FindPraise). Non-sparrow pickups show nothing new.
5. **10 sparrows.** Next home render: Sanctuary tile unlocks with the same pop.
   Collection card 1 now shows the **plain** portrait (flip animation on first
   view, persisted), the three copy lines, progress "10 / 20" labelled "Hat".
6. **Sanctuary, no house.** Tree background, **plot marker** on the branch at the
   house anchor. A bottom sheet "Build a nest box" with the price and a sky-blue
   **Build** pill. If coins < price: pill disabled, text "Need N more", and a
   small "+" that opens the shop scrolled to coins. Build: coins fly from the
   wallet pill (EconomyTransfer), marker pops away, tier-1 house drops in with
   a squash. Empty pedestal shows the **pedestal-empty** marker, gently pulsing.
7. **Place.** Tap the pedestal marker: sheet "Who moves in?" with the sparrow
   card thumbnail and a **Place** pill; the ? card thumbnail is shown locked.
   Place: sparrow body sprite drops onto the pedestal with a squash, contact
   shadow fades in, idle tweens start. Tap the bird: a hop and the find SFX.
8. **Coins.** With a bird housed, coins accrue per hour up to an offline cap.
   When ≥ 1 coin is pending the **coin pile** shows on the branch beside the
   house with a "+N" chip. Tap: coins fly to the wallet pill, pile hides.
9. **Upgrade.** Tap the house: sheet "Nest box · Tier 1", next-tier gains
   ("+1 perch", "+coins per hour"), price, **Upgrade** pill; ghost of the next
   tier drawn at 40% over the house while the sheet is open. Buy: sprite swaps
   with a puff; new pedestal shows the empty marker. Tier 3 sheet says "Max
   tier".
10. **Costumes.** At 20 sparrows the card shows the **hat** portrait and the
    housed bird swaps to the **hat** body. At 35, **cardigan**; progress reads
    "Complete".
11. Extra pedestals stay empty with the marker; the picker only ever offers the
    sparrow in release 1. That is intended.

## 3. Numbers (remote-config keys, defaults, one place)

Add to `src/config/remoteConfigSchema.ts` + `remoteConfigTemplate.ts`, snake
case remote keys, descriptions like the existing entries:

```
collectionUnlockLevel        5
sparrowUnlockCount           10
sparrowHatCount              20
sparrowCardiganCount         35
housePriceTier1              150
housePriceTier2              300
housePriceTier3              900
sanctuaryCoinsPerHourTier1   3
sanctuaryCoinsPerHourTier2   6
sanctuaryCoinsPerHourTier3   10
sanctuaryOfflineCapHours     4
```

## 4. Data

### 4.1 Bird type tags (build-time file)

`public/levels/bird-types.json`:
`{ "version": 1, "levels": { "<levelId>": { "<dogId>": "sparrow" | "robin" | ... } } }`
covering every level in `public/levels/bundled-manifest.json` (44 today).

Generate with the classifier already used for the 10-level count:
`docs/sanctuary-exploration/vertical-slice-2026-09-16/birdtypes/classify.py`
(+ `retry.py`). Call shape, prompt attached to `-p=`:
`agy -p='PROMPT' --dangerously-skip-permissions --output-format json`;
gemini-3.8-flash default; ≤ 12 concurrent (96 exhausted the quota once);
10–20 s per call; retry timeouts up to 3 rounds. Existing results for the first
10 levels: `birdtypes/results.jsonl` (`level`, `dog_id`, `sprite_abs`,
`classification.type`). Resolve sprite paths from `level.json` `sprite.image`,
never from folder index.

Loader `src/data/birdTypes.ts`: `loadBirdTypes(): Promise<BirdTypeIndex>`
fetched with the manifest, `birdType(index, levelId, dogId): BirdType | null`.
Missing entry → `null` → not a sparrow, never a throw.

### 4.2 Save state (`GameState`, new `STORAGE_KEYS`, `ftb_` prefix)

```
BIRD_COUNTS      'ftb_bird_counts'       { sparrow: number }
COLLECTION_META  'ftb_collection_meta'   { tileUnlockPopShown: boolean, plainFlipShown: boolean }
SANCTUARY        'ftb_sanctuary'         { houseTier: 0|1|2|3,
                                           placed: Record<number, 'sparrow'>,   // pedestalIndex → bird
                                           accrualStartedAt: string|null,      // ISO
                                           pendingCoins: number,
                                           tileUnlockPopShown: boolean }
```

- Parse with the same defensive readers used for wallet counters
  (`nonNegativeIntegerOrZero`, shape checks); corrupt → defaults.
- Write through the existing persistence helpers so the storage-denial path
  (`tests/unit/analytics-storage-denial.test.ts` pattern) is honoured.
- `incrementBirdCount(type)` persists immediately at pickup time, before the
  level completes, so a crash mid-level cannot lose a count.
- Wallet: add `WalletMutationSource` values `'sanctuaryHouse'` (spend) and
  `'sanctuaryCollect'` (grant). Mutate `houseTier` only after `spendCoins`
  returns true.

### 4.3 Pure modules (no DOM, fully unit-tested)

- `src/collection/thresholds.ts`
  `cardState(count, cfg) → 'silhouette'|'plain'|'hat'|'cardigan'`,
  `nextThreshold(count, cfg) → { label: 'Unlock'|'Hat'|'Cardigan'|'Complete', target: number|null }`.
- `src/sanctuary/accrual.ts`
  `settle(state, now, cfg) → { state, gained }` computes
  `min(elapsedHours, capHours) * ratePerHour(tier)` only when `placed` is
  non-empty; resets `accrualStartedAt = now`. Fractional coins carried in
  `pendingCoins` as a float, displayed floored.
- `src/sanctuary/layout.ts`
  `layoutSanctuary(manifest, tier, placed, viewport) → { bg, house, pedestals[], plotMarker, coinPile }`
  in CSS px, from manifest bg-pixel space (cover-fit, keep y 380–905 visible).
- `src/collection/cardModel.ts`
  `cardModel(kind, count, cfg) → { portraitSrc, plaque, ribbon, lines, progress }`.

## 5. Assets (installed; do not regenerate)

Manifest: `public/ui/sanctuary/manifest.json` is the single source of geometry.
Style: `design/style-guide.json`.

Sanctuary
- `bg`: `/ui/sanctuary/sanctuary-bg.png` 1024×1536.
- house tiers: `/ui/sanctuary/house/house-tier{1,2,3}.png` 1024² RGBA; draw at
  `houseAnchor.scale` (0.82 in bg px) with the sprite bbox bottom-centre at
  `houseAnchor` (600, 905). One scale for all tiers.
- pedestals: per tier `anchor` [x,y] (sprite px, bird feet centre) and `width`
  (bird sprite height in sprite px). Tunable: if birds read small on device,
  raise every `width` by the same factor (≤ 1.3) rather than per tier.
- birds: `/ui/sanctuary/birds/sparrow-{plain,hat,cardigan}.png`, feet on the
  bottom edge, camera-facing, no flip.
- markers: `plot-marker.png` (no-house, at the house anchor), `pedestal-empty.png`
  (drawn like a bird on the pedestal), `coin-pile.png` (on the branch right of
  the house, ~170 px wide in bg px).
- contact shadow: code. Ellipse width = bird width, height = bird height / 5,
  `rgba(60,40,20,0.35)`, blur 5 px, centred on the anchor.
- tier ghost: next tier sprite at 40% opacity (code).

Collection
- `card-frame.png` 1024×1536 blank; porthole `cx 488, cy 410, r 276`; plaque
  y 860–960; ribbon y 1040–1120; bubble y 1160–1400 (all in card px; position
  text as percentages of the card box).
- portraits `/ui/collection/portrait-sparrow-{silhouette,plain,hat,cardigan}.png`,
  `portrait-unknown.png`: width = 0.98 × porthole diameter, bottom edge at
  `cy + r + 0.10 r`, clipped with `clip-path: circle(r at cx cy)`.
- surfaces for bars/buttons/sheets: `button-sky-9s`, `button-olive-9s`,
  `panel-honey-9s`. No new bitmaps.
- Home tiles + padlock already exist.

Copy
- Sparrow lines: "Loud. Opinionated. Never on time." / "Will fight a pigeon for
  a crumb." / "Loves: your sandwich." Ribbon "Garden bird".
- ? card: "? ? ?", "Coming soon", three dashed lines.
- Sheets: "Build a nest box", "Who moves in?", "Nest box · Tier N", "Upgrade",
  "Max tier", "Need N more", "+1 sparrow".

Budget: PNGs ≈ 16 MB. Before the TestFlight build export bg, house tiers and
card frame to WebP q90 (same lane as level assets), keep small sprites PNG,
update manifest paths, and add the two sets to the idle preload list in
`iconPreload.ts` (not the boot path).

## 6. Implementation steps (in order; each has tests; device steps marked)

Conventions: TypeScript, existing ESLint config, vitest under `tests/unit`,
no new dependencies, pages built as DOM overlays like AchievementsPage,
no Phaser scene for these pages.

1. **Bird tags.** Run the classifier over the 34 unclassified bundled levels
   (rerun the 7 timeouts), merge with `results.jsonl`, write
   `public/levels/bird-types.json`. Add `src/data/birdTypes.ts`.
   Tests `bird-types-manifest.test.ts`: every bundled level present, every dog
   id in each `level.json` present, unknown lookup returns null.
   **agy pass A** (§8.1) on the sparrow rows.
2. **Config.** Add the §3 keys to schema + template with descriptions.
   Test: template round-trip like the existing config tests.
3. **State.** `GameState`: bird counts, collection meta, sanctuary record;
   getters; `incrementBirdCount`, `markCollectionPopShown`, `markPlainFlipShown`,
   `setHouseTier`, `placeBird`, `settleSanctuary(now)`, `collectSanctuaryCoins()`;
   wallet sources. Tests `collection-state.test.ts`, `sanctuary-state.test.ts`:
   persistence round-trip, corrupt record → defaults, storage denial → in-memory.
4. **Thresholds + accrual + layout + card model** pure modules with tests:
   boundaries 9/10/19/20/34/35; accrual zero when nothing placed, cap at 4 h,
   fractional carry, resume; layout numbers reproduce the manifest anchors for
   a 390×844 viewport; card model text per state.
5. **Pickup hook.** In `GameScene.onDogFound`, after `gameState.foundDogIds.add`
   and only if it was newly added: look up the tag, increment on `'sparrow'`,
   show the "+1 sparrow" chip through the FindPraise slot (extend
   `FindPraise.show` with a `chip` variant, no new asset). Analytics event
   `bird_collected { type, level_id }` via `AnalyticsService`; update the
   canonical events contract test. Restoration replays must not double count.
6. **Gating + home.** Derive `collectionUnlocked`/`sanctuaryUnlocked` in one
   helper `src/home/metaGates.ts`. HomeScene renders the two tiles locked or
   live from it, plays the one-shot pop once and persists it.
   `homeNavigation.ts`: route `#home-nav-collection` → `'collection'`,
   `#home-nav-sanctuary` → `'sanctuary'`; `openPage` accepts the two ids and
   titles. Tests extend `achievement-home-routing.test.ts` and
   `home-menu-polish.test.ts`. **Device**: capture tiles at level 4 and level 5.
7. **Collection page.** `src/ui/CollectionPage.ts` + CSS in `styles.css`
   (namespace `.collection-`). Deck: horizontal `scroll-snap-type: x mandatory`,
   each card `scroll-snap-align: center`, neighbours peeking 6%, dots bound to
   `scroll` position. Card DOM: frame `<img>`, portrait `<img>` with clip-path,
   absolutely positioned text layers. Plain flip: CSS 3D flip on first render
   after unlock, then persisted. Test `collection-page.test.ts` (JSDOM: DOM
   from model, dots update, flip flag). **Device**: capture silhouette, plain,
   hat, cardigan, ? card, mid-swipe.
8. **Sanctuary page: scene.** `src/ui/SanctuaryPage.ts` renders layers from
   `layoutSanctuary`. Re-layout on resize. Test `sanctuary-page.test.ts`
   (element rects from a fixed viewport). **Device**: no-house and tier 1–3
   captures; compare with
   `docs/sanctuary-exploration/vertical-slice-2026-09-16/assets/final_sheet.png`.
9. **Buy + upgrade.** Bottom sheet component `src/ui/BottomSheet.ts` (reuse the
   level-complete card surfaces). Price from config, `spendCoins` gate,
   insufficient path → `openPage('shop', { scrollTo: 'coins' })`. Analytics
   `sanctuary_house { tier, price }`. Tests: refuse at price−1, accept at
   price, tier monotonic, no mutation on failed spend.
10. **Place.** Pedestal tap → picker sheet → place → persisted; body sprite
    follows `cardState(count)` on every render. Tests: placement persisted,
    costume selection at 19/20/35.
11. **Coins.** Settle on page open, on `visibilitychange` to visible, and on
    app resume (existing lifecycle hook used by analytics flush). Pile shows
    when `floor(pendingCoins) ≥ 1`; tap → `collectSanctuaryCoins` →
    `grantCoins(n, 'sanctuaryCollect')` → `animateCoinsToBalance`. Analytics
    `sanctuary_collect { coins }`. Tests with fake clock.
12. **Motion.** Drop-and-squash (scaleY 0.8→1.05→1 over 320 ms) on build,
    upgrade, place; idle: breathe scale 1.00↔1.03 over 2.4 s ease-in-out,
    blink = 90 ms scaleY 0.92 every 4–7 s, hop = translateY −6% over 260 ms
    every 8–15 s; tap = hop + find SFX. All via WAAPI; cancel on page close
    (`effect = null`, see the iOS memory-kill memory). Honour
    `prefersReducedMotion` like GameScene.
13. **Preload + budget.** WebP export, manifest paths, idle preload, measure
    page-open time on device (< 300 ms after first open).
14. **Device pass + evidence.** Build/install with
    `tools/native-shell/install.mjs`, walk §9, save captures under
    `docs/evidence/<date>-ftb-collection-sanctuary/`, run **agy pass B** (§8.2)
    on every capture, fix and recapture until all PASS, then open the PR with
    the evidence folder and the agy verdict file.

## 7. Commands

```
cd games/find_the_bird
npm run typecheck && npm run test:unit && npm run lint
node ../../tools/native-shell/install.mjs        # device build + install + launch (see memory: install.mjs is the device lane)
```

Device screenshots: the phone relay/harness lane documented in
`docs/solutions` (FTB phone relay drive lane) or `xcrun devicectl`/`idevicescreenshot`
as used in recent evidence folders. Fake clock for accrual on device: add a
harness-only override `window.__ftbNow` read by `settleSanctuary` when
`TEST_HARNESS_ENABLED`.

## 8. agy image-understanding passes (mandatory gates)

agy = Antigravity CLI, gemini-3.8-flash default, ~10–20 s per call, ≤ 12
concurrent. Always attach the prompt with `-p=` and ask for strict JSON.
Parse the `result`/answer string and extract the JSON object; retry once on
timeout. Save every verdict as JSONL next to the images it judged. A FAIL is a
defect to fix, not a note.

### 8.1 Pass A: asset and tag sanity (after step 1 and before step 7)

For each installed asset in `public/ui/sanctuary/**` and `public/ui/collection/**`:
prompt "Open <abs path>. Answer JSON {\"transparent_bg\": bool, \"has_text\": bool,
\"subject\": string, \"costume\": \"none|hat|cardigan|n/a\", \"cut_off\": bool,
\"style_match\": 0-1 (soft painted-wood cozy storybook, no outlines)}".
Expected: transparent_bg true for every sprite (false only for the bg),
has_text false, costume matches the filename, cut_off false, style_match ≥ 0.7.

For bird tags: sample 40 sprites tagged `sparrow` and 40 not tagged sparrow,
ask "Is this a house sparrow? JSON {\"sparrow\": bool, \"confidence\": 0-1}",
require ≥ 90% agreement on each side; otherwise re-run classification for the
disagreeing levels.

### 8.2 Pass B: device capture judging (step 14, every checklist row)

For each capture, one call with the row's expectation embedded:
"Open <abs path>. This is a phone screenshot of the game Find the Bird.
Expectation: <row text>. Answer JSON {\"pass\": bool, \"seen\": string,
\"problems\": [string]}. Fail if any expected element is missing, text is
clipped, an element overlaps the notch or home indicator, or a sprite is
visibly scaled wrong relative to its house." Store `verdicts.jsonl`; the PR
must link it and every row must be `pass: true`. For motion rows (idle, drop,
flip) capture 4 consecutive frames 100 ms apart and ask whether the frames
differ in the described way; a single still never proves motion.

### 8.3 Pass C: visual regression against the design sheets (step 8 and 14)

For the sanctuary tier captures and the collection cards, pair each capture
with the corresponding panel of
`docs/sanctuary-exploration/vertical-slice-2026-09-16/assets/final_sheet.png`
and `assets/cards_final.png`; ask "Same composition and asset placement?
JSON {\"same_layout\": bool, \"differences\": [string]}". Differences other than
chrome (header, nav bar, text) are defects.

## 9. Verification checklist (device captures, each judged by pass B)

1. Home at level 4: both tiles locked with padlocks.
2. Home after level 5: Collection tile unlocked, Sanctuary locked (pop recorded
   as 4 frames).
3. Collection: silhouette card, "n / 10 Unlock", dashed copy; ? card; dots.
4. Collection mid-swipe: both cards partially visible, snap lands centred.
5. In level: "+1 sparrow" chip on a sparrow pickup; no chip on another bird.
6. Home at 9 sparrows: Sanctuary locked; at 10: unlocked with pop.
7. Collection at 10: plain portrait, copy visible, "10 / 20 Hat" (flip frames).
8. Sanctuary no-house: plot marker, Build sheet; 149 coins → "Need 1 more";
   150 coins → Build; tier-1 house present; pedestal marker pulsing (frames).
9. Picker: "Who moves in?", sparrow placeable, ? locked; after Place the bird
   stands on the pedestal with shadow; idle frames differ; tap hop frames.
10. Coins: pile hidden with nothing placed; after 1 h (fake clock) "+3" pile;
    tap → pile hidden, wallet +3; after 10 h cap → +12 at tier 1.
11. Upgrade sheet with ghost; tier 2 house; tier 3 house; "Max tier".
12. Costume: card and housed bird at 20 (hat) and 35 (cardigan).
13. Kill and relaunch between 8, 9, 10, 11, 12: state persists.
14. Regression: Settings, Shop, Achievements (flag off) and a level still open
    and play; typecheck, unit, lint green.

## 10. Out of scope (do not build)

Robin/bluebird cards, biome sets, rare multipliers, themed or multiple houses,
tree scrolling, streak protection, ad-roll cosmetics, Layer sprite-sheet
reactions, any Cats & Soup mechanics beyond what §2 lists.
