# Find Games external collector correction — 2026-09-05

## Status and ownership

Canonical source is **not in Git**: `/Users/base/.hermes/scripts/find-games-daily-scorecard.mjs`.
The adjacent `find-games-daily-scorecard.sh` executes this exact file. Located through
`/Users/base/store-review/find-games/analytics/CLEAN-MEASUREMENT-BASELINE-2026-09-05.md` (Automation).
No owner repo, worktree or branch exists for this source; none was invented.

**The canonical active script was edited in place. The existing cron wrapper may pick up
these changes on its next scheduled invocation.** No cron configuration or wrapper was
changed. The collector entrypoint was not run; no provider, browser, publication,
`latest.json`, campaign, release, device or analytics-history action was performed.
No commit/push. Fabrikav2 and its workers' files were not edited.

## Corrected behavior

- Organic report failure (including 403/500) and malformed successful exports yield null
  organic aggregates and `organic_status: incomplete`, never synthetic zero.
- Paid `row_count` remains diagnostic only. Clean totals require exact own app ID,
  eligible public version, approved UTC cohort cutoff, allowed campaign ID, valid install
  timestamp and media source, and QA-window exclusion. Foreign app/version/campaign,
  pre-cutoff, organic and QA rows are excluded. Missing row dimensions make the clean
  total null/incomplete rather than summing the known subset.
- Both configured `paid_cohort` values remain null: paid totals are null/pending_cohort.
  FTB 1.2.1 remains test/prerelease; 1.0.4 remains contaminated; 1.2 and FTD 1.0.5 retain
  their existing organic version policy. No public T0 was selected or version promoted.
- Future policy requires `approved: true`, `from_utc`, `app_version`, nonempty
  `campaign_ids`, `qa_exclusions_complete: true`, and `excluded_qa_windows` with UTC
  `from`/`to`. Approval and QA completeness are **operator attestations**, not automatic
  Store/device evidence. Do not set them until Store public/exact-receipt evidence and
  Ads cohort approval exist. Version/time alone do not distinguish TestFlight.
  The cutoff cannot precede the collector's diagnostic query window; changing that
  window, if needed later, is a separately reviewed policy update.

## Evidence and reproduction

Run without credentials/network/publication:

```sh
/Users/base/.local/bin/node --test /Users/base/.hermes/scripts/find-games-daily-scorecard.test.mjs
```

Or run the copied adjacent test/source pair in this evidence directory.
Final result after review followup: **12 tests passed, 0 failed** (`green-final.log`),
also **12 passed, 0 failed** for the portable copies (`green-portable.log`). Canonical `node --check`
passed. No pre-existing local collector tests were found. Tests exercise real canonical
parser/aggregation functions in a VM with synthetic HTTP bodies; they deliberately
exclude the provider/browser/write entrypoint. Live provider schema/receipts and cron
execution are not verified by this run.

RED/GREEN logs preserve each behavioral slice: organic failure (0 versus null), paid
filtering (8 versus 1), invalid cohort acceptance (1 versus null), malformed export
(0 versus null), explicit unset policy (undefined versus null), incomplete paid header
(0 versus null). Additional final tests cover genuine successful empty exports, retained
organic quarantine, partial unknown paid dimensions, and unavailable paid reports.

- `find-games-daily-scorecard.before.mjs`: exact untouched baseline backup.
- `collector.patch`: unified canonical-source patch, paths relative to `.hermes/scripts`.
- `find-games-daily-scorecard.mjs`: post-fix review snapshot, not a second authority.
- `find-games-daily-scorecard.test.mjs`: portable offline test suite.
- `patch-verification.log`: patch applies to baseline and reproduces canonical bytes.

SHA-256 baseline: `cd196a027a0d2287be06322e36229952da157f54dde494ad0b1c0567bd66d3f9`
SHA-256 corrected: `af042800b65ee9f7f4330d167793d9fa1d1b37de47eb14b7d62b15e8f008599c`
SHA-256 tests: `0ba90b3f71517efafc4e60c3ff5ea8bddb75440a056ee22fd7d1305d7a2d7f10`

Targeted manual review checked the unified diff, preserved callers/entrypoint, existing
version policy, null propagation and accepted/excluded/unknown behavior. No live analytics
claims follow from these tests. Schema consumers must honor the new status/null values;
only the shell wrapper was found among local script callers.

## Independent review followup

Consumed the existing review, without repeating code review:
`/Users/base/.hermes/cache/delegation/subagent-summary-0-20260905_144905_841902.txt`.
All four P2 findings applied; none skipped or deferred. Each behavior was tested RED
before its production edit, then the entire offline collector suite ran GREEN.

| Finding | Observed RED | Correction and GREEN coverage |
| --- | --- | --- |
| #1 | Blank organic version reported complete instead of incomplete | Missing/whitespace version counts keep diagnostics but make every organic aggregate null; blank alone and mixed with known clean rows. |
| #2 | Observation plus one second counted 1 instead of 0 | Upper bound is observedAt, not end of day; frozen clock covers equality, plus one second, and tomorrow. |
| #3 | Date-only install reported complete instead of incomplete | Full seconds-bearing timestamp required, strict calendar/time round-trip validation; malformed/date-only values unknown/null, valid AppsFlyer space-separated, ISO and offset timestamps accepted. |
| #4 | Whitespace app dimension left partial total 1 instead of null | All required dimensions must be nonblank; whitespace media included; padded nonblank app/version/campaign identifiers remain excluded, never trimmed into eligibility. |

Logs: `red-review-1.log` through `red-review-4.log` each record the expected failing
assertion (exit 1). `green-review-1.log` through `green-review-4.log` record full-suite
results of 10, 11, 12 and 12 passes respectively (exit 0).
`REVIEW-FOLLOWUP.md` is the caller handoff. Baseline-relative `collector.patch` and both
portable files were refreshed; patch application to a temporary baseline reproduced
the canonical bytes exactly (`patch-verification.log`). The baseline is unchanged.

No collector main, live provider/browser call, cron edit, commit, push or publication
occurred during this followup. Parent owns Git packaging and shipping.
