# Deferred problems (noted 2026-07-16, handle after phase two)

- fabrikav2 `find_the_dog` still carries the old/broken shop art — needs the
  same aa1ad9ca8 shipped-set port that shell_template got.
- fabrika v1 merge `b252f422d` stubbed the `paywallImpression` analytics call
  (main lacks the event); restore when the event lands on v1 main.
- verify-device `fail` tour marker is blind every run (capture content is
  correct — Out of Lives overlay) — marker-timing bug in the runner.
- verify-device tour manifest lacks `shop` and `home` states; add them.
- No reference set ratified for shell_template → panel verdict is always
  NO-APPLICABLE-EVIDENCE [EXPLORATORY]; ratify App Store stills / accepted
  captures into `refs/`.
- FTD's `TestHarness.startLevel` has the same scene-transition-cover race the
  template fixed (wait + retry) — port the fix back.
- Step-1 PR for `shell-template-step1` not yet opened.
- AppLovin test ads not wired in the regenerated iOS shell — needs a
  native-resources recipe.
- Fail screen restyle to win-card structure rides with GENERATION-LIST #7
  ("Out of Lives" title art).
- verify-device pause==level indistinguishable-capture anomaly (2026-07-16 run): pause overlay may not have engaged during the tour; investigate marker/overlay timing.
