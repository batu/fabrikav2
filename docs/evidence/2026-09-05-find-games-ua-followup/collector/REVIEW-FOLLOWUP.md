# Collector review-fix handoff

Status: complete. Behavior changed: yes. Applied findings #1–#4; skipped/deferred: none.
Existing review consumed; no repeat review. Parent owns packaging, commits, push and PR.

## Canonical files modified

- `/Users/base/.hermes/scripts/find-games-daily-scorecard.mjs`
- `/Users/base/.hermes/scripts/find-games-daily-scorecard.test.mjs`

The adjacent existing offline VM suite was inspected and reused. Three regression tests
were added; the missing-paid-dimensions test was strengthened. The VM clock is fixed
at `2026-09-05T12:00:00Z`. All tests use synthetic report responses and real parsing and
aggregation; the collector main entrypoint is excluded. No no-test exceptions.

## Tests-first evidence

Every finding was implemented as its own RED → production edit → full-suite GREEN slice.

1. Organic blank/whitespace version provenance: RED `complete` versus `incomplete`;
   GREEN 10/10. Blank alone and mixed known rows retain diagnostic counts and make all
   organic aggregates null.
2. Future paid install: RED plus-one-second timestamp produced 1 versus 0;
   GREEN 11/11. Equality to observedAt accepted; one second later and tomorrow excluded.
3. Strict install timestamp: RED date-only timestamp produced `complete` versus
   `incomplete`; GREEN 12/12. Date-only, missing seconds, impossible dates, invalid clock
   and offset components, and padded timestamps are unknown/null. Valid space-separated
   UTC, ISO UTC/fractional, and explicit-offset full timestamps remain accepted.
4. Whitespace required dimensions: RED blank app ID yielded partial 1 versus null;
   GREEN 12/12. Empty, spaces and tab are covered for all five dimensions, including
   media source. Padded nonblank app/version/campaign identifiers are not repaired.

Raw logs are `red-review-{1,2,3,4}.log` and `green-review-{1,2,3,4}.log` beside this file.
Each RED exited 1 with an assertion mismatch, not a harness error. Each GREEN exited 0.

Final command:

```sh
/Users/base/.local/bin/node --test /Users/base/.hermes/scripts/find-games-daily-scorecard.test.mjs
```

Actual result: 12 tests, 12 passed, 0 failed (`green-final.log`). The copied adjacent
source/test pair also passed 12/12 (`green-portable.log`). `node --check` passed on both
canonical files. `patch-verification.log` records successful baseline patch application,
exact byte comparison against canonical source, copy equality and SHA-256 hashes.

## Refreshed evidence files

In `/Users/base/store-review/find-games/analytics/collector-fix-2026-09-05/`:

- `collector.patch`: full source delta relative to the original untouched baseline,
  not merely relative to the reviewed intermediate version.
- `find-games-daily-scorecard.mjs`, `find-games-daily-scorecard.test.mjs`: portable copies.
- `README.md`, this handoff, `patch-verification.log`, `green-final.log`.
- New `red-review-1.log` through `red-review-4.log`, `green-review-1.log` through
  `green-review-4.log`, and `green-portable.log`.

Baseline SHA-256: `cd196a027a0d2287be06322e36229952da157f54dde494ad0b1c0567bd66d3f9`
Canonical SHA-256: `af042800b65ee9f7f4330d167793d9fa1d1b37de47eb14b7d62b15e8f008599c`
Tests SHA-256: `0ba90b3f71517efafc4e60c3ff5ea8bddb75440a056ee22fd7d1305d7a2d7f10`

## Boundaries and issues

No blockers or residual findings. No commit, push, collector main invocation, cron or
wrapper edits, provider/browser/device calls, publication or live analytics validation.
Canonical script was updated in place; an existing scheduled invocation can pick up the
new bytes. Cohorts remain unset, version policy unchanged, and no public T0 selected.
