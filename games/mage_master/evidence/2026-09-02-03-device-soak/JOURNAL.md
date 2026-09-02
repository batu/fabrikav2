# Device soak — 30 minutes of continuous play on the iPhone (2026-09-02, 14:57–15:27)

The real app on the real phone (dev build served from the Mac so the drive
channel could act), driven the way a player plays: enter the highest level,
let the battle run in real time at 1×, on a win take Next, on a loss Retry,
back at camp pull while crystals allow, equip when the item's power beats the
current one, discard otherwise, upgrade the Rift when affordable, gem-skip when
gems allow. One state poll every 5 s, a screenshot every 150 s, a device error
check every minute. Full log: `soak.log`; numbers: `SUMMARY.md`.

## Result

- 29 min 55 s continuous, 287 polls, **0 runtime errors** on the device.
- Ladder cleared to **level 9** (first clears at 0:30, 0:59, 1:34, 2:10, 2:51, 21:53, 23:26, 25:14, 27:28), 30 pulls, 12 equips up to Astral/Immortal, Rift tier 5.
- **Wall at level 6** (wolf family, alpha-wolf boss) from minute 3 to minute 22: the driver retried the same level ~20 times with the same gear instead of farming, which also produced the only energy blocks (4 short waits at 0 energy, minutes 19–20). The headless pacing bot, which farms the previous level after a loss, never waited. A human sits between the two.

## Fixes taken from the soak

1. Energy regen 60 s → 45 s (10 + 40 attempts per 30 minutes even with instant retries).
2. Per-level ramp softened: HP ×1.27 (was 1.30), ATK ×1.20 (was 1.22) per level; boss stage unchanged.
3. Defeat card now says to replay an earlier level for crystals or summon stronger gear.
4. Pacing gate re-run: still 16–17 wins / 30 min headless, starter gear still loses level 8, Astral gear still clears level 10.

## Captures

`shot-00m-start.png` … `shot-27m.png` (thirteen stills across the session; `shot-25m.png` shows epic and uncommon armor tints and an arcane staff on the party at level 9).
