# v1 vs v2 marble_run — visual fidelity + functional findings (conductor, 2026-07-06)

Side-by-side: v1 sugar3d dev (5211) vs v2 port dev (5210), 390x844. Files here.

## P1 — FUNCTIONAL
1. **Menu buttons dead to real input.** A genuine playwright click on Play times
   out / changes nothing (v2-02 identical to v2-01). JS el.click() works — so
   something intercepts pointer events above the buttons (saga rail / canvas /
   overlay stacking). This also matches Batu's on-device report. The e2e suite
   missed it because the harness drives startLevel() directly — see harness-gap
   note in docs/retros/insitu-testing-capability-notes.md.

## P1 — LEVEL VIEW (the core visual regression)
2. **Board camera/orientation wrong in-level.** v1: near-top-down, straight
   board, fills ~60% of width, tutorial spotlight + hand. v2: board rendered as
   a small 45°-rotated diamond floating mid-screen. Compare v1-03 vs v2-03.
   Suspect: v1 App.ts camera params (fov/position/rotation per scene state) not
   carried into GameController's play-state camera.

## P2 — MENU STRUCTURE (reference has none of this)
3. v1 menu bottom = ONE chunky green "LEVEL 1" candy button. v2 invented a
   Play/Levels/Settings stack; "Levels" screen isn't a thing in any of our
   games (Batu). Restore: single primary LEVEL N button; settings via top gear.
4. v1 top bar = blue coin pill (left) + blue gear (right). v2 menu has NO top
   bar at all.
5. Saga rail: v1 nodes hug a centered chain below the board with slight
   alternating offsets; v2 scatters nodes across the full width overlapping
   the board.

## P2 — HUD/CHROME FIDELITY IN LEVEL
6. v1 HUD: chunky teal panels (hearts panel TL, gear TR, coin pill BL, square
   HINT+cost BR). v2: flat text+emoji HUD, grey pills, hint pill bottom-center.
   The free-canvas HUD did not port v1's chrome, and ui tokens don't cover it.
7. Background: v1 patterned purple (marble motifs) + ambient confetti on menu;
   v2 flat purple everywhere.

Note: marbles/board assets themselves match (same textures) — the gap is
camera, chrome, and layout, i.e. design/tokens + shell composition + one
pointer bug. All fixable without touching gameplay.
