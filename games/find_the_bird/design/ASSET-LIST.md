# Find the Bird — Cozy Garden 3D asset list

Canonical inventory as of 2026-07-30. This list follows current runtime
consumers and the design-sheet contract. It does not include level artwork,
historical alternatives, or UI that is drawn from live HTML/CSS.

## Direction and production rules

- Visual direction: **Cozy Garden 3D**.
- Mascot: explorer bluebird; stylized bird anatomy, no human arms or hands.
- Meaning-bearing art stays as individual transparent assets.
- Text, prices, counters, labels, toggles and disabled/loading states stay live.
- Repeated panels and buttons use the earlier Cozy Garden CSS treatment.
  Generated seamless textures and nine-slice frames are retained as an
  archived experiment, not applied to runtime divs.
- Cutouts require transparent corners, trimmed visible bounds, padding, and no
  chroma fringe over light or dark backgrounds.
- Do not create a separate standard Shop No Ads illustration. The menu badge is
  canonical and is reused directly in the Shop.
- There is no Pause screen in the canonical tour or asset inventory.

Status keys:

- **Active** — currently rendered by the game.
- **Canonical reuse** — one approved source serves more than one surface.
- **Shared surface** — reusable texture or nine-slice primitive.
- **Expansion** — approved library asset, not rendered by the current layout.
- **Compatibility mirror** — retained for tooling/design-sheet parity; must be
  byte-identical to its canonical source.
- **Archived surface** — generated during the later complete-div pass, retained
  in the design library but no longer applied by runtime CSS.

## 1. Home, saga and navigation

- **Active** `home-banner-mascot-runtime`  
  Runtime: `public/ui/home/home-banner-mascot-runtime.png` · 1408×487  
  Find the Bird title lockup with explorer bluebird.

- **Active / canonical source** `no-ads-runtime`  
  Runtime: `public/ui/home/no-ads-runtime.png` · 320×320  
  Red crossed-out ADS garden badge. Used by both Home and the standard Shop
  offer.

- **Active** `play-level-button-runtime`  
  Runtime: `public/ui/home/play-level-button-runtime.png` · 1307×435  
  Primary Home Play Now button body; label remains live.

- **Active** `level-node-current-teal-runtime`  
  Runtime: `public/ui/home/level-node-current-teal-runtime.png` · 458×434  
  Current playable saga node.

- **Active** `level-node-complete-runtime`  
  Runtime: `public/ui/home/level-node-complete-runtime.png` · 462×436  
  Completed saga node.

- **Active** `level-node-locked-runtime`  
  Runtime: `public/ui/home/level-node-locked-runtime.png` · 467×476  
  Standard locked saga node.

- **Active** `level-node-locked-bones-runtime`  
  Runtime: `public/ui/home/level-node-locked-bones-runtime.png` · 453×447  
  Alternate locked saga node.

- **Active** `nav-bar-3`  
  Runtime: `public/ui/navigation/nav-bar-3.png` · 1178×338  
  Three-slot Shop / Play / Settings bottom tray.

- **Expansion** `nav-bar-4`  
  Runtime: `public/ui/navigation/nav-bar-4.png`  
  Approved four-slot tray; not rendered by the current navigation.

- **Expansion** `nav-bar-5`  
  Runtime: `public/ui/navigation/nav-bar-5.png`  
  Approved five-slot tray; not rendered by the current navigation.

- **Active** `shop-icon-runtime`  
  Runtime: `public/ui/menu-icons/shop-icon-runtime.png` · 394×436

- **Active** `magnifier-runtime`  
  Runtime: `public/ui/menu-icons/magnifier-runtime.png` · 381×435  
  Center Play destination icon.

- **Active** `settings-icon-runtime`  
  Runtime: `public/ui/menu-icons/settings-icon-runtime.png` · 342×356

- **Active** `achievement-shortcut-runtime`  
  Runtime: `public/ui/achievements/achievement-shortcut-runtime.png` · 512×512  
  Feather trophy used by the Home Achievements shortcut.

- **Active** `background-feather`  
  Runtime: `public/ui/home/background-feather.svg`  
  Sparse diagonal background motif.

- **Active** `pattern-motif`  
  Runtime: `public/ui/home/pattern-motif.png` · 256×256  
  Transition/background motif.

## 2. Global HUD and page controls

- **Active** `back_button`  
  Runtime: `public/ui/page-header/back_button.png` · 353×389

- **Active** `icon_coin`  
  Runtime: `public/ui/menu-icons/icon_coin.png` · 287×307

- **Active** `icon_hint_magnifier`  
  Runtime: `public/ui/menu-icons/icon_hint_magnifier.png` · 308×337

- **Active** `icon_heart`  
  Runtime: `public/ui/menu-icons/icon_heart.png` · 256×256

- **Active** `icon_streak_flame`  
  Runtime: `public/ui/menu-icons/icon_streak_flame.png` · 128×128

- **Active / canonical reuse** `icon_settings_gear`  
  Runtime: `public/ui/menu-icons/icon_settings_gear.png` · 342×356  
  Uses the same approved gear family as `settings-icon-runtime`.

## 3. Settings

- **Active** `settings_icon_home`  
  Runtime: `public/ui/settings/settings_icon_home.png` · 457×424

- **Active** `settings_icon_music`  
  Runtime: `public/ui/settings/settings_icon_music.png` · 371×387

- **Active** `settings_icon_sound`  
  Runtime: `public/ui/settings/settings_icon_sound.png` · 353×384

- **Active** `settings_icon_vibration`  
  Runtime: `public/ui/settings/settings_icon_vibration.png` · 459×387

The Settings page shell, row bodies, toggles, Restore button, Privacy Choices
button and legal links are live components using the shared surface system.
They are not separate text-bearing image assets.

## 4. Shop offers and products

- **Compatibility mirror** `shop_no_ads`  
  Runtime mirror: `public/ui/shop/shop_no_ads.png` · 320×320  
  Must remain byte-identical to `public/ui/home/no-ads-runtime.png`. The runtime
  standard Shop card binds directly to the canonical Home asset.

- **Active** `shop_no_ads_premium`  
  Runtime: `public/ui/shop/shop_no_ads_premium.png` · 512×512  
  Premium No Ads offer with crown and feather-token reward.

- **Active** `shop_vip_bundle`  
  Runtime: `public/ui/shop/shop_vip_bundle.png` · 402×441

- **Active** `shop_hint_pack_small`  
  Runtime: `public/ui/shop/shop_hint_pack_small.png` · 247×312 · 10 hints

- **Active** `shop_hint_pack_medium`  
  Runtime: `public/ui/shop/shop_hint_pack_medium.png` · 331×347 · 25 hints

- **Active** `shop_hint_pack_large`  
  Runtime: `public/ui/shop/shop_hint_pack_large.png` · 396×395 · 50 hints

- **Active** `shop_coin_pack_1`  
  Runtime: `public/ui/shop/shop_coin_pack_1.png` · 301×248

- **Active** `shop_coin_pack_2`  
  Runtime: `public/ui/shop/shop_coin_pack_2.png` · 253×287

- **Active** `shop_coin_pack_3`  
  Runtime: `public/ui/shop/shop_coin_pack_3.png` · 388×339

- **Active** `shop_coin_pack_4`  
  Runtime: `public/ui/shop/shop_coin_pack_4.png` · 366×343

- **Active** `shop_coin_pack_5`  
  Runtime: `public/ui/shop/shop_coin_pack_5.png` · 398×380

- **Active** `shop_coin_pack_6`  
  Runtime: `public/ui/shop/shop_coin_pack_6.png` · 432×422

Shop headings, balances, offer cards, product cards, prices, purchase states,
“Popular” and “Best Value” ribbons are live components using the shared surface
system. Prices and promotional text must never be baked into product art.

## 5. Achievements

- **Active** `achievement-completion`  
  Runtime: `public/ui/achievements/achievement-completion.png` · 218×232

- **Active** `achievement-birds`  
  Runtime: `public/ui/achievements/achievement-birds.png` · 218×232

- **Active** `achievement-mastery`  
  Runtime: `public/ui/achievements/achievement-mastery.png` · 218×232

- **Active** `achievement-progression`  
  Runtime: `public/ui/achievements/achievement-progression.png` · 217×232

- **Active** `achievement-streak`  
  Runtime: `public/ui/achievements/achievement-streak.png` · 219×232

Achievement card bodies, state chips, progress tracks, category headings and
empty/unavailable states are live components using shared surfaces.

## 6. Results, fail and boot

The filenames retain legacy `dog-detective-*` names for code compatibility;
their rendered subjects are the approved explorer bluebird.

- **Active** `dog-detective-openai`  
  Runtime: `public/ui/mascots/dog-detective-openai.png` · 453×434  
  Boot/loading mascot.

- **Active** `dog-detective-complete`  
  Runtime: `public/ui/level-complete/dog-detective-complete.png` · 461×450  
  Happy level-complete mascot.

- **Active** `dog-detective-crying`  
  Runtime: `public/ui/level-complete/dog-detective-crying.png` · 445×403  
  Fail-state mascot.

- **Active** `level-complete-title`  
  Runtime: `public/ui/level-complete/level-complete-title.png` · 543×422

- **Active** `rewarded-ad-badge`  
  Runtime: `public/ui/level-complete/rewarded-ad-badge.png` · 256×256

Result/fail panels, Claim, Claim 2×, Next, retry/rescue and close actions are
live components. There is no Pause asset group.

## 7. Archived textures and nine-slice surfaces

- **Archived surface** `canvas-cream-seamless`  
  Runtime: `public/ui/textures/canvas-cream-seamless.png` · 256×256

- **Archived surface** `painted-olive-seamless`  
  Runtime: `public/ui/textures/painted-olive-seamless.png` · 256×256

- **Archived surface** `painted-sky-seamless`  
  Runtime: `public/ui/textures/painted-sky-seamless.png` · 256×256

- **Archived surface** `wood-honey-seamless`  
  Runtime: `public/ui/textures/wood-honey-seamless.png` · 256×256

- **Archived surface** `panel-honey-9s`  
  Runtime: `public/ui/surfaces/panel-honey-9s.png` · 256×256

- **Archived surface** `panel-olive-9s`  
  Runtime: `public/ui/surfaces/panel-olive-9s.png` · 256×256

- **Archived surface** `button-olive-9s`  
  Runtime: `public/ui/surfaces/button-olive-9s.png` · 256×128

- **Archived surface** `button-sky-9s`  
  Runtime: `public/ui/surfaces/button-sky-9s.png` · 256×128

These files remain validated library artifacts. The later generated surface
layer is archived inside an unreachable media block in `src/ui/styles.css`;
runtime pages use the earlier Cozy Garden 3D CSS treatment. Opposite edges and
nine-slice metadata remain pinned in `design/ui-surfaces.json`.

## Explicit exclusions

These files are not part of the canonical generation list:

- `node-current-candy.png` — retired saga alternative; a stale HTML preload
  still exists and should be removed separately.
- `best-value-2-mint-rose-ticket.png` and
  `popular-3-gold-candy-tab.png` — historical bitmap badges replaced by live
  ribbon text.
- `nav_play_btn.png`, `icon_shop_cart.png` and old small/medium/large or blue
  Shop pack variants — historical replacements with no current consumer.
- `rewarded-ad-badge.svg` and `settings_icon_home.svg` — superseded formats.
- Banner WebM and old confetti bitmaps — not part of the reskin asset contract.
- All level images under `public/levels/` — generated independently and outside
  this inventory.

## Canonical counts

- 45 active rendered assets.
- 2 approved expansion assets (`nav-bar-4`, `nav-bar-5`).
- 1 compatibility mirror (`shop_no_ads`).
- 8 archived generated surface assets.
- 56 total managed slots.

The machine-readable binding remains `design/assets.ts`; provenance and
byte-identity rules remain `design/asset-identity.json`.
