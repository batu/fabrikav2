# Mage Master — reference research (2026-09-02)

Desk research on the five reference games plus the Kingdom Rush art target,
gathered by two research passes before the MVP build. Facts carry their URLs;
"not found" means no primary source was located in the time box, not an
assumption. Decisions derived from this research are in the final section.

# Design Reference Research: Forge Master, Epic Stickman, Dicero

Research for Mage Master (idle auto-battler, 3-mage party, gacha "Summon Rift", real-time Rift upgrade timer). Compiled from web search, app store listings, wikis, and reviews. Facts not found are marked explicitly rather than guessed.

**Note on "Forge Master":** the name is shared by multiple unrelated App Store titles (e.g. id6475646255 vs id6746636289). This section documents the title corroborated by a fan wiki and calculator — [Forge Master – Idle RPG](https://apps.apple.com/us/app/forge-master-idle-rpg/id6746636289) by Lessmore UG, Google Play package `com.hariwn.legendofcivilizations`, tagline "Craft Gear Through the Ages" (Stone Age → Quantum Age) — whose Hammer/Coin/Winder economy and "Quantum" tier match that listing.

## Forge Master

**1. Core loop pacing.** Progression is stage-numbered (e.g. "Battle 2-4", "3-10", "4-15") rather than discrete timed runs; combat reads as continuous/idle, not wave-by-wave clears. "With a solid setup, you can reach 4-15 in one day" of early play. Optional daily dungeons (Hammer Thief, Invasion, Ghost Town, Zombie Rush) reset each day and reward specific materials. No explicit "run ends when X" trigger was found — progress is gated by a stat/power wall rather than a death condition. [1vcian.me guide](https://1vcian.me/ForgeMasterCalculator/guide.html), [Apple listing](https://apps.apple.com/us/app/forge-master-idle-rpg/id6746636289)

**2. Gacha/summon odds.** Pet rarities: Common, Rare, Epic, Legendary, Ultimate, Mythic, distinguished by hatch time (30 min / 2 h / 4 h / 8 h / 16 h / 32 h). Equipment/age tiers referenced as Space → Interstellar → Multiverse → Quantum → Divine. Mount summon costs 50 "Winders" per pull across 5 rarities; Common mounts grant +10% Damage/+10% Health, Rare mounts +40%/+40% (stat payouts, not pull odds). Update 2.0.0 added bulk "summon higher amounts of Skills, Eggs and Mounts." No published pull percentages or pity system were found anywhere (wiki, store listing, or reviews); one reviewer reported "it took over 2 weeks after the update to get one mythic skill." [1vcian.me guide](https://1vcian.me/ForgeMasterCalculator/guide.html), [clashiverse mount guide](https://clashiverse.com/forge-master-mount-guide/), [Apple listing](https://apps.apple.com/us/app/forge-master-idle-rpg/id6746636289)

**3. Currencies.** Hammers (crafting/forging resource; faucet = idle collection + Hammer Thief dungeon; sink = forging gear), Coins/Gold (faucet = idle collection + combat, e.g. "top 20 players gets 3k gold"; sink = upgrades), Gems (premium; sink = skipping forge timers, clan creation at 150 gems, IAP from $1.99), Winders (sink = mount summons), Potions (sink = Tech Tree), Egg Keys (sink = pet hatching), Ability Tickets (sink = skill upgrades). Offline income ≈ 1 coin/sec + 1 hammer/min, base cap 4 hours, extendable to 20 hours via a tech-tree node (≈86,400 gold + 1,440 hammers/day if never capped). [forge-master.fandom.com/wiki/Gold](https://forge-master.fandom.com/wiki/Gold), [1vcian.me guide](https://1vcian.me/ForgeMasterCalculator/guide.html)

**4. HUD layout.** Only confirmed detail: the screen persistently shows a stage indicator ("Battle 2-4") alongside a forge-progress indicator ("Forge Level 15") simultaneously, reflecting the dual idle-battle + active-crafting loop. Exact HP bar / gear-slot / button placement not found. [Apple listing](https://apps.apple.com/us/app/forge-master-idle-rpg/id6746636289)

**5. Feel/juice.** Not found: hit feedback (flash/knockback/damage numbers/screen shake), death animations, summon reveal ceremony. One review only notes "nice art." [Apple listing](https://apps.apple.com/us/app/forge-master-idle-rpg/id6746636289)

**6. Equipment model.** 8 slots: weapon, glove, necklace, ring, helmet, body, shoe, belt. Items roll multiple substats with per-item and account-wide caps, e.g. Attack Speed 40%/item, 480% total cap; Critical Chance 12%/item, 144% total cap; other substats include lifesteal, damage types, block chance. No dedicated salvage/discard economy was found — duplicates instead merge to raise skill rank or item level, and a higher-level copy of the same rarity acts as the progression bridge to the next tier. Class restrictions not found. [1vcian.me guide](https://1vcian.me/ForgeMasterCalculator/guide.html), [clashiverse beginner guide](https://clashiverse.com/forge-master-beginner-guide/)

## Epic Stickman

Full title "Epic Stickman: RPG Idle War" (Fansipan Limited), set in the "Shadow Realm"; hero classes Warrior, Rogue, Mage, Summoner.

**1. Core loop pacing.** Described as "wave based encounters, boss layers, and dungeon paths" with auto-battle combat that continues offline. Side "Activities" (Forest, Alchemy, Mine, Zodiac, World) are each gated behind a campaign stage milestone (e.g. Mine unlocks at "stage hard 1-1", World unlocks "at the start of expert mode"). Store screenshots contrast Level 10 vs. Level 99 combat, indicating a long deep progression curve. Exact wave count per stage, battle duration, or run-ending condition: not found. [epicstickman.wiki.gg/wiki/Activities](https://epicstickman.wiki.gg/wiki/Activities), [mwm.ai listing](https://mwm.ai/apps/epic-stickman-rpg-idle-war/6503872838)

**2. Gacha/summon odds.** Rarity ladder (7 tiers): Common → Uncommon → Rare → Epic → Legendary → Mythic → Exotic. Odds are shown in-game via an info icon next to the Summon level bar, but the exact percentages were not reproduced in any indexed source. Summon level (a meta-upgrade for pull odds) has 10 levels, gated at cumulative pull counts of 1,260 / 4,000 / 10,000 / 20,000; higher summon level raises rare-item odds. No classic pity counter, but any item reaching level 100 auto-converts further duplicates into an equal-or-higher-rarity item. Pull currency: Gems (500 Gems = 11 pulls, 1,500 Gems = 35 pulls) or ads, capped at up to 20 free ad-pulls/day across 3 ad views per item category. [epicstickman.wiki.gg/wiki/Summoning](https://epicstickman.wiki.gg/wiki/Summoning)

**3. Currencies.** Gems (premium; sink = rare gear/skins, summon bundles), Gold (sink = maxing hero level and skill trees; faucet not detailed). No energy/stamina system was located — the game markets continuous auto-combat "even while offline," consistent with an unglated main loop. Offline income rules/caps: not found. [WebSearch synthesis of Epic Stickman wiki/store pages]

**4. HUD layout.** Not found beyond generic screenshot descriptions (hero + companion sprites, glowing blue attack effects at high level).

**5. Feel/juice.** Reviews describe combat as "flashy, with screen-clearing special effects and satisfying sound design," with visual design "emphasiz[ing] clarity, fluid motion, and readable combat feedback" so that health changes, critical hits, shield blocks, and ability activations "communicate... at a glance." Criticisms: an objectively-best paid character, poor stat/skill scaling (especially Health), and a pet system that "feels tacked on." Summon reveal ceremony mechanics and specific rarity colors: not found. [mwm.ai listing](https://mwm.ai/apps/epic-stickman-rpg-idle-war/6503872838)

**6. Equipment model.** Gear drops as Weapons or Armor from the Summoning system. Weapons raise Attack, Armor raises Health, each via a small passive "Owned Effect" (bonus just from having the item in inventory) plus a much larger "Equipped Effect" (bonus only while worn) — i.e., collection itself has value, not just equipping. Slots per hero, stat-roll ranges, and class-gear restrictions: not found. Duplicate handling: see level-100 auto-conversion under (2). [epicstickman.wiki.gg/wiki/Summoning](https://epicstickman.wiki.gg/wiki/Summoning)

## Dicero

By HABBY (Archero, Archero 2, Survivor.io, Capybara Go!). "Roll-to-act" roguelite: dice rolls gate an Archero-style pick-one-of-three skill choice. iOS id6740966864, Android package `com.bailing.lark.roll.dev`. App Store rating 4.8/71 reviews (age 9+); GamingOnPhone review score 8.5/10. [Apple listing](https://apps.apple.com/us/app/dicero/id6740966864), [GamingOnPhone review](https://gamingonphone.com/reviews/dicero-game-review/), [mobidictum](https://mobidictum.com/dicero-habbys-top-global-mobile-games-march-2026/)

**1. Core loop pacing.** Roguelite run structure ("no two runs are the same"); campaign organized in numbered stages (e.g. "Stage 2-1") with named bosses (e.g. Frosthorn Minotaur). Mid-run, players pick skills of varying rarity from three sources: "Treasures," a "toad Roulette," or "the Angel." An idle/offline-income system unlocks at Stage 2-1. Exact run length, waves per stage, and the death/clear condition that ends a run: not found. [GamingOnPhone review](https://gamingonphone.com/reviews/dicero-game-review/), [Apple listing](https://apps.apple.com/us/app/dicero/id6740966864)

**2. Gacha/summon odds.** Meta-progression includes a "Pet Gacha" and "Star Tree Wish" event system, separate from the in-run Treasure/Roulette/Angel skill picks. No pull percentages or pity mechanics were found in any indexed source. Player sentiment (aggregated in search results) flags "a disconnect between the minute-to-minute [roguelite] gameplay and the Gacha mechanics, with generic equipment that boosts generic Gacha stats" — i.e. the meta-gacha layer reads as bolted onto the run-based core loop rather than integrated. [Play Store listing](https://play.google.com/store/apps/details?id=com.bailing.lark.roll.dev), [100user.com](https://www.100user.com/blog/habby-unveils-dicero-dice-based-roguelike-game)

**3. Currencies.** Energy/stamina: player-reported "6 games then have to wait 50 minutes for another" — called out as a pain point in feedback. Gold and Gems are generic currencies tied to equipment upgrades (faucet/sink detail beyond that: not found). Other meta-systems: Arcana/Cards (equippable modifiers between runs), Pets & Asterites (companion stat boosts), Curios (stat-boosting equipment with "resonance" effects, implying set-bonus-like synergy). IAP takes the form of "Stage packs, Gear chests, and other items," priced "low compared to other similar titles." Offline-income numbers/caps: not found. [Apple listing](https://apps.apple.com/us/app/dicero/id6740966864), [GamingOnPhone review](https://gamingonphone.com/reviews/dicero-game-review/)

**4. HUD layout.** Not found — no source described HP bar, gear-slot, wave-progress, or button placement.

**5. Feel/juice.** Marketing/review language: "bold effects, clean visuals, and big impact," pixel-art combat with "smooth animations" and a "vibrant anime-style presentation"; the dice-to-skill mechanic is called "surprisingly satisfying." A cosmetic transmog system lets players restyle weapons/outfits independent of stats. Specific hit-flash/knockback/screen-shake mechanics, death animations, and summon reveal ceremony (card flip, rarity glow) were not found. [GamingOnPhone review](https://gamingonphone.com/reviews/dicero-game-review/), [mobidictum](https://mobidictum.com/dicero-habbys-top-global-mobile-games-march-2026/)

**6. Equipment model.** "Gear" (upgraded with Gold/Gems) and "Curios" (stat items with resonance/set-like effects) are the two equipment-like systems; rarity words used include Epic and Legendary "and higher categories," but no full tier list was found. Slots per hero, stat-roll mechanics, class restrictions, and salvage/discard/conversion: not found — Dicero appears to run a single evolving hero per run (Archero-lineage), not a multi-hero roster with per-hero gear slots.

## Cross-cutting patterns

- **Auto-combat is the default state everywhere.** All three keep player input to macro decisions (summon spend, skill pick, upgrade timing) rather than direct battle control — true even in Dicero, whose "roll-to-act" hook is a skill-trigger layer on top of auto-combat, not manual fighting.
- **Rarity ladders converge on 5-7 named steps.** Forge Master pets: 6 tiers (Common→Mythic); Epic Stickman: 7 tiers (Common→Exotic); Dicero: at least Epic/Legendary confirmed. A 5-7 step ladder reads as the legible sweet spot for Mage Master's gear tiers.
- **None of the three publish exact pull percentages in any public source found** (wiki, store listing, or press/reviews) — Epic Stickman is the only one that even exposes odds in-app (behind an info icon), and none surfaced a pity system beyond incidental duplicate-conversion mechanics. Treat odds transparency as a differentiator Mage Master could choose to lead with, not an established norm to match.
- **Multi-pull bundles are retrofitted, not launch defaults.** Epic Stickman sells fixed 11-pull/35-pull bundles (500/1,500 Gems); Forge Master only added bulk pulls in a v2.0.0 update — suggesting single-pull-first, bulk-pull-later is an acceptable sequencing.
- **Offline income is real but deliberately short and upgrade-gated.** Forge Master's base 4-hour offline cap (extendable to 20h via a tech investment) at ~1 coin/sec + 1 hammer/min is the only fully-numbered example found; the "short base cap, upgradeable ceiling" shape is the one concrete pattern to borrow.
- **Salvage is folded into leveling, not a separate system.** Forge Master merges duplicate gear/pets to raise rank; Epic Stickman auto-converts duplicates of a level-100 item into an equal-or-higher-rarity item. Neither exposes a distinct "shred for salvage currency" screen in the sources found.
- **Energy gating tracks how run-shaped the core loop is.** Dicero (discrete roguelite runs) hard-gates at "6 runs, then 50-minute regen"; Epic Stickman (continuous idle battler) advertises fighting "even while offline" with no located stamina wall. Mage Master's wave-advancing auto-battler is closer to the Epic Stickman shape, which argues against a hard per-run energy gate on the core battle loop itself.
- **HUD/visual-feedback specifics are the weakest-evidenced category across all three** — no source broke down HP-bar placement, gear-slot icons, damage-number style, or summon-reveal ceremony. Close this gap with direct gameplay capture of each app, not further desk research.


# Design Reference Research — Capybara Go, Cell Survivor, Kingdom Rush

## Capybara Go (Habby, 2024)

**1. Core loop pacing.** Story mode runs through chapters of roughly 60 waves called "days" (some chapters run shorter). Each story-mode attempt costs 5 Stamina. Separately, Energy is spent to start a chapter run or do a "travel sweep" for loot, regenerating 1 point every few minutes when not full. Building/district timers scale by region and cap at 10 hours from the Northlands region onward. Sources: https://theriagames.com/guide/capybara-go-beginners-guide/ , https://theriagames.com/guide/capybara-go-tips-and-tricks/

**2. Gacha/summon odds.** Pet summoning uses a leveled odds table that improves as the "summon level" is raised through investment. At summon level 4: 50% Common, 33% Great, 15% Rare, 2% Epic (no Legendary yet). Legendary odds appear at higher levels and climb: 1% at level 6, 2.4% at level 8, 4% at level 10, 7.2% at level 14 — and Legendary pets cannot drop at all until 1,570 total cumulative summons. Separately, the Limited Treasure Chest has a pity meter: 180 pulls guarantees an S-Epic. A 10x summon costs the same as 9 single pulls (1 free). Sources: https://theriagames.com/guide/capybara-go-pet/ , https://www.pocketgamer.com/capybara-go/guide/

**3. Currencies.** Five tracked currencies: Gems (premium), Energy, Coins, Keys, Stamina. Coins are earned mainly through guild participation and routine/daily activities; Gems buy refills, summons, and timer skips. Energy faucets: 10 free daily via a daily pack, 15 from ads (2x/day), 15 purchasable with Gems (4x/day). Idle/travel collection has a capacity that maxes out, and both the cap and the collection duration are upgradeable — confirming an offline-income model with a hard cap, but exact cap numbers: not found. Sources: https://capybara-go.game-vault.net/wiki/Currency_and_Items , https://theriagames.com/guide/capybara-go-beginners-guide/

**4. HUD layout.** Not found in enough detail to describe exact screen positions — available guides cover strategy, not layout. Confirmed only: the interface surfaces a 10x-summon button priced at 9 pulls, and gear screens show equipped-slot icons with stat text (e.g. "+10% Max HP"). Source: https://www.pocketgamer.com/capybara-go/guide/

**5. Selling moments.** Not found — no source reviewed described hit feedback (flash/knockback/shake), death animation, or pull-reveal ceremony (glow-by-rarity, card flip). Indirectly confirmed: damage is computed from a formula (Attack × Damage Coefficient × Modifiers × Crit × Global Damage × Final Damage) split into Basic Attack vs. Skill Damage, implying on-screen damage numbers exist, but their visual style is undocumented in sources checked. Source: https://meowdb.com/db/capybara-go/damage-attributes-explained

**6. Equipment model.** Six slots per capybara: Weapon (1), Wear/armor (1), Rings (2), Accessories (2). No class restrictions found — gear choice is driven by build archetype (basic-attack, rage-skill, crowd-control, tank) rather than a locked class. Merge-rarity ladder: Normal → Fine → Rare → Epic → Legendary → Mythic (Immortal/Transcendent/Peerless exist as further gem-specific tiers). "Forging" consumes an identical duplicate, or a same-type-and-rarity item, as fodder to raise rarity. Downgrading is allowed up to Mythic and refunds all invested resources. Sources: https://www.allclash.com/best-gear-in-capybara-go/ , https://theriagames.com/guide/capybara-go-equipment/

## Cell Survivor

**1. Core loop pacing.** Exact run length and end-condition: not found in any source checked (guides cover progression systems, not moment-to-moment run duration). The loop is chapter/wave-based: clear waves, face a boss at the end of a chapter, and "Sweep" (auto-clear) previously-cleared chapters for rewards without replaying. Source: https://thewhyofplay.com/2026/04/19/cell-survivor-a-product-and-design-analysis/

**2. Gacha/summon odds.** Weapon rarity ladder: Green (Common) → Blue (Uncommon) → Purple (Rare) → Yellow (Legendary), with a rarer "Red" tier referenced above Yellow. A 10-pull costs 3000 Gems and is the favored pull size because it "clears pity-style mechanics faster" and improves Red-weapon odds versus single pulls; community guides reference a 100-pull pity timer guaranteeing a Red Weapon Essence of choice. Exact percentage odds per tier: not found — unlike Capybara Go's community-reconstructed table, no numeric odds table turned up for Cell Survivor. Sources: https://finalboss.io/cell-survivor-how-to-progress-fast-early-upgrades , https://grindnstrat.com/cell-survivor-guide/ , https://www.pocketgamer.com/cell-survivor/guide/

**3. Currencies.** Coins/Gold: earned from chests, dungeons (e.g. a "Golden Pig" dungeon), and sweep rewards; spent on permanent stat upgrades (Attack, Crit, Cooldown). Gems/Diamonds: premium currency for weapon-gacha pulls and shop offers; earned via daily tasks, sweep rewards, instances, and events. Stamina: passive regen rate not found; an ad restores 15 stamina, up to 5 times/day; Gems can also buy refills but guides advise against it. Offline income rules/caps: not found. Sources: https://grindnstrat.com/cell-survivor-guide/ , https://thewhyofplay.com/2026/04/19/cell-survivor-a-product-and-design-analysis/

**4. HUD layout.** Not found — no source described on-screen element placement.

**5. Selling moments.** Not found — no hit feedback, death animation, or pull-reveal presentation details turned up in the guides/review checked.

**6. Equipment model.** One design-analysis source explicitly calls it "unsophisticated compared to a typical 4-5 slot gear system" — deliberately shallow by design. Progression instead runs through four parallel vectors: Character upgrades (stat points from Coins), Weapon upgrades (which also unlock additional in-run chest choices), Artifacts (passive stat + set bonuses, monetized via their own gacha), and Skins (gameplay-modifying cosmetics). Slot count/class-restriction specifics: not found. Source: https://thewhyofplay.com/2026/04/19/cell-survivor-a-product-and-design-analysis/

## Kingdom Rush (Ironhide) — art style only

Primary source for most claims: Ironhide's community-forum art-style thread, where lead artist/co-founder Gonzalo Sande discusses technique directly: https://forums.ironhidegames.com/viewtopic.php?f=5&t=158

- **Shading:** No gradients anywhere. Volume is simulated with flat "three or more tones of the same color" (example given: tree foliage) — a limited-step cel-shaded look, not smooth blends.
- **Color/palette:** No pure black is used anywhere. Colors are "slightly muted, with a touch of grey in the gamma" — desaturated and warmed-down rather than saturated cartoon primaries.
- **Tooling/line:** All artwork and animation were produced in Flash, shaping a vector, flat-color-fill workflow (consistent with hard, clean outlines rather than painterly brushwork). An explicit stated outline-color/weight rule: not found.
- **Composition approach:** Each stage/scene is built around one central, readable concept or memorable archetype, often referenced from books and movies, rather than undirected detail-filling.
- **Readability priority:** Sande states the team's explicit focus is making visuals "distinctive and readable" — implying silhouette/color contrast is prioritized over render fidelity. A specific enemy-silhouette technique (e.g. dark-value grouping): not found as an explicit stated rule.
- **Camera angle, exact head-to-body proportions, ground/background treatment, UI panel material rules (wood/stone/gold trim), and few-frame animation technique (squash/stretch, bobbing):** not found in a citable source within the search performed. Wikipedia and press coverage praise the "cartoony," "lighthearted" art style and its functional clarity for tower-upgrade UI (https://en.wikipedia.org/wiki/Kingdom_Rush) but do not specify these mechanics — treat as an open gap, not an assumption.

## Art rules for Mage Master (derived from confirmed Kingdom Rush facts)

1. Ban gradients on all game-world art (units, terrain, props); render every surface in 3+ flat, hard-edged tone steps per color to get volume without airbrushing — Ironhide's own stated rule.
2. Never use pure black (#000000) for outlines, shadows, or shading steps; use a dark, desaturated near-black tinted warm or cool to match the local hue.
3. Desaturate the base palette roughly 10-20% below cartoon-primary saturation and push slight grey into the gamma, to read as "storybook" rather than neon-mobile-game.
4. Design one clear silhouette-defining shape per mage class and per enemy type (robe/staff profile, hood shape, weapon silhouette) before adding surface detail, so units are identifiable at battle-scale, not just in close-up.
5. Build each enemy wave around one memorable creature concept rather than palette-swapped recolors, so the advancing horde stays visually legible wave over wave.
6. Keep UI/HUD chrome (Rift portal frame, gacha buttons, currency counters) in a distinct "worked material" language (stone/wood/metal trim) separate from the flat-toon character rendering, matching Kingdom Rush's decorative-but-separate UI role.
7. Keep the render pipeline flat-fill/vector-style (a modern equivalent of Ironhide's Flash workflow) rather than painted textures, so hand-authored or AI-generated frames stay consistent across many enemy/gear variants.
8. Reserve full saturation and brightness spikes for rarity-tier gear glow and gacha pull-reveal effects only — since the base world is deliberately muted, high-chroma flashes for Epic/Legendary/Mythic reveals will read as far more premium by contrast.
9. Treat "readable and distinctive at actual play size" as the pass/fail art-direction test for every asset (unit, gear icon, VFX) before polish passes, per Sande's stated priority — reject anything that doesn't read correctly at battle-scale/thumbnail size.
10. Do not assume Kingdom Rush's exact camera angle, head-to-body ratio, or animation-frame-count technique from memory — those were not confirmed by any source in this research pass; commission a small proportion/perspective test sheet benchmarked against real Kingdom Rush screenshots before locking Mage Master's model sheet.


## Decisions taken for the MVP from this research

1. **Odds are shown in-game, always** (Capybara Go / Epic Stickman both hide or bury odds; the design doc mandates visible odds, and it is a differentiator). The Rift page shows the full 10-rarity table for the current tier and the next tier.
2. **Rift tier reshapes the whole distribution** (Capybara Go's level-4 vs level-14 pet odds: rare tiers climb from 1% to 7%, lowest tiers drop off). Seven tiers, lowest ages fall to 0% by tier 4, Ultimate appears only at tier 6.
3. **Energy is a soft throttle** (Dicero's 6-runs-then-50-minutes wall is the pattern players complain about). Cap 10, regen 1/60s, so a 30-minute session never blocks.
4. **Offline income is a rate with a cap** (Forge Master: ~4h base cap). 8h cap per the design doc, rate keyed to the highest cleared level.
5. **Salvage is instant gold, no merging** (Forge Master and Epic Stickman both merge duplicates; the design doc explicitly forbids fusing). Discard value doubles per rarity age so late pulls fund Rift upgrades.
6. **Hit feedback is the evidence gap**: no source documented it, so it is judged on-device against Kingdom Rush motion rules (anticipation, overshoot, flash, pop), not against the reference games.
7. **Art rules adopted**: no gradients, 2–3 flat tone steps, no pure black, dark-brown outline, one silhouette per unit type, full saturation reserved for element VFX and rarity reveals.
