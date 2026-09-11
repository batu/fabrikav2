# Combat math follows the workbook (v0.2)

**Decided:** 2026-09-11. **Source of truth:** `refs/balance/mage-masters-combat-math.xlsx`
(Version 0.2, 2026-09-07). **Code:** `content/combat.ts` holds the constants and
closed-form calculator; `src/game/sim/battle.ts` resolves every swing with them;
`tests/unit/combat-math.test.ts` pins the workbook's worked example and scenarios
and checks the sim's measured average swing against the formula.

## What the workbook fixes

- No Defense / Armor stat. Survivability is Health, Dodge, Block, Health Regeneration.
- Crit, Dodge, Block are raw **rating** points on gear. Chance = min(cap, R / (R + 100));
  caps 75% / 60% / 75%. One softness constant, no level or stage scaling.
- One swing: Attack Power → crit roll (× Crit Damage) → block roll (× 0.5) → dodge roll (zero).
- Every weapon has one element and its own **Elemental Damage** stat. Burn = Elem × 0.1 × stacks
  (max 3); Chill slow = min(0.5, Elem/100 × 0.2); Chain = Elem × 0.5 to 1 nearby enemy;
  Expose = min(0.6, Elem/100 × 0.15) extra damage from all sources.
- Rarity: ceiling multiplier 1.6^(age−1); substats min(5, floor(age/2)); every stat rolls
  in 75%–100% of its ceiling.

## Choices the workbook leaves open (ours, change freely)

- Status durations: burn 3 s, chill 2.5 s, expose 3 s; chain radius 90 world units.
- Weapon Elemental Damage ceiling at Common: 100 (the workbook's scenario value; keeps the
  starter elements at roughly their previous strength).
- Class and enemy bases keep the chances they had: percent stats were converted to ratings
  with R = 100 × c / (1 − c), and each unit's old DEF mitigation was folded into its Health.
- Substat pool values are ceilings at Common. Ratings, flat HP/ATK/regen scale with rarity;
  Attack Speed, Crit Damage and Move Speed stay flat across ages.
- Saves written before this (version 1) re-roll their stored items at the same slot, class,
  rarity and weapon traits under the new model; progress and currencies are untouched.

## What this rules out

- Re-adding armor or any flat mitigation stat.
- Storing crit/dodge/block as percentages on gear.
- Per-level or per-stage scaling of ratings or of the softness constant.
