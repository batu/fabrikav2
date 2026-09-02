# Mage Master - design brief

Game id: `mage_master`

## What it is

A fully idle auto-battler RPG. You never touch the fight: three fixed mages
(Bastion the tank, Ember the warrior, Sage the support) auto-clear stages of
enemies advancing from the top of the screen. Every decision happens between
runs: what to summon from the Rift, what to equip, what to melt for gold, and
how far to upgrade the Rift. Gear is the build; the meta is the game.

## Feel

Kingdom Rush warmth: chunky chibi units, thick dark outlines, flat cel shading,
warm sand and dark wood, gold trim. Hits have anticipation and overshoot, deaths
squash and pop, stage clears sweep the party forward with the camera. Pulls are
a small ceremony whose glow scales with rarity.

## Constraints

- Portrait mobile, iPhone first. Device captures are the acceptance evidence.
- No ads, no IAP in the MVP; Gems trickle from first-time level clears.
- Art model: one static PNG per unit or icon; motion is code. Mage appearance
  is a composite of body + tinted garment (armor rarity) + element staff.
- Ten rarity ages, four elements with their statuses, melee/ranged and
  single/area patterns must all be visible in play.
- All tunables live in `content/`; balance changes are data edits.
