# Requirements audit against the design document

Source: `refs/notes/Mage Masters Concept.pdf` and `refs/notes/pitch/MageMasterPitch.html`
(sections 1–12). Graded 2026-09-02 after the recorded playthrough in
`evidence/2026-09-02-04-video/` (walkthrough.mp4 at 1 fps, battle bursts at 15 fps)
and the on-device captures in the earlier evidence passes.

Grades: **MET** (seen in the recording or a device capture), **PARTIAL** (implemented
with a deviation, named), **MISSING** (not built).

| # | Requirement (design doc) | Grade | Evidence / note |
| --- | --- | --- | --- |
| 1 | Idle auto-battler: you never touch the fight | MET | walkthrough: battle runs with no input; only Pause and 2× are tappable |
| 2 | Three fixed mages, Tank / Warrior / Support, never level, never change | MET | mages page shows base + gear only; no XP anywhere |
| 3 | Power = class base + two equipped items (weapon + armor) | MET | mages page stat grid; `mageStats()` in `src/game/economy/items.ts` |
| 4 | Class-match is the only equip gate (no level requirement, no set bonus) | MET | items are rolled for one class; reveal says "For the {mage}"; no other gate exists |
| 5 | Ten stats: HP, HP Regen, Dodge, Block, ATK, DEF, Attack Speed, Crit Chance, Crit Damage, Movement Speed | MET | all ten on the mages page and in the sim |
| 6 | Movement Speed only matters for melee | MET | ranged mages hold position in the sim; melee close in |
| 7 | Weapon rolls primary ATK + four traits (Range, Pattern, Element, Stats) | MET | reveal card: "Melee · Area · Arcane", ATK primary, substats by rarity |
| 8 | Armor rolls primary HP with DEF / HP Regen / Dodge / Block | PARTIAL | primary HP and those four are in the pool; the pool also allows a small ATK substat the doc does not list |
| 9 | Extra stat count set by rarity | MET | `RARITY_TABLE.substats` 0–4; legendary reveal shows three stats |
| 10 | Pattern and Element roll independently of role | MET | random per weapon (`rollItem`) |
| 11 | Fire → Burn DoT | MET | burn ticks + flame particles (`frames-03.png`) |
| 12 | Ice → Chill slows attack and move | MET | chill status in sim; ice tint on device |
| 13 | Lightning → Chain arcs to a nearby enemy | MET | chain bolt between enemies (`frames-04.png`, level-8 slime capture) |
| 14 | Arcane → Pierce ignores some DEF | MET | `defIgnored: 0.5`; visible only as damage numbers |
| 15 | Single-target vs AoE, melee vs ranged, all visible in play | MET | area ring on AoE hits, projectiles for ranged, lunges for melee |
| 16 | Ten rarity ages, Common → Ultimate | MET | odds table at max tier lists all ten; Ultimate 2 % |
| 17 | Rarity = magnitude + stat count | MET | `RARITY_TABLE.magnitude` 1× → 20× |
| 18 | Summon Rift: spend Crystals to pull weapons and armor | MET | walkthrough: Summon with the crystal cost badge |
| 19 | Rift upgraded with Gold on a real-time timer; odds slide toward rarer ages; lowest ages drop off; real odds always shown | MET | walkthrough: upgrade → timer → tier 2; odds table current vs next |
| 20 | Use (equip, swaps, old item → gold) / Discard (→ gold); no merging | MET | walkthrough: Use and Discard; "Replaces … (N gold)" |
| 21 | Four currencies: Energy, Gold, Crystals, Gems | MET | top bar |
| 22 | Energy: regen over time, offline regen, spent per level; never a paywall | MET | 45 s regen, tick on boot covers offline; soak: no paywall exists |
| 23 | Gold faucets: drops, discards, offline income; sink: Rift upgrades | MET | all present |
| 24 | Crystal faucets: drops, offline income; sink: pulls | MET | all present |
| 25 | Gems faucets: **purchased**, milestone trickle; sink: skip Rift timer | MET (sandbox) | Shop tab sells three gem packs through the sdk's sandbox purchase provider (instant settle, no store account); milestone trickle and gem skip unchanged. Real-money wiring (RevenueCat + App Store products) is a separate lane. |
| 26 | Offline income = passive rate tied to highest cleared level, 8 h cap | MET | walkthrough: "Welcome" grant after a 3 h backdate; `OFFLINE.capHours = 8` |
| 27 | Progression = Levels of Stages; clearing all unlocks the next | MET | ladder, first-clear timeline in the soak |
| 28 | Difficulty ramps per level, spikes at the last-stage boss | MET | boss wave with escorts; boss banner + shake |
| 29 | Player power leads early, converges later | PARTIAL | levels 1–5 in three minutes then a level-6 wall in the soak; ramp softened after, not yet re-soaked |
| 30 | Loss when all three mages die → back to menu | PARTIAL | defeat card offers Retry as well as Home (an addition) |
| 31 | Stage ends when all enemies are defeated; mages run forward, camera follows | MET | `frames-01.png` stage-clear sweep |
| 32 | Portrait, top-down; enemies spawn top and advance down; camp ledge at bottom | MET | every battle capture |
| 33 | Left-edge vertical stage track | MET | battle captures |
| 34 | Bottom HUD: per mage name, HP bar, two gear slots | MET | battle captures (plus a portrait) |
| 35 | No prestige, no "Timeline" wording | MET | none |
| 36 | Short active bursts several times a day + offline accrual | MET | energy cap 10 and offline grant support it |

## Summary

- **MET: 32 of 36** (2026-09-03 update: the Gem shop landed on the sandbox provider).
- **PARTIAL: 4.** #8 armor substat pool includes a small ATK roll the doc does not list; #29 the early ramp was a wall at level 6 in the first 30-minute soak, softened afterwards (headless pacing now reaches level 9–10 with 6 losses; device re-soak pending); #30 the defeat card adds Retry to the doc's "return to menu"; the Gem purchase is sandbox-only (no real store).
- **MISSING: 0.**
