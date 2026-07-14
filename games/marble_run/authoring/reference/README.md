# Marble Run current-source editor reference

This directory freezes validation facts at source `4cb6f596`. It is deliberately not a third editable layout authority. GrapesJS and Phaser Editor must each author their own native presentation and use these files only to validate screen coverage, semantic identity, exact bytes, copy, hierarchy, and projection.

## Authority and source hierarchy

1. `src/shell/App.ts` owns lifecycle composition and binds current copy/assets: menu at lines 232-255, shop at 338-379, result states at 382-463, pause at 465-479, and both settings variants at 482-568.
2. `src/game/GameController.ts` owns the live gameplay HUD. The four stable corners and their exact DOM bindings are at lines 638-675. Three.js board/camera/physics remain excluded.
3. Shared consumers are structural truth: `packages/ui/src/HomeMenu.ts:60-111`, `SagaMap.ts:68-130`, `ResultCard.ts:68-125`, `PauseOverlay.ts:43-90`, `ModalShell.ts`, `ToggleRows.ts`, and `ShopPage.ts:153-428`.
4. `design/theme.ts:9-60` maps exact current asset bytes to runtime URLs; `design/copy.ts:6-66` is current visible copy; `design/tokens.css:13-187` supplies fonts, color, and safe-area tokens.
5. `index.html:5-16` establishes `viewport-fit=cover`; its inline stylesheet and `packages/ui/src/ui.css` are geometry truth. `--fab-safe-top` is applied to top chrome, while the device verifier removes system/navigation bars for judged content.

## Ambiguous bindings resolved

- Blank vs title-bearing ribbons: runtime imports the blank completed/failed files (`theme.ts:18-19`) because `ResultCard` renders title/eyebrow as DOM (`packages/ui/src/ResultCard.ts:106-123`). The similarly sized title-bearing `ribbon-completed.png` and `ribbon-failed.png` are committed provenance only and must not be substituted.
- Settings uses `ribbon-orange.png`, also with a DOM title (`App.ts:494-513`).
- `popup-card.png` is the blue foreground card; `marble-shadow-tile.png` is the decorative board behind it (`App.ts:399-401,456-458,510-512`). They are separate selectable layers.
- The menu banner is composite art plus a separate live `Marble Run` text layer (`App.ts:724-737`), so both remain meaningful elements.
- Shop cards have no game asset icon: `openShop` does not pass `resolveIcon` (`App.ts:338-379`), and `ShopPage` only creates an image when that resolver exists (`packages/ui/src/ShopPage.ts:199-211`). Do not invent coin/no-ads art.
- The pause surface is shared procedural CSS, not `popup-card.png` (`App.ts:465-479`).
- The fail face is live platform emoji text (`App.ts:749-754`), not an imported bitmap. Capture on Android is the rendering authority.
- `button-booster.png`, `frame-currency.png`, `icon-back.svg`, and `icon-replay.png` are imported into `assetUrls` but never read by the current shell. `level-node-default.webp` is installed as a fallback, while current node state construction yields completed/current/locked. `Lilita One` has a font-face but is absent from the live font stack.

## Primary vs auxiliary states

The primary editor surface is exactly: menu, gameplay HUD, pause, settings-from-menu, settings-from-pause, win, fail, finale, and shop. Connectivity, toasts, coin-flight, tutorial guidance, and delayed fail/loading feedback are auxiliary/transient and are inventoried separately. A baseline screenshot must be taken only after the requested primary state is stable; transient delayed controls must never be mistaken for the primary state.

## Geometry contract

Author at 390 x 844 portrait. Preserve the declared parent/group and instance seed, but treat measurements and selectors in `screens.yaml` as validators rather than importable layout authority. Other portrait sizes use a uniform composition projection; responsive reflow is out of scope. Gameplay editor scenes use the declared neutral background behind the exact HUD and must not recreate the excluded board or imply fake mechanics.

## Exact-byte check

From the repository root:

```sh
shasum -a 256 games/marble_run/design/assets/* games/marble_run/design/assets/fonts/*
```

The result must match `assets.yaml`. No regeneration, optimization, conversion, or substitution is permitted.
