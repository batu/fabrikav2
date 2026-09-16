# FTB Collection + Sanctuary: release 1 implementation plan

Status: ready for implementation. Branch `feat/ftd-collection-sanctuary`
(worktree `.worktrees/ftd-collection`). Design doc:
`docs/plans/2026-09-16-ftb-collection-and-sanctuary.md`. Assets are already
installed under `games/find_the_bird/public/ui/{sanctuary,collection}` with a
manifest at `public/ui/sanctuary/manifest.json`. Nothing here needs new art.

## Goal

Ship the first slice of the bird meta-game in Find the Bird:

- A **Collection** page (swipe deck) with one real card, **Sparrow**, in four
  states (silhouette, plain, hat, uniform), and one **? card** after it.
- A **Sanctuary** page: one tree, one house the player must **buy**, upgradable
  through **three tiers**, a **coin pickup** that accrues while away, and the
  placed sparrow standing on the house's pedestal in its current costume.
- Gating: Collection unlocks at **level 5**. The Sanctuary unlocks when the
  player has collected **10 sparrows** (the sparrow's Unlock threshold).

Done means: all of it runs on the physical iPhone through the existing home
nav tiles, device-captured for every state listed in the checklist at the end,
with unit tests for the counters, thresholds, gating, wallet mutations and
persistence.

## Player journey (this is the acceptance script)

1. **Levels 1–4.** Home shows Sanctuary and Collection tiles locked (as today,
   roll-shake on tap). Nothing else changes. Sparrow pickups already count in
   the background from install (no back-fill for existing saves).
2. **Level 5 complete.** On return to home the Collection tile unlocks with a
   one-shot pop (scale bounce + the padlock falling away). Tapping opens the
   Collection page.
3. **Collection, first open.** Deck of two cards. Card 1: card frame, the
   **sparrow silhouette** in the porthole, name plaque "Sparrow", ribbon "Garden
   bird", the bubble shows the three personality lines as dashes, progress
   "n / 10  Unlock". Card 2: the **? card** (unknown portrait, plaque "? ? ?",
   dashed lines, "Coming soon"). Swipe between them; page dots.
4. **Play levels, find sparrows.** In-level, each sparrow pickup increments the
   counter with a small "+1 sparrow" chip near the HUD feather counter (same
   praise slot as FindPraise, no new asset). Combo/hard praise still shows.
5. **10 sparrows.** Next home visit: Collection card 1 flips from silhouette to
   the **plain portrait** with a sparkle, the copy appears, progress becomes
   "10 / 20  Hat". The Sanctuary tile unlocks with the same pop.
6. **Sanctuary, first open (no house).** Tree background, **plot marker** on the
   branch, a bottom sheet "Build a nest box" with the price and a **Build**
   button (sky pill). Not enough coins: button disabled with "Need N more" and a
   "+" that opens the shop coins section. Buy: coins fly out (EconomyTransfer),
   the marker pops away, **tier-1 house** drops onto the branch with a squash.
7. **Place the sparrow.** The empty pedestal shows the **pedestal-empty**
   marker, pulsing. Tap it: bottom sheet "Who moves in?" with the sparrow card
   thumbnail and a **Place** button (the ? card is shown locked). Place: the
   sparrow sprite drops onto the pedestal with a squash, contact shadow fades
   in, idle tweens start (breathe, blink, occasional hop). Tap the bird: a
   happy hop + chirp SFX (existing find SFX is fine).
8. **Coins accrue.** Once a bird is housed, coins accrue at a rate per hour with
   an offline cap. A **coin pile** appears on the branch beside the house when
   ≥ 1 coin is pending, with a small "+N" chip. Tap: coins fly to the wallet
   pill (EconomyTransfer.animateCoinsToBalance), pile hides.
9. **Upgrade.** Tap the house: bottom sheet "Nest box · Tier 1" showing the
   next tier's gains ("+1 perch", "+coins per hour"), price, **Upgrade** pill.
   Buy: house sprite swaps tier 1 → 2 with a puff; the new pedestal shows the
   empty marker. Same for tier 3. At tier 3 the sheet shows "Max tier".
10. **Costumes.** At 20 sparrows the Collection card shows the **hat** portrait
    and the housed sparrow swaps to the **hat** body sprite. At 35, **uniform**.
    Card progress then reads "Complete".
11. Extra pedestals stay empty with the marker in release 1 (only one bird
    exists). The picker shows the ? card locked. That is intended.

## Numbers (remote-config keys, defaults)

```
collectionUnlockLevel        5      levels completed before the Collection tile opens
sparrowUnlockCount           10     sparrows → sparrow card + Sanctuary tile
sparrowHatCount              20
sparrowUniformCount          35
housePriceTier1              150    coins, buy the nest box
housePriceTier2              300
housePriceTier3              900
sanctuaryCoinsPerHourTier    [3, 6, 10]   per tier, only while ≥1 bird is housed
sanctuaryOfflineCapHours     4
```

At 45 coins per level (levelCompleteCoinReward) tier 1 is ~3 levels after the
sanctuary opens, tier 2 a week for a casual player, tier 3 the long goal.

## Data

### Bird type tags (build-time artifact, no runtime model call)

- New file `public/levels/bird-types.json`: `{ "<levelId>": { "<dogId>": "sparrow" | ... } }`
  for every level in `public/levels/bundled-manifest.json` (44 levels today).
- Generate with the agy classifier that produced the 10-level count:
  `docs/sanctuary-exploration/vertical-slice-2026-09-16/birdtypes/classify.py`
  (gemini-3.8-flash via `agy -p=... --dangerously-skip-permissions --output-format json`,
  ≤12 concurrent, retries; 7/182 timed out last run and need a rerun). Results
  for the first 10 levels are in `birdtypes/results.jsonl` (keys: level, dog_id,
  sprite_abs, classification.type). Only the `sparrow` tag matters for release 1;
  keep the others in the file for later cards.
- A unit test asserts every bundled level has an entry and every dog id
  resolves; a missing entry counts as "not a sparrow", never a crash.
- Human check: eyeball the sparrow rows on the top-5 sheet
  (`docs/sanctuary-exploration/vertical-slice-2026-09-16/top5/top5_contact.png`)
  and spot-check 3 levels on device.

### Save state (GameState, new keys in STORAGE_KEYS, ftb_ prefix)

```
ftb_bird_counts        { sparrow: number }            increments per pickup, persisted at pickup time
ftb_collection_state   { unlockedAt?: iso }           tile unlock recorded once (for the one-shot pop)
ftb_sanctuary          { houseTier: 0|1|2|3, placed: { [pedestalIndex]: 'sparrow' },
                         coinsAccruedAt: iso|null, pendingCoins: number, unlockedAt?: iso }
```

- Counting happens in `GameScene.onDogFound` (src/scenes/GameScene.ts ~1512):
  look up `birdTypes[level.id][dog.id]`, and if `'sparrow'` call
  `gameState.incrementBirdCount('sparrow')`. Restoration replays must NOT
  double count: guard with `gameState.foundDogIds` (already a Set) and only
  count on first add.
- Coin accrual is computed lazily: on Sanctuary open and on app resume,
  `pending += min(now - coinsAccruedAt, capHours) * ratePerHour(tier)` if any
  bird is placed; `coinsAccruedAt = now`. Collect calls `gameState.grantCoins(n,
  'sanctuaryCollect')` (add the WalletMutationSource).
- House purchases call `gameState.spendCoins(price, 'sanctuaryHouse')` and only
  then mutate `houseTier`. Never mutate on a failed spend.
- All new persistence goes through the existing `persist*` helpers and the
  storage-denial path (see tests/unit/analytics-storage-denial.test.ts for the
  pattern).

## Assets (all present, do not regenerate)

Manifest: `public/ui/sanctuary/manifest.json` (anchors, scale, porthole
geometry). Style: `design/style-guide.json`.

Sanctuary
- `/ui/sanctuary/sanctuary-bg.png` 1024×1536. Cover-fit to the page body under
  the header; keep the branch band (y 380–905 in bg px) in view on all phones.
- `/ui/sanctuary/house/house-tier{1,2,3}.png` 1024² RGBA. Draw at
  `houseAnchor.scale` (0.82 in bg px) with the sprite bbox bottom-centre on
  `houseAnchor` (600, 905). One scale for every tier.
- Pedestals per tier in the manifest: `anchor` [x,y] in sprite px = bird feet
  centre; `width` = bird sprite height in sprite px.
- `/ui/sanctuary/birds/sparrow-{plain,hat,uniform}.png` full-body sprites,
  feet on the bottom edge. Scale to pedestal width, no flip needed (they face
  the camera).
- `/ui/sanctuary/markers/plot-marker.png` (no-house state, sits on the branch
  at the house anchor), `pedestal-empty.png` (draw at the pedestal like a bird),
  `coin-pile.png` (beside the house on the branch, right side).
- Contact shadow is code: ellipse, width = bird width, height = bird height / 5,
  rgba(60,40,20,0.35), blur 5 px, centred on the anchor.
- Tier ghost preview in the upgrade sheet: draw the next tier sprite at 40%
  opacity over the current one (code, no asset).

Collection
- `/ui/collection/card-frame.png` 1024×1536, blank: porthole (cx 459, cy 410,
  r 320), name plaque (y 860–960), ribbon (y 1040–1120), bubble (y 1160–1400).
  Text is HTML positioned over the card in card-relative percentages.
- Portraits `/ui/collection/portrait-sparrow-{silhouette,plain,hat,uniform}.png`
  and `portrait-unknown.png`: scale to 0.96 × porthole diameter wide, bottom
  edge at cy + r + 0.10 r, clip to the porthole circle (CSS `clip-path: circle`).
- Progress bar, buttons, sheets: existing surface kit (`button-sky-9s`,
  `button-olive-9s`, `panel-honey-9s`), no new bitmaps.
- Home tiles and padlock already exist (`/ui/sanctuary/*-nav-icon.png`, `padlock.png`).

Copy (final, per the design doc)
- Sparrow: "Loud. Opinionated. Never on time." / "Will fight a pigeon for a
  crumb." / "Loves: your sandwich." Ribbon: "Garden bird".
- ? card: plaque "? ? ?", ribbon "Coming soon", three dashed lines.
- Sheets: "Build a nest box", "Who moves in?", "Nest box · Tier N", "Upgrade",
  "Max tier", "Need N more".

Asset budget: the PNGs total ~16 MB. Before the TestFlight build export the
large ones to WebP q90 like the level assets (bg, house tiers, card frame) and
keep PNG for the small sprites; update manifest paths. Preload the Sanctuary
and Collection sets from an idle callback like `iconPreload.ts` does for shop
icons, not on the boot path.

## Implementation steps

Work in this order; each step has its own tests and a device check where
noted. Follow the existing page pattern: `openPage` in `src/ui/HUD.ts`,
`homeNavigation.ts`, and `AchievementsPage.ts` as the closest sibling.

1. **Bird type tags.** Run the classifier over all bundled levels, write
   `public/levels/bird-types.json`, add `src/data/birdTypes.ts` (typed loader,
   lookup `birdType(levelId, dogId)`), unit test coverage of the manifest.
2. **Counters + thresholds.** `GameState`: `birdCounts`, `incrementBirdCount`,
   persistence, migration-safe read (missing → 0). `src/collection/thresholds.ts`
   pure function: count → card state (silhouette | plain | hat | uniform) and
   next threshold label. Remote-config keys added to
   `remoteConfigSchema.ts` + template. Tests: state boundaries at 9/10/19/20/34/35.
3. **Pickup hook.** `GameScene.onDogFound` increments when the tag is sparrow;
   restoration/double-find guard; "+1 sparrow" chip via FindPraise slot.
   Analytics: `bird_collected {type}` through `AnalyticsService` with the
   canonical-events contract test updated.
4. **Gating.** `collectionUnlocked = totalLevelsCompleted >= collectionUnlockLevel`,
   `sanctuaryUnlocked = birdCounts.sparrow >= sparrowUnlockCount`. HomeScene
   renders the tiles unlocked/locked from these; one-shot unlock pop persisted
   by `unlockedAt`. `homeNavigation.ts` routes `#home-nav-collection` →
   `'collection'`, `#home-nav-sanctuary` → `'sanctuary'`; `openPage` gains the
   two ids and titles. Tests extend `achievement-home-routing.test.ts` style.
5. **Collection page.** `src/ui/CollectionPage.ts`: horizontal snap-scroll deck
   (CSS scroll-snap, `overflow-x`), two cards, page dots, card renderer from
   `cardModel(count)`. Portrait clip + sizing from the manifest. Locked ? card.
   Unit test the card model → DOM; device check the deck swipe and the
   silhouette→plain flip.
6. **Sanctuary page: scene.** `src/ui/SanctuaryPage.ts`: background, house
   layer, pedestal layer, marker layer, coin pile, all absolutely positioned
   from `manifest.json` in bg-pixel space scaled to the page. A pure
   `layoutSanctuary(manifest, tier, placed, viewport)` returns element rects;
   test it against the manifest numbers.
7. **Sanctuary: buy + upgrade.** Bottom sheet component (reuse the fail/complete
   overlay card pattern), price from RC, `spendCoins` gate, insufficient-coins
   path to the shop coins section (`openPage('shop', {scrollTo:'coins'})`).
   Tests: spend/refuse, tier monotonic, price table.
8. **Sanctuary: place.** Pedestal tap → picker sheet → place → persisted;
   costume follows the card state on every render. Tests: placement
   persistence, costume selection.
9. **Coin pickup.** Accrual math in `src/sanctuary/accrual.ts` (pure, tested
   with fake clocks: cap, zero when nothing housed, resume). Pile visibility,
   tap → `grantCoins` + `animateCoinsToBalance`. Analytics `sanctuary_collect`.
10. **Motion.** Drop-and-squash on build/upgrade/place, idle tweens (breathe
    scale 1.00↔1.03 over 2.4 s, blink every 4–7 s via a 1-frame eye overlay is
    NOT available, so blink = quick vertical squash; hop every 8–15 s), tap
    reaction. Respect `prefersReducedMotion` like GameScene does.
11. **Preload + budget.** Add the sets to the idle preload list; WebP export of
    the large assets; measure page open time on device.
12. **Device pass.** Build with `tools/native-shell/install.mjs`, capture every
    checklist state on the iPhone, attach to the PR evidence folder.

## Verification checklist (device captures required)

- Home: tiles locked at level 4; Collection unlocked after level 5 (pop captured).
- Collection: silhouette card at 0–9; plain at 10 with flip; hat at 20; uniform
  at 35; ? card; swipe both directions; back button.
- In level: "+1 sparrow" chip on a sparrow pickup; no chip on a non-sparrow.
- Sanctuary: locked tile at 9 sparrows, unlocked at 10 (pop captured).
- Sanctuary: no-house state with marker; Build refused with 149 coins, accepted
  with 150; tier-1 house appears; empty pedestal marker pulsing.
- Place: picker, place, idle motion (record 5 s), tap reaction.
- Coins: pile hidden with nothing placed; after 1 h simulated (fake clock via
  test harness) pile shows "+3"; tap collects; cap at 4 h.
- Upgrade to 2 and 3; ghost preview; "Max tier".
- Costume swap on the housed bird at 20 and 35.
- Kill and relaunch the app between every state above: everything persists.
- Existing suites green: `npm run typecheck`, `npm run test:unit`, `npm run lint`
  in `games/find_the_bird`.

## Out of scope (do not build)

Robin/bluebird cards, biome sets, rare multipliers, themed houses, tree scroll,
streak protection, ad-roll cosmetics, Layer sprite-sheet reactions.
