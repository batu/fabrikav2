# Cats & Soup (Hidea/NEOWIZ) — Design Reference

Source pages archived locally: cats_wiki.txt, facilities_wiki.txt, facilities2_wiki.txt, accessories_wiki.txt, currencies_wiki.txt.

## 1. Cat collection screen
- Cats are collected as breeds (60 permanent breeds as of Apr 2026, plus rotating event-limited breeds); no explicit "silhouette/locked" grid confirmed — new breeds come via the Observatory or Kitty Trip facilities. Unverified: whether an undiscovered-breed grid with silhouettes exists. [Cats](https://cats-soup.fandom.com/wiki/Cats)
- Each cat has Stars (1-5) and a Heart/affection level; both multiply the sell price of dishes at the facility the cat is assigned to. Star rarity is weighted (40/30/20/8/2%). [Cats#Stars_&_Heart_Level](https://cats-soup.fandom.com/wiki/Cats)
- Affection is raised only by feeding cats fish caught at the Fish Pond facility. [Cats](https://cats-soup.fandom.com/wiki/Cats)
- Cats belong to Collection groups; owning every breed in a group grants a permanent production bonus to a named facility. Some breeds are not part of any collection. [Cats](https://cats-soup.fandom.com/wiki/Cats)
- A cat's breed can be re-rolled at the Observatory (1 ticket, 100 gems, or a watched ad — 3 free ad-rerolls/day). [Cats](https://cats-soup.fandom.com/wiki/Cats)
- Tapping a cat in-scene likely opens a per-cat detail/level view (HUD widget in screenshots shows "Lv. 20001"); exact tap-target contents beyond stars/hearts/breed name/description not independently verified. Unverified in detail.

## 2. Costumes and accessories
- Equipment types: hats, clothes, accessories, and "friends" (pets) — one of each type equippable per cat, for aesthetics plus a production-rate bonus. [Equipment](https://catsandsoupgame.fandom.com/wiki/Equipment)
- Obtained from the Treasure Chest facility (watch an ad for a random item, or spend gems — 300 gems drops 3 items), event rewards, and gifts cats give the player. [Accessories](https://cats-soup.fandom.com/wiki/Accessories)
- Upgrading is additive/incremental, not stage-swap: hats/clothes/accessories each upgrade to a max of level 10, via the Treasure facility (ad watch = 1 random item +1 level, or 300 diamonds = 3 random items +1 level). Friends (pets) don't level past 1. [Accessories](https://cats-soup.fandom.com/wiki/Accessories)
- No confirmation found of a dedicated full-screen "costume closet" UI (grid of owned/locked outfits per cat) — mechanic is chest-roll + auto-equip/level, not a curated wardrobe screen. Unverified.

## 3. Facilities / stations
- Five facility classes: Cooking (Soup/Juice/Stir-Fry — core gold producers), Ingredient (feed cooking facilities, also produce gold), Rest (cats not working sit here, generate Recipe Points, max level 22,000), Function (utility buildings: Treasure Chest, Good Luck Jar, Bulletin Board, Fish Pond, Searchlight, Claw Machine, Basketball, Aquarium, Little Trunk Shop), and Special (free/gated, unlocked by gold milestones, IAP, or event rewards, e.g. Observatory, Fairy Tree, Giant Tortoise Warehouse). [Facilities](https://cats-soup.fandom.com/wiki/Facilities)
- Cooking facilities upgrade to a max level of 24,000 using gold; ingredient-facility gold funds these upgrades and new facility purchases. [Facilities](https://cats-soup.fandom.com/wiki/Facilities)
- Idle gold accumulates visually above a "gallery of bowls" at the bottom of the screen; tapping it collects it — confirmed by wiki search summary and matches the bottom dish-tray strip visible in every App Store screenshot (e.g. "13cea" gold pile + bowl row). [Facilities](https://cats-soup.fandom.com/wiki/Facilities)
- Good Luck Jar unlocks the "Jar Fairy," giving an instant hour's worth of gold by watching an ad — an on-demand boost rather than passive offline accrual. [Facilities](https://cats-soup.fandom.com/wiki/Facilities)
- Offline earnings cap: a base offline reward exists, and the "Giant Tortoise Warehouse" IAP facility extends the offline reward window by +3 hours, implying a base cap shorter than that — exact base hours not found on the wiki. Unverified exact number. [Facilities](https://cats-soup.fandom.com/wiki/Facilities)
- Gold display compresses into lettered units past 10,000 (a, b, c... each = 1000x prior) rather than raw digits. [Currencies](https://cats-soup.fandom.com/wiki/Currencies)

## 4. Main vertical scrolling scene layout
- Confirmed directly from screenshots (images/screenshot_ipad_01.png, _02.png, _04.png): the scene is a top-down painterly meadow/forest that scrolls vertically, tree-lined at the edges, with facilities placed as discrete circular "plots" on winding dirt paths, each plot showing a level-number flag/sign next to the cat working there.
- Locked-but-visible slots: unbuilt/undiscovered facility plots appear dimmed/greyed with just a level-requirement flag in the distance (visible in screenshot_ipad_04.png background), letting players see what's coming before they can afford or unlock it — consistent with Special Facilities being "unlocked at a gold/level milestone" per the wiki. [Facilities](https://cats-soup.fandom.com/wiki/Facilities)
- Bottom edge is a persistent dish-tray HUD bar (dish icons + running sell counts) plus the tappable gold pile; top edge is the currency HUD (gold, recipe points, gems, stamps) plus icon buttons (settings, event, pass, mail/pop-up). Left edge carries a player level badge + minigame/travel shortcuts; right edge carries shop/hammer(upgrade)/door(rooms)/camera icons.
- Player scrolls up the vertical map to reach newer, higher-level plots (visible "Lv. 20001" progression badge; sequential facility level flags 1/8/22 shown simultaneously mid-map).

## 5. Onboarding order
- Wiki and store material imply Cooking facilities come first (ingredients -> cooking facility -> dish -> gold loop), with Rest facilities gated behind having cats not actively cooking, and higher-tier Function/Special facilities gated by gold thresholds, specific facility unlocks, or event/IAP (e.g. "Ad Manager Office — unlocked after Bulletin Board"; "Kitty Trip — unlocked after Harvesting Oats"; "Travel Essentials Shop — unlocked after Observatory"). This is a linear unlock chain, not simultaneous systems. [Facilities — Special Facilities table](https://cats-soup.fandom.com/wiki/Facilities)
- Could not find a first-hand tutorial-step account (Pocket Gamer/TouchArcade/Deconstructor of Fun full reviews were not fetchable or didn't cover onboarding beats) — the order above is reconstructed from the "Unlocked after X" gating column in the Special Facilities table, not from a played tutorial capture. Flag: verified via wiki dependency chain, not a live playthrough.

## What to copy for a bird collection + birdhouse sanctuary
- Additive gear, not wardrobe-swap: let bird accessories level up in place (max ~10) via a gacha/ad-roll mechanic tied to a "Treasure"-style facility, instead of a full costume-closet UI.
- Idle-currency tray + single tap-to-collect pile: keep one visible growing pile (seeds/coins) at the bottom of the scene the player taps, instead of per-facility collect buttons.
- Show locked slots as dimmed plots with a level flag before they're buyable, so the vertical scroll always previews "what's next."
- Affection tied to a feeding minigame (fish -> could be seeds/bugs for birds), separate from the coin economy, for a second non-monetary care loop.
- Linear facility-unlock chain ("X unlocks after Y is built/leveled") rather than an open shop, so onboarding gates one system at a time (nest/feeder first, sanctuary decor/function buildings later).

## Images saved (images/)
- screenshot_ipad_01.png — full vertical sanctuary/meadow scene, HUD top (gold/energy/gems/stamps), bottom dish tray + tap-to-collect gold pile, right-edge shop/hammer/door icons.
- screenshot_ipad_02.png — decorated cat "mini-rooms"/furniture placement across the scrolling meadow, per-plot level flags (1, 20001, 21001...).
- screenshot_ipad_03.png — weather/event overlay (rain), wandering-animal minigame area, same persistent HUD/tray.
- screenshot_ipad_04.png — mid-map cooking-facility cluster: circular plots each with its own level flag and working cat; background shows greyed-out unbuilt plots.
- screenshot_ipad_05.png — additional scene crop (garden/beach decor area), same layout grammar.
- screenshot_iphone_04.png, screenshot_iphone_05.png — iPhone-aspect cooking-cluster views; confirm live level numbers per station (1, 8, 22, 38) with animating cats and sound-effect text ("BLURP", "THUD"), dish sell-price strip along the bottom.

All screenshots sourced from the official App Store listing: https://apps.apple.com/us/app/-/id1581431235 (Cats&Soup: Relaxing Cozy Games, developer NEOWIZ/Hidea).
