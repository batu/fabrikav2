# Reference research — 2026-09-06

The corrected reference name is **Vampire Survivors**; “Empire/Power/Fire Survivors” in the spoken brief was not a request for a different game.

[Vampire Survivors, developer Steam listing](https://store.steampowered.com/app/1794680/Vampire_Survivors/) describes escalating hordes, roguelite survival, and collecting gold for future upgrades. The useful design principle is two different growth loops: choices within a run and purchases that improve the next attempt. This slice keeps that distinction in separate run stats and persistent saves.

[Megabonk, developer Steam listing](https://store.steampowered.com/app/3405340/Megabonk/) explicitly describes XP from defeated enemies, random upgrade offers with varying rarity, and unlockable characters with distinct abilities. Those are the basis for ranked card drafts and a small character roster here; its free movement and 3D maps are not part of this design.

Stat terminology cross-checks: the community [Vampire Survivors Might](https://vampire-survivors.fandom.com/wiki/Might) and [Luck](https://vampire-survivors.fandom.com/wiki/Luck) pages describe separate damage scaling and chance-related effects. The community [Megabonk stats reference](https://megabonk.org/guides/stats/) distinguishes attack speed, XP gain, and luck-driven reward quality. These are secondary references for terminology, not an authoritative balance specification. This game uses plain labels: damage, fire rate, area, XP gain, luck, and critical chance. Luck only improves card-rarity odds; it does not secretly increase critical chance. Attack speed and fire rate are the same stat.

The supplied [Steam community hub](https://steamcommunity.com/app/4911450/) identifies **shatAAAAp!** through Steam's app-details metadata. The hub itself did not load reliably during research; no firsthand play or video inspection of that game is claimed.

Our design decisions: stationary aiming, automatic fire, automatic towers, automatic XP collection, between-wave picks, ten-wave levels, repairing structures, and persistent compact defense placement. No source-game assets, exact probability tables, economy, or weapon values were copied. The prototype's formulas are original tuning defaults in `catalog.ts`, `progression.ts`, and `simulation.ts`.
