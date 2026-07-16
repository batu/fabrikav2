# SWAP list — the per-game asset swap set

The minimal set of assets that gets **swapped per game**. Everything else in
ASSET-LIST.md stays generic. Plan: (1) generate a **generic set** for the shell
template itself, and in doing so (2) pin down the **generation pipeline** that
produces a branded set for any new game.

## The swap slots

| # | Slot | Target file(s) | Size | Notes |
|---|---|---|---|---|
| 1 | Title card | `ui/home/home-banner-mascot-runtime.png` | 966×429 | Game-name art for the home banner. Does NOT require a mascot. |
| 2 | Success/fail mark (mascot slot) | `ui/mascots/*`, `ui/level-complete/*-complete/-crying` | 768², 492×512 ×2 | For mascot games: happy + sad mascot. For mascot-less games (marble_run): an iconographic success / failure depiction (e.g. burst medal / cracked medal). |
| 3 | Branded coin | `ui/menu-icons/icon_coin.png` + coin pack tiers | 256² + 6×256² | The soft-currency identity (FTD: paw coin). |
| 4 | Branded hint / sellable item | `ui/menu-icons/icon_hint_magnifier.png`, `magnifier-runtime.png` + hint pack tiers | 256²/512² + 3×512² | The consumable booster identity (FTD: magnifier). |
| 5 | Shop set | `ui/shop/shop_no_ads.png`, `shop_vip_bundle.png` + tiered packs from #3/#4 | 320²–512² | No-ads badge, premium bundle, pack tiering (bigger tier = richer art). |
| 6 | "Level Complete" writing | `ui/level-complete/level-complete-title.png` | 1100×469 | Display lettering, win card. |
| 7 | "Out of Lives" writing | (new slot — today it's plain text) | ~1100×469 | Fail screen gets restyled to the win screen's structure with its own title art. UI task rides along. |
| 8 | Shop icon | `ui/menu-icons/icon_shop_cart.png`, `shop-icon-runtime.png` | 256²/384² | Bottom nav. |
| 9 | Play icon | `ui/menu-icons/nav_play_btn.png` | ≤512² (regen; FTD ships 1254²) | Bottom nav center. |
| 10 | Settings icon | `ui/menu-icons/icon_settings_gear.png`, `settings-icon-runtime.png` | 256²/384² | Bottom nav. |
| 11 | Saga node: active | `ui/home/level-node-current-teal-runtime.png` | 320×300 | Glowing current-level button. |
| 12 | Saga node: locked | `ui/home/level-node-locked-runtime.png` | 320×300 | (+ complete-node variant `level-node-complete-runtime.png`.) |
| 13 | Scrolling background pattern | today a CSS/token paw-print pattern | tileable ~512² | The home map's repeating backdrop ("the paw thingy"). Must tile seamlessly vertically. |

Also swapped, not art: `game.title` + result copy in `design/copy.ts`; palette
in `design/tokens.css`.

## Generation pipeline (to be proven by producing the generic set)

1. **Style anchor** — one paragraph + palette defining the game's look
   (`design/style-anchor.md`). The generic set's anchor: "clean, friendly,
   casual-game gloss; neutral shapes (stars, gems, ribbons); no species, no IP."
2. **Prompt sheet** — one prompt per slot derived from a shared template:
   `{style anchor} + {slot description} + {composition constraints (centered,
   single object, plain background)} + {size}`. Checked in next to the anchor
   so regeneration is reproducible.
3. **Generate** — image model per slot (media-use / generation API), N=2–4
   candidates per slot.
4. **Post-process** — background removal → trim → downscale to slot size →
   sRGB PNG. (`media-use` remove-background + `sips`.)
5. **Install** — write to `design/assets/` (source) + runtime path, record in
   `design/asset-identity.json` (expectation: exact-bytes, or perceptual for
   derived downscales).
6. **Verify** — local browser pass over home/shop/win/fail, then device build;
   judge against the style anchor (panel or eyeball).

Each step is a tool invocation; the agent owns the loop (pick candidate,
retry a slot, stop). No autonomous batch machine.

## Status

- 2026-07-16: shop slot repair landed (current-gen art repointed, stale
  variants deleted) — precondition for this list.
- Next: generate generic set per pipeline above; fail-screen restyle (#7)
  rides with the "Out of Lives" title art.
