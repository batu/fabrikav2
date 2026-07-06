# Asset-swap plan — marble_run (FIDELITY FIX 4, TO6dZrkM)

Every asset the rigorous diff marked **NO** (v2 stand-in ≠ the reference's real
asset), with its `design/assets.ts` binding, target look, chosen source, and
current wired-vs-parked status.

**Source decision (conductor, comment 1):** marble_run is our own game (sugar3d).
The reference's real sprites/fonts live in the repo — no APK extraction, no
generation needed. All assets copied **READ-ONLY** from
`games/marble_run/sugar3d/src/ui/assets/` into `games/marble_run/design/assets/`.

**Footprint of this card:** `games/marble_run/design/**` only. The gear glyph,
end-screen overlays, saga rail, background motif, and heart glyphs are rendered
by `src/shell`, `packages/ui`, and the saga/overlay workers — disjoint cards.
This card copies + binds + exports the correct bytes so those workers inject them
without re-touching `design/`; it wires the swaps whose consumers already live in
`design/`-bound code (coin, fonts).

## Ledger

| # | Asset (diff NO) | v2 stand-in | Target look (reference) | Source (vida/**) | Binding | Status |
|---|---|---|---|---|---|---|
| 1 | Coin icon | `icon-marble-coin` — muddy marble disc | Gold `$`-coin | `GameScreen/Icon_Coin.png` → `icon-coin.png` | `hud.coin` / `assetUrls.coin` | **WIRED** — consumed by `src/shell/App.ts` (menu pill + reward badge). |
| 2 | Settings gear | `icon-gear` — muddy disc | Blue-steel cog sprite | `GameScreen/Icon_Settings.png` → `icon-settings.png` | `hud.gear` / `assetUrls.gear` | **BYTES SWAPPED, RENDER PARKED** — `App.ts` still draws a `⚙` text glyph (`.mr-gear-glyph`), not `assetUrls.gear`. Binding is correct-by-default; the shell worker swaps the glyph→`<img>`. |
| 3 | Win art (crown) | globe-disc win art | Gold outlined **crown** | `End/Win/Icon_Crown.png` → `win-crown.png` | `resultModal.crown` / `assetUrls.crown` | **STAGED for FIX-1** — exported for the shared OverlayCard; overlay/win screen lives in `packages/ui` + shell (FIX-1 hcuSVRBy). |
| 4 | Saga connector | single rope (CSS gradient) | Twin-rail | — (no sprite; CSS `--fab-levelmap-line-*` gradient tokens) | `tokens.css` line tokens | **PARKED — CSS-drawn, saga worker (FIX-2 vW1HVdy8).** No standalone sprite exists in vida/. |
| 5 | Hearts | system emoji ❤ | Drawn heart glyph + frame | — (v1 renders CSS glyph `font-size:26px; color:--sugar-marble-red`, optional `.vida-hearts-frame` image) | `--fab-color-heart` | **PARKED — CSS-drawn.** No standalone heart sprite; a heart-frame image is optional shell chrome. |
| 6 | Background pattern | flat dots | Translucent marble spheres | — (CSS `--fab-color-bg-motif`, composed in `index.html`/shell) | `--fab-color-bg-motif` | **PARKED — CSS/shell.** Motif is painted in the shell backdrop, outside `design/`. |
| 7 | HINT tile | grey-lavender | Warm tan chunky panel | — (CSS chrome tokens) | `--fab-color-secondary-*` | **PARKED — CSS chrome.** Reskin via tokens, no sprite. |
| 8 | Fonts | soft sans (Nunito) | Chunky outlined display | `fonts/{FredokaOne.woff2,TitanOne.ttf,LilitaOne.ttf}` | `tokens.css` `@font-face` + `--fab-font-family` | **WIRED** — `@font-face` added; `--fab-font-family: 'Fredoka One','Titan One',system-ui`. Consumed by `@fabrikav2/ui` + HUD. |

## Also staged (reference's own sprites, exported for downstream injection)

Copied into `design/assets/` and exported from `assetUrls` so the FIX-1 overlay /
ribbon-banner and shell consume them without re-touching `design/`. Per the
**ribbon contract** (FIX-1 hcuSVRBy), marble_run OWNS these bytes and passes them
in — `packages/ui` must NOT hard-style the ribbon/crown look.

- `ribbon-completed.png` (`End/Win/Ribbon_Completed.png`) → `assetUrls.ribbonCompleted`
- `ribbon-failed.png` (`End/Fail/Ribbon_Failed.png`) → `assetUrls.ribbonFailed` (replaces the old `ribbon-fail.webp`)
- `ribbon-orange.png` (`End/Tutorial/Ribbon_Orange.png`) → `assetUrls.ribbonTutorial`
- `popup-card.png` (`End/Win/Popup.png`) → `assetUrls.popup`
- `button-green.png` (`End/Win/Button_Green.png`) → `assetUrls.buttonPrimary`
- `button-orange.png` (`End/Fail/Button_Orange.png`) → `assetUrls.buttonSecondary`
- `frame-currency.png` (`GameScreen/Frame_Currency.png`) → `assetUrls.currencyFrame`
- `button-booster.png` (`GameScreen/Button_Booster.png`) → `assetUrls.booster`

## Saga node art

`level-node-{default,current,completed,locked}.webp` already present in `design/`
and bound via `theme.ts` `installLevelMapArt`. These are the reference's own node
webps — verified correct, no swap needed.

## Blocked-on-other-workers (NOT blocked on Batu)

No asset is blocked on Batu — all bytes are in-repo. The remaining render work is
owned by disjoint cards:

- **Gear render** (row 2): shell worker swaps the `⚙` glyph for `assetUrls.gear`.
- **Win crown + end-screen overlays** (row 3, staged set): FIX-1 (hcuSVRBy) shared OverlayCard / ribbon-banner injects `crown`/`popup`/`ribbon*`/`button*`.
- **Saga connector** (row 4): FIX-2 (vW1HVdy8) — CSS twin-rail, no sprite.
- **Hearts / background / HINT** (rows 5–7): CSS-drawn; token/shell reskin, no sprite.

## Verification

- `npm run typecheck` (marble_run) — pass
- `npm run test:unit` (marble_run) — 64 pass
- `npm run build` (marble_run) — pass; `icon-coin`, `icon-settings`, `win-crown`,
  `popup-card`, `ribbon-*`, `button-*`, `frame-currency`, `button-booster`, and
  the three hashed webfonts all emit to `dist/assets/`; built CSS carries the
  three `@font-face` rules with resolved hashed `url()`.
- `node tools/audit/src/cli.js` — pass (warnings identical to pre-change baseline;
  no new literals/duplication introduced by `design/`).
