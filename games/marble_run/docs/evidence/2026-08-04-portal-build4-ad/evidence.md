---
status: passed
subject: Portal release 2026.08.04-1 with visible AppLovin test interstitial
created: 2026-08-04
mode: interactive
---

# Evidence: Portal build 2026.08.04-1 ad capture

## Verdict

Portal release `2026.08.04-1` is publicly available with the signed iOS 1.0 (4) artifact, production browser preview, factual changelog, and a playable 38.32-second native simulator video that visibly shows an AppLovin MAX test interstitial.

## What Changed

- Disabled rewarded retry by default through Remote Config.
- Added failure interstitial eligibility from level 10 with a 90-second cooldown.
- Published the signed iOS artifact and production browser bundle from source commit `2db9b439`.

## Evidence Captured

| Type | Artifact / Command | Result |
|------|--------------------|--------|
| public release | `https://portal.basegamelab.com/games/marble-run#build-2026.08.04-1` | Latest release rendered with changelog, Device Lab, video, and download. |
| hosted video | `/games/marble-run/builds/2026.08.04-1/public-video` | Playable H.264 video, 38.32 seconds; rendered frame visibly says “You're seeing a test ad.” |
| video integrity | Local and hosted SHA-256 `b08b5a9af55c918b02339ca2df9440099ce8ac3f175584410f407a6dba8092ac` | Exact match. |
| artifact integrity | Local and hosted SHA-256 `f3c535703c283597fb885bf40fac6e82e89e205f77d237396d199016a7bd7033` | Exact match. |
| browser preview | `/games/marble-run/builds/2026.08.04-1/play/` | Entry page and build-scoped assets returned successfully. |

## Reviewer Assessments

| Reviewer | Status | Result |
|----------|--------|--------|
| ce-game-feel-reviewer | passed | The first six seconds clearly show the MAX test interstitial; native simulator framing and the Portal player's 0:38 duration are visible. Live URL readback separately confirms publication. |

## Gaps

- None.

## Next Action

None.
