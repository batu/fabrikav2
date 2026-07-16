# Assets to generate per game — the definitive list

Phase-two source of truth. Every slot below is generated fresh when a new game
is skinned onto the shell. Grounded in the actual runtime inventory of
`public/ui/` (53 PNGs); everything not listed here is shell-generic and ships
as-is (confetti, hearts, back button, settings toggles — see ASSET-LIST.md).

Column key: **Files** are runtime paths under `public/ui/`; **Gen size** is the
generation target (post-processed down to the ship size); **Brief** is the slot
line appended to the shared prompt template (see PIPELINE below).

## A. Art slots (image generation)

| # | Slot | Files | Ship size | Gen size | Brief |
|---|---|---|---|---|---|
| 1 | Title card | `home/home-banner-mascot-runtime.png` | 966×429 | 1932×858 | Game-name display lettering + hero motif on transparent bg. No mascot required. |
| 2a | Success mark | `level-complete/<game>-complete.png` (+ `mascots/<game>.png` 768² if mascot game) | 492×512 | 1024² | Mascot celebrating, OR iconographic success (burst medal, trophy) for mascot-less games. |
| 2b | Failure mark | `level-complete/<game>-crying.png` | 492×512 | 1024² | Sad mascot OR iconographic failure (cracked medal). Same style as 2a. |
| 3 | Branded coin | `menu-icons/icon_coin.png` | 256² | 1024² | The soft-currency identity (FTD: paw coin). Single coin, front-facing, glossy. |
| 3b | Coin pack tiers ×6 | `shop/shop_coin_pack_{1..6}.png` | 256² each | 1024² | Tiered piles of #3's coin: single → pouch → stack → chest → cart → vault. Richness must scale with tier. |
| 4 | Branded hint / sellable | `menu-icons/icon_hint_magnifier.png` 256², `menu-icons/magnifier-runtime.png` ~384×405 | see files | 1024² | The consumable booster identity (FTD: magnifier). One object. |
| 4b | Hint pack tiers ×3 | `shop/shop_hint_pack_{small,medium,large}.png` | ≤512² (regen; FTD ships 1254²) | 1024² | 1 / 3 / 5 of #4's object, arranged; richness scales. |
| 5a | No-ads badge | `shop/shop_no_ads.png` + `home/no-ads-runtime.png` (≤512², regen) + `settings/settings_icon_no_ads.png` 256² | see files | 1024² | "ADS" burst with red slash, game-palette framing. Same art feeds all three slots. |
| 5b | No-ads premium / VIP | `shop/shop_no_ads_premium.png` 727², `shop/shop_vip_bundle.png` 727×715 | see files | 1024² | Premium variant: #5a + crown/gems + coin & hint garnish. |
| 6 | "Level Complete" title | `level-complete/level-complete-title.png` | 1100×469 | 2200×938 | Display lettering, arched, win-card style. |
| 7 | "Out of Lives" title | new file `level-complete/out-of-lives-title.png` | 1100×469 | 2200×938 | Same lettering family as #6, somber palette. UI task rides along: restyle fail screen to win-card structure. |
| 8 | Shop icon | `menu-icons/icon_shop_cart.png` 256², `menu-icons/shop-icon-runtime.png` 250×300 | see files | 1024² | Bottom-nav shop identity. |
| 9 | Play icon | `menu-icons/nav_play_btn.png` | ≤512² (regen; FTD ships 1254²) | 1024² | Bottom-nav center play mark. (Home Play CTA itself is the CSS pill — not art.) |
| 10 | Settings icon | `menu-icons/icon_settings_gear.png` 256², `menu-icons/settings-icon-runtime.png` ~302² | see files | 1024² | Bottom-nav gear + settings Home row reuses `settings/settings_icon_home.png` (generic, keep). |
| 11 | Saga node: active | `home/level-node-current-teal-runtime.png` | 320×300 | 1024² | Glowing current-level button. |
| 12a | Saga node: locked | `home/level-node-locked-runtime.png` | 320×300 | 1024² | Muted padlock node, same family as #11. |
| 12b | Saga node: complete | `home/level-node-complete-runtime.png` | 320×320 | 1024² | Checked/harvested node, same family. |
| 13 | Background pattern motif | inline SVG in `styles.css` `#hud-overlay.home-mode::before` (FTD: paw) | 96×96 SVG tile | vector/SVG | ONE simple silhouette motif (paw → marble, star, gem…). Generated as a shape, hand-tuned into the tiling SVG. Must tile seamlessly; color comes from the scheme, not the asset. |

Optional per game (defaults are fine): shop badge ribbons
(`shop/badges/*-{mint-rose-ticket,gold-candy-tab}.png` 600×176) — generic
"BEST VALUE"/"POPULAR" lettering, only regenerate if the game wants its own
lettering style.

## B. Non-art swaps (no image model)

| Swap | Where | Mechanism |
|---|---|---|
| Title + result copy | `design/copy.ts` (`game.title`, win/fail strings) | edit / design sheet |
| Color scheme | `design/tokens.css` (7 `--fab-*` colors) — **but** `styles.css` has ~245 hardcoded colors vs 4 token usages today | see C |
| Pattern motif color/opacity | the #13 SVG's `fill`/`fill-opacity` | driven by scheme tokens once C lands |
| App icon + splash | `native-resources/` | separate pipeline (existing capacitor assets flow) |

## C. Color-scheme flexibility (the gap to close)

Today a palette change is not possible: `tokens.css` defines 7 colors but
`styles.css` uses them 4 times against ~245 hardcoded hex/hsl values. Plan —
**semantic scheme layer, not full retokenization**:

1. Extend `tokens.css` with ~15–20 semantic slots derived from the 7 base
   colors: home backdrop ramp (3 stops), pattern ink, nav bar fill, CTA green
   ramp (top/bottom/border/shadow — today's `hsl(128…)` quad), reward gold
   ramp (`hsl(38…)`), page background, card surface, danger/fail ramp.
2. Rewire only the high-visibility shell surfaces in `styles.css` to those
   vars (home backdrop + vignette variant, paw/pattern ::before, nav, Play
   pill, balance pills, shop price buttons, win/fail cards). Leave long-tail
   internals hardcoded.
3. The paw-pattern SVG data-URI gets its fill from a token via a small build
   or CSS `mask-image` + `background-color` trick so recoloring is one var.
4. Prove it with one alternate scheme ("mint" or "berry") toggled on device.

## PIPELINE (per slot)

`{style anchor (design/style-anchor.md)} + {slot brief} + {composition: single
subject, centered, transparent/plain bg, no text unless the slot IS text} +
{gen size}` → generate 2–4 candidates → remove-bg → trim → downscale to ship
size (sips) → install to runtime path + `design/assets/` source → record in
`design/asset-identity.json` → browser pass (home/shop/win/fail) → device
capture. Each step a tool call; the agent owns pick/retry/stop.

## Generation order for the generic set

Style anchor first, then: 3 coin → 4 hint (economy identity anchors everything)
→ 3b/4b tiers → 5a/5b → 8/9/10 nav icons → 11/12 saga nodes → 1 title card →
6/7 title lettering → 2a/2b marks → 13 pattern motif. Scheme work (C) can run
in parallel; #7 carries the fail-screen restyle.
