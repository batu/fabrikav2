---
status: partial
subject: Marble Run App Store submission build selection
created: 2026-08-11
mode: interactive
---

# Evidence: Marble Run App Store submission build selection

## Verdict

App Store version 1.0 now selects the newest uploaded build, build 8, but the archive's exact source commit could not be independently proven because no source SHA or local archive was available.

## What Changed

- Replaced stale selected build 2 with build 8 on App Store version 1.0.
- Did not submit the review submission or change its release state.

## Evidence Captured

| Type | Artifact / Command | Result |
|------|--------------------|--------|
| source | `git fetch origin --prune` and Marble Run log on `origin/main` | latest Marble Run commit is `73cb16968`, dated 2026-08-11 01:08 +0300 |
| App Store Connect read | builds filtered to app `6793860059`, sorted by upload date | build 8 is newest; uploaded 2026-08-11 01:23:34 -0700, `VALID`, `APP_STORE_ELIGIBLE` |
| App Store Connect mutation | update version 1.0 build relationship to build 8 | succeeded |
| App Store Connect readback | version 1.0 with included build | selected build is 8; version state is `READY_FOR_REVIEW`; no legacy version submission exists |
| review submission read | review submission for app `6793860059` | `READY_FOR_REVIEW`, `submittedDate: null` |

## Reviewer Assessments

No specialist reviewer was needed for a build-selection relationship check.

## Analysis

The previously selected submission build was build 2, uploaded on 2026-08-03. Builds 7 and 8 were uploaded later, and build 8 is the newest processed build in App Store Connect. Build 8 was uploaded after the latest Marble Run commit on `origin/main`, but upload chronology is not source provenance. No matching local `.xcarchive` remained available for payload comparison, and App Store Connect does not expose an embedded Git SHA for this build.

## Gaps

- Exact proof that build 8 contains `origin/main` commit `73cb16968` rather than another working tree state.
- Physical-device verification of build 8 was outside this build-selection check.

## Next Action

Before Submit for Review, verify build 8 on a physical device against the review-gap and performance changes, or upload a provenance-stamped build 9 from `73cb16968` and attach that instead.
