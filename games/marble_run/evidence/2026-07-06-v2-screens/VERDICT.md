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
