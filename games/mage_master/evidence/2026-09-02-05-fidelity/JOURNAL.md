# Fidelity pass (2026-09-02, 17:22–18:50) — quality bar raised to a finished vertical slice

Trigger: Batu's review at 17:22 ("the menu looks incredibly bad… is this a polished
mobile game?"). Reference bar: Kingdom Rush plus our own Find the Bird / Marble
Run store pages (title lettering, framed panels, painted scenes, lettered result
cards). The shell_template asset specs were the generation checklist that had
been skipped.

## Art added (codex image tool, all first-shot)

- Title lettering "Mage Master"; lettering for Victory, Defeat, Summoned, Welcome Back.
- Painted scenes: home camp (hero band behind the geared party), rift cave (behind the portal).
- Ornate 9-slice frames: wood panel, gold button, dark button, round portrait ring.
- Nine arena props (sand / forest / swamp trios) and three painted ground plates.
- Mages nav icon (wizard hat). App icon and launch splash composed from the title art.

## Layout rebuilt

Home = framed top bar → title lettering → painted camp with the party →
framed climbing map (current level at the bottom, next two above, camp props on
the flanks) → gold Play plate → framed nav. Rift = framed portal scene, copy and
Summon on wood, framed upgrade and odds panels with Now/Next columns. Mages =
framed cards with portrait rings. Battle = framed strip with dark-plate speed
and pause, painted ground filling the host edge to edge, props on both flanks,
inset stage track, framed HUD cards with HP color by health.

## pixelsmith judge trajectory (multi-model consensus, `judge-*.json`)

| Screen | Rounds | Result |
| --- | --- | --- |
| Home | 14 | pass from round 12 on; remaining majors are the Play-to-nav gap and a sparse map board |
| Rift | 4 | pass; remaining: odds panel cut at the fold (page scrolls), chip widths |
| Mages | 1 | pass |
| Battle | 8 | pass at round 6, fail on the last two for composition items: brown ledge band, mages read smaller than goblins (raised to 1.18×), props vs track collisions (fixed), spawn pop caught mid-scale (fixed) |

Judge captures that were invalid (mid-reload over Wi-Fi, or the drive helper
ignoring a second command in the same second) are kept for the record:
fid-13, fid-16, fid-22, fid-23/24, fid-39.

## Captures

fid-05 … fid-43 (home, rift, mages, battle, pause, defeat, reveal). Frame bursts
in `.work/frames/` were used for motion checks but not archived here.
