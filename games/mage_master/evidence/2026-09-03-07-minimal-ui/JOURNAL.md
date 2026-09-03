# 2026-09-03 — minimal interface mod (branch `feat/mage-master-minimal-ui`)

Reference: Forge Master – Idle RPG (App Store screenshots): flat white panels,
thin lines, one red accent, rounded flat tiles, small pill counters, no frames
or texture. Implemented as a persisted save setting (`settings.minimalUi`,
default on for this branch) that withholds the painted chrome in the shell
and restyles the same DOM through `src/shell/mage-master-minimal.css`.

All captures are from Batu's iPhone 12 (dev build loading from the Vite
server at 192.168.1.74:5199), driven with `mm-drive.sh` and shot with
`mm-shot.sh`.

| # | Screen | State |
|---|--------|-------|
| 01 | Home | minimal — flat party card, centered ladder with numbers, red Play |
| 02 | Rift | minimal — portal on a flat plate, odds table, secondary Upgrade |
| 03 | Reveal | minimal — white card, plain SUMMONED heading, rarity-tinted frame |
| 04 | Mages | minimal — white cards, flat gear slots |
| 05 | Shop | minimal — one row per pack, price button, Restore secondary |
| 06 | Settings | minimal — kit page; "Switch to classic interface" row |
| 07 | Battle at 3 s | minimal, mid stage-clear sweep (see 12–14) |
| 08 | Pause | minimal — flat arena, white card |
| 09 | Victory | minimal — plain heading, loot, Next/Home |
| 10 | Defeat | minimal |
| 11 | Home | classic, after switching from Settings (round-trip proof) |
| 12 | Battle at 3 s | classic — same brown ledge fills the field mid-sweep as 07 |
| 13 | Battle at 3 s | minimal — flat sand, no props, no vignette |
| 14 | Battle at 6 s | minimal — stage 2 fight |

Fixed during the round (first captures were overwritten):

1. Modal plates: the kit sets `cardImage` as an inline background, so the
   wood panel survived the stylesheet; the shell now passes it through the
   minimal gate.
2. Shop and settings: kit `.fab-btn` paints from `--fab-btn-sprite-image`;
   with no sprite the purchase, restore, back, and link buttons were
   transparent under a red hard-shadow. Each kit button now has its own
   flat fill; a first, generic `.fab-btn` rule bled onto the nav and the
   secondary modal buttons and was scoped back down.
3. Ladder: locked nodes hid their numbers (the classic padlock art rule) and
   the rail sat left; numbers restored, rail centered.

Not changed (follow-ups): nav, currency, and pause/back icons are still the
painted classic set; unit sprites and the ground plate colors are game art,
not chrome. The brown field mid-sweep (07/12) predates this branch.
