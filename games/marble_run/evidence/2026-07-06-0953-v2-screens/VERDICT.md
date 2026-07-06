# Aesthetics review — marble_run v2 port (conductor, 2026-07-06)

Captured against `npm run dev` via harness-driven playwright (scripts in .work/).
Viewport 390x844 portrait.

| Shot | Surface | Verdict |
|---|---|---|
| 01-home-menu-saga | HomeMenu + SagaMap + tilted board | WORKS; FINDING A |
| 02-settings-page | SettingsPage + ToggleRows (music/sfx/haptics) | WORKS; FINDING B |
| 03-gameplay-hud | free-canvas HUD (hearts, coin pill, pause, hint w/ cost) | PASS |
| 04-pause-overlay | PauseOverlay (Resume/Settings/Quit) over dimmed board | PASS |
| 05-result-card | ResultCard win variant + reward + coin-fly mid-flight | PASS |

FINDING A (menu): header banner renders as a large empty yellow slab — the
header slot has no logo/title content (placeholder asset not bound?); saga rail
numbers are low-contrast against the purple background.
FINDING B (settings): page is unthemed — default white page background, empty
back-button circle; --fab-page/settings tokens for this game's theme are
incomplete in design/tokens.css relative to every other themed surface.

Both findings are design/tokens+assets completeness, not component defects —
exactly the layer the reskin drill exercises. Fix in-port before landing.

---

## Re-review after fix (aesthetics_reviewed worker, 2026-07-06)

FINDING A — RESOLVED. Root cause was broader than "empty banner": @fabrikav2/ui
ships its neutral token DEFAULTS on `.fab-ui` inside `@layer fab.tokens`, and
every mounted screen root carries `.fab-ui`. The game's `:root`-only overrides
lived on <html> and were SHADOWED on each screen by that screen's own `.fab-ui`
default — so accent/surface/level-map all fell back to grey/white on EVERY v2 ui
surface (Play button was grey #6b7280, not orange; saga nodes had no disc art;
node numerals used default colors). Fix: scope the ui-consumed tokens to
`:root, .fab-ui` (unlayered beats layered on the same element) + inject the
level-node art as an unlayered `.fab-levelmap` rule (an inline theme on the
composing HomeMenu never reached the nested SagaMap, whose own `.fab-ui` root
re-defaulted art to `none`) + overlay the `Marble Run` title on the plaque frame.
Menu now themed end-to-end (orange Play, gold plaque + title, wooden/sun nodes
with legible brown numerals).

FINDING B — RESOLVED. Added `--fab-page-overlay-bg`/`--fab-page-card-bg` (themed
cream) + a back-arrow SVG (design/assets/icon-back.svg) + a "Settings" title
header. Settings page is now cream with brown ink, orange toggles, and a
chevron back button.

Fresh 5-frame re-review by the adversarial game-aesthetics-reviewer sub-agent
confirmed A & B resolved and NO regression on pause/result. Its new P1s all land
on the FREE-CANVAS layer, OUT of this card's design/reskin scope and already
PASSED by the conductor above (gameplay HUD = PASS; tilted board = WORKS):
 - HUD (frame 3, src/game/GameController): top row lacks safe-area-inset-top;
   tutorial cue uses OS emoji (👆); hearts are flat black + currency chip grey —
   all ported verbatim from shipping v1 sugar3d.
 - Menu decor board (frame 1): the ported 3D menu board sits behind the rail and
   only backs 3 of 5 nodes → reads as collision to a fresh eye.
These are deferred to a HUD/free-canvas reskin (natural home: the "wire ALL"
follow-up card), not this port's design-layer gate. Zero P1 on the governed v2
ui surfaces → gate cleared.
