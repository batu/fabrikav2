# Shell template asset list

Every branded asset slot in the shell, as inherited from find_the_dog. This is
the de-branding worklist for step 2 and the **generation manifest for a new
game**: reskinning = producing one file per slot (same dimensions, transparent
background unless noted) + editing `design/copy.ts` + `design/tokens.css`.

Two copies exist for several images: `design/assets/` is the committed design
source-of-truth seed; `public/ui/…` is the runtime copy the shell actually
loads. Keep them in sync (audit's asset-identity check tracks provenance in
`design/asset-identity.json`).

Status legend — **FTD**: dog-branded, must be replaced per game · **generic**:
usable as-is in a new game · **empty**: slot exists, no file shipped.

## 1. Identity / mascot (FTD — the core of any reskin)

| Slot | Runtime path | Size | Used by |
|---|---|---|---|
| Mascot, happy (transition cover + complete card) | `ui/mascots/dog-detective-openai.png`, `ui/level-complete/dog-detective-complete.png` | 768×768 / 492×512 | SceneTransitionCover, LevelCompleteOverlay |
| Mascot, sad (fail card) | `ui/level-complete/dog-detective-crying.png` | 492×512 | LevelFailedOverlay |
| Home banner mascot + title art | `ui/home/home-banner-mascot-runtime.png` | 966×429 | HomeScene banner |
| Home banner idle video (optional) | `ui/banner-concepts/home-banner-dog-idle-boomerang-alpha.webm` | — | HomeScene banner replay |
| "LEVEL COMPLETE" title art | `ui/level-complete/level-complete-title.png` | 1100×469 | LevelCompleteOverlay |

## 2. Saga map nodes (FTD-flavored shapes, near-generic)

| Slot | Runtime path | Size |
|---|---|---|
| Node: current (glowing) | `ui/home/level-node-current-teal-runtime.png` (+ alt `node-current-candy.png`) | 320×300 / 384×384 |
| Node: locked | `ui/home/level-node-locked-runtime.png` (+ alt `-bones` variant, dog-branded) | 320×300 / 320×343 |
| Node: complete | `ui/home/level-node-complete-runtime.png` | 320×320 |
| Play Now button art | `ui/home/play-level-button-runtime.png` | 652×171 |
| No-ads badge (home corner) | `ui/home/no-ads-runtime.png` | 320×320 |

## 3. HUD + nav icons (mostly generic; magnifier/paw are FTD)

| Slot | Runtime path | Size | Notes |
|---|---|---|---|
| Coin icon | `ui/menu-icons/icon_coin.png` | 256×256 | paw-stamped coin — FTD |
| Heart / life icon | `ui/menu-icons/icon_heart.png` | 256×256 | generic |
| Hint icon | `ui/menu-icons/icon_hint_magnifier.png` + `magnifier-runtime.png` | 256×256 / 512×512 | magnifier = FTD hint metaphor |
| Settings gear | `ui/menu-icons/icon_settings_gear.png`, `settings-icon-runtime.png` | 256×256 / 384×384 | generic |
| Shop cart/bag | `ui/menu-icons/icon_shop_cart.png`, `shop-icon-runtime.png` | 256×256 / 384×384 | generic |
| Bottom-nav Play button | `ui/menu-icons/nav_play_btn.png` | 1254×1254 (1.4 MB — oversized, shrink on regen) | magnifier+dog — FTD |
| Back button (page header) | `ui/page-header/back_button.png` | 192×192 | generic |

## 4. Settings page icons (generic)

`ui/settings/settings_icon_{music,sound,vibration,no_ads}.png` — 256×256 each.

## 5. Shop art (style-branded, metaphors generic)

| Slot | Runtime path | Size |
|---|---|---|
| Coin packs, small/med/large tiers | `ui/shop/shop_coin_pack_{1..6}.png` (256²) + `_small/_medium/_large` (1254² — 1.5–2.1 MB each, shrink on regen) | |
| Hint packs | `ui/shop/shop_hint_pack_{small,medium,large}.png` (256²) + `_blue_{a,b,c}.png` (1024²) | |
| No-ads product | `ui/shop/shop_no_ads.png` | 256×256 |
| VIP bundle | `ui/shop/shop_vip_bundle.png` | 256×256 |

## 6. Effects (generic)

`ui/effects/confetti-fall.png` (720×1280), `confetti-side-burst.png` (520×720),
`confetti-side-burst-sprite.png` (6912×576 sprite sheet). Plus
`ui/level-complete/rewarded-ad-badge.svg`.

## 7. Fonts

`public/fonts/FredokaOne.woff2`, `LilitaOne.woff2` — generic rounded-display
faces; swap per brand via `design/tokens.css` `--fab-font-*`.

## 8. Audio (all slots EMPTY — files removed with FTD)

| Slot | Expected path | Consumer |
|---|---|---|
| Background music loop | `public/audio/velvet-ii-v.mp3` | AmbientManager (`velvet_ii_v` preset; 5 more synthesized presets need no files) |
| Success / pickup one-shots | `public/audio/dog-found/dog-found-{1..13}.wav` | AudioManager `playFind` (round-robin) |
| UI tap, hint, wrong-tap, level-complete | synthesized in AudioManager (no files) | — |

Step-2 task: source generic SFX/music (media-use catalog) and generalize the
`dog-found/` path name.

## 9. Copy (design/copy.ts — 39 keys)

All user-visible strings live in `design/copy.ts` (`game.title`, `menu.*`,
`hud.*`, `shop.*`, `settings.*`, `result.*`, `toast.*`, `connectivity.*`).
Reskin = regenerate this module; no literals in code (audit-enforced).

## 10. Colors / spacing

`design/tokens.css` — every `--fab-*` token (surface, accent, reward, warning,
fonts, spacing). The paw-print home background pattern and beige palette are
FTD-flavored token values, not assets.

## Generation notes

- Deliver PNG with transparency, sRGB, at the sizes above (they're the shipped
  FTD sizes; several are wastefully large — target ≤512² for icons, ≤1024² for
  hero art when regenerating).
- The high-leverage identity set for a new game is section 1 (5 pieces) +
  coin/hint metaphors + node set: ~12 images makes the shell read as a new
  brand; the rest can stay generic.
