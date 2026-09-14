# Interstitial attribution follow-up — 2026-09-14

The review of PRs #77–#83 found that Next advances the saved level before
interstitial presentation. The eligibility event used the completed index but
native presentation callbacks read the advanced index. The committed Bird
`docs/evidence/2026-09-14-ftb-between-level-instrumentation/device/events-levels-1-4.json`
trace at timestamp 1789377021614 demonstrates gate index 2 and show index 3.

Both games now retain the completed index in the existing pending transition
context. Interstitial show, impression, terminal and skipped events use that
index; preload events and other formats retain current-level attribution.
The next level's first render consumes and clears the context. This follows
the existing sequencing: the interstitial promise settles before scene restart.
The implementations remain parallel with the existing per-game flow helpers.

## Validation

- Added `keeps interstitial presentation on the completed level after Next advances`
  in each game's between-level unit suite. Before the fix, Dog failed with six
  actual indices of 3 versus six expected indices of 2.
- After the fix, between-level, GameAnalytics and Firebase sink tests pass:
  Dog 70, Bird 68. Covers presentation attribution, preload independence,
  banner/rewarded independence, and context clearing.
- SDK full unit suite: 403 passed. SDK and both game typechecks passed.
- Targeted ESLint passed for the four changed files in each game.
- Independent read-only reviewer `review_funnel`: no blocking findings after
  checking native callback ordering, restart sequencing and context clearing.

No new physical-device or provider-delivery capture was performed. The earlier
IAP/Firebase device checks and clean phone installation remain outstanding.
This fix does not close those requirements. No release or provider mutation.
