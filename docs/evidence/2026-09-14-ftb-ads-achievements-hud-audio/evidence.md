---
status: partial
subject: Find the Bird ads, achievements, streak HUD, and pickup audio
created: 2026-09-14
mode: pipeline
---

# Evidence: Find the Bird non-artwork fixes

## Verdict

Local regressions pass and initial physical audio observations support the new
selection behavior; final native acceptance is incomplete while phone work is paused.

## What Changed

- Pickup sounds consume a shuffled bag, avoid boundary repeats, and draw an
  independent playback rate in 0.8–1.2 for every playback.
- Failed sample loads preserve available sounds; an entirely failed load can retry.
- The streak claim dot overrides the count label's inherited minimum width.
- Achievement claims reveal the next earned tier in place; body scrolling does
  not dismiss the achievements page.

## Evidence Captured

- Full unit suite: 502 passed, 3 skipped, 79 files; typecheck and lint passed.
- New audio regressions: five failures before correction, all six passing after.
- New achievement regressions: both failed before correction and pass afterward.
- Follow-up deferred-animation coverage: overlapping claims settle out of order
  without replacing another pending ladder, including after closing/reopening.
  All 13 collection UI tests pass; typecheck and lint pass. No production source
  changed during this follow-up.
- Physical pickup observations and master-output recording are linked in
  [the execution record](README.md#partial-physical-audio-evidence).

## Reviewer Assessments

Reuse review found no changes needed. Quality and efficiency reviews led to one
shared category renderer. Correctness/adversarial review found no concrete code
defect and correctly withheld readiness for missing physical evidence. Final
interaction, motion, and gameplay evidence reviews have not run.

## Analysis

The inspected physical trace covers 19 pickups within one level: the first ten
samples are unique, the observed refill boundary does not repeat, and all rates
are in range. This does not establish cross-level continuity or audible speaker
output. The achievement regressions establish specific presentation defects;
they do not identify the cause of the reported stutter. Existing first-session
ad gating is retained pending native validation.

## Gaps

- Fresh-session ads, resume, next launch, optional rewarded behavior, and the
  three reported banner observations need physical assessment.
- Streak geometry and achievement motion need before/after device evidence.
- Cross-level audio, listening acceptance, and device mute/ad resume remain open.
- The original private save backup must be restored and verified after testing.
- Final installed-build identity and evidence review remain pending; no release,
  publication, PR, or merge has occurred.

## Next Action

The user explicitly requested merging to main before completing device testing
on 2026-09-14. This changes the landing order, not the partial verification status.
When phone testing resumes, capture baseline streak geometry before installing
the final native candidate. Restore the original save before device handover.
