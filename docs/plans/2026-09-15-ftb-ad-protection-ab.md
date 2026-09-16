# FTB early automatic-ad protection experiment

## Agreed behavior

New installs are assigned 50/50, persistently and independently of level-set cohorts,
to `ftb_ad_protection_v1`: `protected` or `from_start`. Existing installs are excluded.
Protected players see no automatic ads for the entire first cold-launch session,
even past level 10, or while playing levels 1–10 on later launches. Background/resume
does not end that session. The transition into level 11 may show an interstitial
on a later launch if the ordinary cadence permits it.

From-start players may see banners on level 1. Interstitials still obey the common
every-3-completions/120-second settings; there is no launch interstitial. Existing
banner occlusion exclusions, no-ads purchases, and user settings remain common.
Optional rewarded hints and double coins remain available in both arms.

Assignment is fixed before the runtime imports providers. Failed persistence and
corrupt records suppress automatic ads and are excluded from experiment analytics.
All SDK analytics carry `ad_experiment_id` and `ad_experiment_variant`; the exposure
event is emitted once per cold launch. Analyze unique assigned installs, not exposure
event counts. Compare D1/D7 retention, level progression, and cumulative ad revenue
per assigned install, including zero-revenue users, on the same observation window.

## Execution checklist

- [x] Isolate Bird scope; restore the temporary disk guard exception.
- [x] Implement sticky assignment and automatic-ad gating; preserve rewarded ads.
- [ ] Verify analytics contract, policy tests, typecheck, and review.
- [ ] Build/install/drive both arms on the physical iPhone; inspect evidence.
- [ ] Verify release and provider event delivery before calling the experiment live.

## Activation boundary

This implementation enrolls new installs of the new build. No live Remote Config
or store release was changed. Existing published binaries cannot run this policy.
There is no dedicated remote experiment switch in this revision; changing enrollment
requires a new build. Do not represent source implementation as a running experiment.
