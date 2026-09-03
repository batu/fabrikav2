# 2026-09-03 — final pass before TestFlight

Batu: "delete the game and install, and then do one final pass before we send
it"; mid-pass: "when I go to the next level, it shouldn't have a black screen
and it shouldn't go to the menu".

## Fresh-save walkthrough (dev build, drive)

`01-fresh-home` (level 1, 10 energy, 50 gold, 30 crystals, 30 gems, minimal
skin on) → `02-level1-fight` → `03-level1-result` (Batu was playing in
parallel; this is his level-2 clear at 2×) → `05-rift-fresh`, `06-first-reveal`,
`07-mages-fresh`, `08-shop-fresh` are his level-3 fight because the drive and
his taps interleaved; `09-settings-fresh` is the settings page.

## Found and fixed

1. **Black frame on Next level.** Every level rebuilt the battle page and booted
   a new Phaser scene (with texture preload). The scene now stays and rebuilds
   the field in place on sim restart (units, dressing, ground texture, theme,
   camp, camera); the level label and header theme update live.
   `10-next-level-burst.png`: 16 frames at 60 ms across Next into level 4
   (forest, wolves); dark-pixel fraction ≤ 1.3 % in every frame.
2. **Next dropped to the menu.** `next()` only starts a battle when energy
   allows; at 2× energy runs out and the tap landed on the menu. The victory
   card now keeps Next disabled with a live "Out of energy. Next in Ns." line
   until energy arrives. `11-victory-no-energy.png`; probe: `disabled: true`,
   note "Out of energy. Next in 32s."

## Delete and install

App uninstalled from the iPhone (`devicectl … uninstall`), then the standalone
bundle installed via `mm-install.sh` (bundled dist, no dev server; the
gitignored `ios/` project still carries bundle id `com.basegamelab.mage_master`,
so the launch is done by hand with that id). Boot capture: `12-standalone-home.png`.
