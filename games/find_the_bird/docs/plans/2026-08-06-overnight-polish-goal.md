# Overnight polish pass — 2026-08-06 (build 18 device review)

Source: Batu's on-device review of TestFlight build 18. Goal: implement and
test everything below overnight; morning deliverable is build 19 on
TestFlight + a Telegram report with per-item evidence (screenshots/sheets),
each item marked done / partial / blocked-with-reason.

## Honesty constraints for the night

- The phone is with Batu: device captures are impossible until morning.
  UI items are DOM/CSS — iterate with pixelsmith against the SIMULATOR and
  mark every visual as "sim-verified, device-pending". No item may be
  called done on build-exit-codes alone.
- Anything touching level data re-runs the smallest-sprites audit + the
  affected-level eval before approve.

## A. Menu / UI polish (pixelsmith lane, sim captures)

A1. Play Now button + saga column: shift down a few px; arrangement closer
    to the bottom sides ("nice", judged visually, pixelsmith loop).
A2. Streak div in menu: same size as the sibling divs.
A3. Achievements + Settings menu buttons: a few px toward the middle.
A4. No-Ads premium icon: newly GENERATED icon in the FTD icon style
    (reference: FTD's no-ads icon; one image-gen call + crop/clean).
A5. Settings "50 hints" pill: weirdly cropped — fix layout.
A10. Toast: font + design fit the game.
A11. Toast container: wider / restyled — currently overlaps background
     content and looks broken.
A15. Win confetti particles must render IN FRONT of the finale menu
     (z-order/layer fix).

## B. Content

B6. Achievements text says "dog"; rewrite the WHOLE achievement set for the
    bird game reality (hundreds of birds, 53+ levels, streaks, hints) —
    names, descriptions, thresholds. Keep ids stable where progress
    persistence depends on them; document any id that must migrate.

## C. Gameplay / runtime

C7. Tutorial is pre-square-era: it focuses an empty spot and requires
    scrolling. Rebuild the opening beat: pick a bird VISIBLE in the initial
    viewport (or pan the camera to one first), then run the tap prompt.
C8. Hint visual: much more visible (stronger ring/pulse/contrast).
C9. Tutorial's hint step must actually trigger a real hint.
C9b. When the hinted bird is off-screen, show a left/right edge arrow
     pointing toward it (pan affordance).
C12. Wrong-tap "mistake" X markers: screen-space (absolute), must not pan
     with the camera.

## D. Level data

D13. Greenhouse-era level (order index ~3-4): padded/cleanup areas too
     small — inspect, enlarge cleanup padding for the flagged level(s),
     re-export, verify pickup-preview seams.
D16. **Close-pair hitbox centers (the real fix).** Runtime floor shipped in
     18 but centers are off: recentre's local-diff snap merges close pairs
     into one component and drags both centers toward the midpoint.
     Fix direction: when a hitbox's nearest neighbor is < ~2.2r, do NOT
     diff-snap it — keep the VLM detection center (per-bird by
     construction), or split the merged component by per-detection
     assignment. Add golden cases from the known close-pair levels
     (cotswolds 7px, glade 18px, waikiki 28px) and score before/after.
     Re-export affected levels.
D17. **Verify build 18 shipped the intended levels**: unzip the archived
     FTB18 IPA, diff its bundled level.json + sprites against the verified
     catalog; check the live CDN manifest revision matches. Record the
     verdict — if 18 was stale, 19 must fix the packaging hole too.

## E. Ship

E1. All green → build 19 → TestFlight → VALID poll → Telegram morning
    report (per-item status + evidence images + what stayed unverified
    without the device).

## Working agreements (from today's scar tissue)

- No `2>/dev/null` in drivers; every stage `&&`-gated; pipefail.
- Provider batches watch degradedToFreeChain and halt.
- Track record: docs/plans/2026-08-06-overnight-polish-RECORD.md, updated
  as items land — what worked, what didn't, why.
