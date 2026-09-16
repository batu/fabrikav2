# FTB bird collection and sanctuary

> **Simplification (Batu, 2026-09-16 evening), supersedes the tiers/tree-scroll sections
> below where they conflict:**
> - **Collection is a swipe deck.** One near-full-screen card per type: porthole
>   portrait, name, set ribbon, three lines of personality copy, progress to the next
>   threshold, one button (Find <bird> / Place). Swipe left/right; locked cards show the
>   silhouette, hidden name and hidden copy, "unlocks after <previous>".
> - **Sanctuary is ONE non-scrolling screen** with THREE nest boxes already built on one
>   tree, one pedestal each, one bird each. No tiers to buy, no signposts, no scene
>   buttons at release.
> - **Open: the coin sink.** With houses pre-built there is no purchase in the release.
>   Candidates: cosmetic house upgrades (roof, paint, garden) per house; streak
>   protection; keep tiers as a later release.
> - Mockups: `docs/sanctuary-exploration/vertical-slice-2026-09-16/flow/d1_*, d2_*,
>   s1_*`, Portal report "Simplified: swipe-deck cards + one-screen sanctuary".

Design doc, 2026-09-16. Decisions here were made in conversation with Batu; open
items are marked. The home nav already ships locked Sanctuary and Collection
tiles (PR #95). Achievements are deprecated and leave the design.

## Why

Find the Bird is a collect-a-thon with no challenge: health is off, a miss is a
non-event, the only loop is find birds, finish level. Coins are earned at 45 per
level plus a small daily streak claim, and the only sink is a hint at 250 coins
that players rarely need. The coin packs in the shop sell into a void.

Collection is the progress system for playing. Sanctuary is the coin sink. They
close a loop: play -> birds -> house them -> coins -> bigger houses -> more slots
-> play for birds to fill them.

## Collection

Decisions 2026-09-16 (Batu):

- **Release scope: three cards** (sparrow, robin, bluebird) and **one house** with three
  tiers, so three pedestals fill exactly when the collection completes. Wren and finch
  are the next two cards and are not shown until they ship. The five together are the
  most frequent types in the shipped levels (10-level agy count: sparrow 27%, robin 11%,
  wren 7%, bluebird 7%, finch 5%; results in
  `docs/sanctuary-exploration/vertical-slice-2026-09-16/birdtypes/`).
- **Cards unlock one by one, in order**: sparrow, then robin, then bluebird, then wren,
  then finch. All five show from day one; the four not yet active are locked silhouettes.
- **Gating order (Batu, 2026-09-16)**: the Collection tile unlocks first. The Sanctuary
  tile opens the moment the first bird (sparrow) reaches its Unlocked threshold, and that
  bird is the first thing the player places.
- Assumption to confirm: only the ACTIVE card counts pickups. Pickups of a not-yet-active
  type are not banked. When the active card reaches its unlock threshold the next card
  becomes active. (Alternative: all discovered cards count in parallel once unlocked.)
- Card art = peek portrait: chest-up in a round porthole frame, accessory visible, no
  perspective. The full body is only seen in the sanctuary, which is the pull to house it.
- Every bird in a level carries a **type tag** (coarse common name) and a **biome** (from
  the level id). Type is the card; biome drives rarity.
- Each pickup of the active type increments its counter. Thresholds, per type, scaled by
  spawn frequency, unlock in order:
  1. **Discovered**: first pickup, card art replaces the silhouette.
  2. **Unlocked**: the bird can be placed on a sanctuary pedestal.
  3. **Accessory**: a small wearable (scarf, neckerchief, bow tie).
  4. **Costume**: the full outfit (cap, jacket, vest).
  5. **Mastered**: satchel and gold star pin, ornate frame, and the tap / coin-collect
     animation (Layer sprite-animation clip, one per type).
- Counters are finite per type. The endless sink lives on the coin side.
- **Rare** is a multiplier, not a separate card, keyed on type-within-biome (a robin in
  the desert is rare, a robin in the cottage garden is not), computed from the level id.
- The card always shows the **next threshold**, never only the count.
- Open: finch identity (chaffinch recommended; levels mostly draw chaffinch); bluebird is
  the mascot's species, so its costume path can end in the mascot cap and satchel as an
  easter egg (recommended) or the card uses a different blue.
- Counters start at launch; existing saves are not back-filled. Open item.

## Sanctuary

- A vertical tree the player scrolls. Houses sit on branches. The tree is a
  composited scene: background plus house sprites plus bird sprites, never one
  generated image, so slots can be tapped and swapped.
- **Release ships one house**: the traditional nest box on its branch, tier 1 free, one
  pedestal; tiers 2 and 3 are the only coin purchases in the release. The tree layout
  (trunk, alternating branches, signposted empty slots) ships with it so house two is
  content later, not a redesign.
- Every house has **3 tiers**; each tier adds a slot. Same silhouette growing
  upward so the upgrade button can preview the next tier as a ghost.
- After the default house the player **chooses which themed house to build**
  next (cottage, pagoda, tiki hut, later cactus, lighthouse, jungle temple).
  Each theme maps to a biome set.
- **Housed birds generate coins** over time. Tier raises the rate, a bird whose
  biome matches the house raises it more. Offline accrual with a cap of a few
  hours, collected from ONE coin tray at the bottom of the screen (Cats & Soup). This is the mechanical
  reason to choose who lives where, and the reason to buy coin packs.
- **Empty pedestals are invitations**: a dotted outline and a "?" bird.
  Tapping opens the collection filtered to placeable birds, or shows the nearest
  card's progress if none is unlocked. The sanctuary tutors the collection.
- Second sink, later: streak protection.
- Moving a bird between houses is free. Open item.

Rough starting prices, untuned, only to fix the scale against 45 coins a level:

```
tree house   t1 free   t2 300    t3 900
themed       t1 600    t2 1500   t3 3000
drip         ~5 coins / housed bird / hour, 4 h offline cap
```

## Visuals

Style is the pinned runtime style in `games/find_the_bird/design/style-guide.json`
(Cozy Garden 3D: soft painted-wood volume, no outlines), the same one the shop,
settings and sanctuary nav icons use. The cardstock sheets in `refs/art` are the
older design-sheet look and are NOT the target. Prompt from the style guide's
phrases and negatives verbatim; pin species colours in every prompt.

### Coupling (locked 2026-09-16)

```
card    round porthole frame, chest-up peek, accessory visible, no perspective
house   front orthographic, house + its own pedestals, birds full body, three-quarter
        pose facing the camera, both eyes visible
```

- Every house tier defines **pedestals** (anchor, width, facing, z) in its JSON. Tiers
  grow OUTWARD (annex, deck, extra branch), never only upward, one new pedestal per tier.
- Bird sprites: one per type and state, full body on a shared floor line, no stand or
  shadow baked; the game draws a shared contact shadow and drops the bird on the anchor.
  Idle life is runtime tweens; the mastered tap animation is a sprite sheet.
- Vertical view: centre trunk, houses alternate left/right at rising heights, empty
  branches carry a signpost and blueprint. Tiled trunk background + house sprites.
- Rounds v1–v4 and the top-5 sheet live in
  `docs/sanctuary-exploration/vertical-slice-2026-09-16/` (v1 rejected: wrong style,
  pasted birds). Style source of truth: `games/find_the_bird/design/style-guide.json`.

## Reference: Cats & Soup (decided 2026-09-16, "copy what works")

Evidence in `docs/sanctuary-exploration/vertical-slice-2026-09-16/catsoup/` (App Store
screenshots + fandom wiki; unverified items flagged in findings.md). Copied:

- One continuous vertical scene; each house shows a small tier flag on its branch.
- Birds animate on their pedestal from day one (tweens); the Mastered reward is the
  sprite-sheet reaction with onomatopoeia text ("chirp").
- ONE coin tray at the bottom of the Sanctuary, tap to collect; no per-house sack.
- Unbuilt branches are dimmed in place with their requirement on the signpost.
- Set completion (all cards in a biome group) grants a coins/hour bonus to the matching
  house.
- Linear unlock chain: Collection -> first unlock opens Sanctuary -> tier 2 -> tier 3.
- Upgrade lives in the house's tap sheet, not as a button on the scene.
- Not copied: gear gacha via ad/gem rolls (later, as cosmetic variants), star rarity on
  individuals, feeding minigame.

## Data needed

- Type and biome tags per level bird, for all shipped levels. The 10-level agy
  count (gemini-3.8-flash, 175/182 classified, 35 distinct types) picked the five
  cards; the full corpus needs the same pass, then a human check of the five
  card types only.
- Per-type thresholds derived from spawn frequency (sparrow needs the highest).

## Not in this spike

Save schema, remote config keys, analytics events, coin drip tuning, the
collection and sanctuary screens themselves.
