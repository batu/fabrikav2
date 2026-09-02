# Recorded playthrough (2026-09-02, 17:13–17:18 device clock)

A scripted 4 min 23 s session on the iPhone (dev build served live so the drive
could act), captured two ways:

- `walkthrough.mp4` — 262 s, 263 device screenshots at ~1 fps over the tunnel,
  assembled at 4 fps playback with 1 s per frame. Covers home, settings, mages,
  Play, battle stages 1–4 with pause/resume and 2×, the result card, the Rift
  (summon, use, summon, discard, upgrade, gem skip), the mages page and item
  detail, a level-6 boss wave, and the offline-return grant.
- `burst-*.mp4` — 15 fps canvas bursts (40 frames each) for battle motion:
  `burst-battle-l1-s1` (opening fight, lunges, hits, stage clear),
  `burst-boss-l6` and `burst-boss-l6-b` (alpha-wolf boss, crits, ice projectiles,
  hit flashes, heals).
- `sheet-01.png … sheet-22.png` and `burst-*.png` — the frame sheets used for the
  review (12 frames each, labeled with elapsed seconds).
- `timeline.txt` — the action script with timestamps.

## Review verdicts

1. Home → settings → mages → home: correct, no layout faults. A stray
   "Rift reached tier 1" toast fired on the fresh save: the tier-change toast
   compared against the previous save's tier. Fixed (increase only).
2. Play → level 1: spawns at the top, melee mages advance, Sage holds the camp,
   damage numbers, heal, stage-clear banner, party sweep with camera follow.
   Pause card and buttons skinned; one transient unskinned frame at first open
   because the panel SVG had not loaded yet. Fixed (chrome preloaded at boot).
3. 2× toggle highlights and speeds the fight; boss wave banner at stage 4.
4. Rift: summon shows the portal flare and a disabled button for ~0.5 s before
   the reveal (the summoning beat is visible on device now); Use equips with a
   toast; Discard pays gold with a toast; Upgrade shows "Upgrading · 30s" and a
   gem skip; skip advances to tier 2 and the odds table shifts. "Skip for 1 gems"
   grammar fixed.
5. Mages page reflects the new uncommon weapon; item detail modal opens and closes.
6. Level-6 boss (alpha wolf): Bastion tanks (1060 → 315 HP), crits, ice
   projectiles, hit flashes rate-limited, heals from the Sage.
7. Offline return: 3 h backdate → "Welcome" grant +735 gold +54 crystals, Claim.
   The reload showed white then black frames; that is the dev-server page
   reload, not the bundle, but the root now carries a dark background so a boot
   can never flash white.

## Not shown in the recording

- Gem **purchase** (design doc §10 lists "purchased" as a Gem faucet). Not built;
  see `docs/requirements-audit.md` #25.
- Audio (inaudible in captures).
