# Cozy Garden 3D complete runtime UI audit

This audit follows runtime consumers in `src/`, not every historical file that
happens to remain under `public/ui`. The current contract is: semantic text and
prices stay live; meaning-bearing icons remain individual assets; repeated
cards, rows, buttons and backgrounds use the shared texture/nine-slice system.

Status keys:

- **Approved** — already belongs to the current Cozy Garden 3D set.
- **Replaced** — corrected during the complete-set pass.
- **Shared surface** — no one-off bitmap should be generated for this element.

## Home and navigation

- `home-banner-mascot-runtime.png` — **Approved**; Home title/banner.
- `no-ads-runtime.png` — **Replaced**; carved honey-wood/coral/olive badge,
  alpha-trimmed to a 320 px canvas with an 8 px safety margin.
- `level-node-complete-runtime.png` — **Approved**; completed saga node.
- `level-node-current-teal-runtime.png` — **Approved**; sole current saga node.
- `level-node-locked-runtime.png` — **Approved**; locked saga node.
- `level-node-locked-bones-runtime.png` — **Approved**; alternate locked node.
- `play-level-button-runtime.png` — **Approved**; primary Home Play Now body.
- `nav-bar-3.png` — **Approved**; active three-slot bottom tray.
- `settings-icon-runtime.png` — **Approved**; Home Settings destination.
- `shop-icon-runtime.png` — **Approved**; Home Shop destination.
- `magnifier-runtime.png` — **Approved**; Home Play destination.
- `achievement-shortcut-runtime.png` — **Approved**; Home Achievements shortcut.
- `icon_coin.png` — **Approved**; coin balance.
- `icon_hint_magnifier.png` — **Approved**; hint balance.
- `background-feather.svg` — **Approved**; sparse moving Home motif only.

The old `node-current-candy.png` is no longer a design binding or runtime
consumer. The four- and five-slot trays remain valid expansion assets but are
not used by the current three-destination layout.

## Settings and HUD

- `back_button.png` — **Approved**; shared page back action.
- `settings_icon_home.png` — **Approved**; Settings Home row.
- `settings_icon_music.png` — **Approved**; Settings Music row.
- `settings_icon_sound.png` — **Approved**; Settings Sound row.
- `settings_icon_vibration.png` — **Approved**; Settings Vibration row.
- `icon_settings_gear.png` — **Replaced by reuse**; byte-identical to the
  approved Home settings gear instead of retaining the coral legacy gear.
- `icon_heart.png` — **Replaced**; coral heart in a honey-wood garden medallion,
  alpha-trimmed to a 256 px canvas with an 8 px safety margin.

Settings shell, rows, toggles, Restore and Privacy actions are **Shared
surface** consumers. Their copy remains live HTML; the visual bodies use
`canvas-cream`, `painted-olive`, `panel-honey` and `button-olive`.

## Shop

- `shop_no_ads.png` — **Approved**; standard no-ads product illustration.
- `shop_no_ads_premium.png` — **Approved**; premium no-ads illustration.
- `shop_vip_bundle.png` — **Approved**; VIP product illustration.
- `shop_hint_pack_small.png` — **Approved**; 10-hint product.
- `shop_hint_pack_medium.png` — **Approved**; 25-hint product.
- `shop_hint_pack_large.png` — **Approved**; 50-hint product.
- `shop_coin_pack_1.png` through `shop_coin_pack_6.png` — **Approved**; all six
  current coin product tiers.

Shop header, balance pills, featured cards, section headers, product cards and
price buttons are **Shared surface** consumers. “Popular” and “Best Value” are
now live text on one reusable painted-olive ribbon component. The two old
candy badge bitmaps remain historical files but have no runtime or design-sheet
binding.

## Achievements

- `achievement-completion.png` — **Approved**.
- `achievement-birds.png` — **Approved**.
- `achievement-mastery.png` — **Approved**.
- `achievement-progression.png` — **Approved**.
- `achievement-streak.png` — **Approved**.

Achievement cards, progress bodies and unavailable states are **Shared
surface** consumers using canvas interiors and honey-wood frames.

## Result, fail and boot states

- `dog-detective-complete.png` — **Approved**; happy bluebird result mascot.
- `dog-detective-crying.png` — **Approved**; fail-state bluebird mascot.
- `level-complete-title.png` — **Approved**; result title art.
- `rewarded-ad-badge.png` — **Replaced**; blue painted-wood video sign with
  garden ornament and feather-coin reward, alpha-trimmed to 256 px.
- `dog-detective-openai.png` — **Approved**; boot/loading mascot.

Level-complete, fail and pause panels plus primary actions are **Shared
surface** consumers. The reusable canvas/wood panel is responsible for the
container; individual artwork is reserved for mascot, title and rewarded-video
meaning.

## Shared surface inventory

- `canvas-cream-seamless.png` — page and card interiors.
- `painted-olive-seamless.png` — navigation, secondary actions and headers.
- `painted-sky-seamless.png` — primary actions and purchase buttons.
- `wood-honey-seamless.png` — saga path and warm structural accents.
- `panel-honey-9s.png` and `panel-olive-9s.png` — scalable card frames.
- `button-olive-9s.png` and `button-sky-9s.png` — scalable action frames.

All four textures are exact 256 px seamless tiles with pixel-identical opposite
edges. Slice values and hashes are pinned in `design/ui-surfaces.json`.
