---
status: partial
subject: Find the Bird download lead and serving asset authority
created: 2026-09-14
mode: pipeline
---

# Find the Bird download lead and serving asset authority

## Verdict

Automated tests and a real CDN download exercise verify complete five-level
prefetch and incremental replenishment. The final catalog correction has not
been installed or tested on the phone: the user explicitly stopped device work
while playing and subsequently authorized testing and merging without resuming it.

## Changes

- Lookahead equals the installed build's playable bundled-level count, currently
  five, instead of the fixed value two. Next-level priority and the existing
  300 MiB in-memory cache budget remain in force.
- For levels present in the serving manifest, prefetch uses that manifest's
  complete asset set. Catalog package identity, eligibility, completeness and
  rollback retention remain authoritative. Catalog-only resolution is unchanged.
- Stale catalog requirements included 39 generated black-and-white images and
  five removed sprites. All 44 returned HTTP 404. Their failure stopped prefetch
  before the rest of the package downloaded. Runtime grayscale is generated
  locally; serving-manifest assets are the files loaded by gameplay.

## Verification

- Before the lookahead change, integration cases expecting three/five upcoming
  packages failed with only two retained. Afterward both passed.
- A stale-catalog fixture reproduces prefetch stopping after JSON and color:
  two assets per future level, instead of all four. The correction passes both
  stale-catalog and manifest-only cases for three/five bundled levels, including
  next-level priority, current sprites absent from the catalog and incremental
  replenishment without re-downloading existing assets.
- `npm run test:unit -w @fabrikav2/find_the_bird`: 77 files, 466 tests passed.
  Workspace typecheck, lint and `git diff --check` passed.
- Live manifest revision 15: downloaded all 985 unique serving assets across 44
  levels. Exactly 97,566,408 bytes (93.05 MiB), zero request failures, byte-size
  mismatches or SHA-256 mismatches. This measures compressed asset payload only.
- Ran the actual package builder and rolling synchronizer against the live CDN,
  using the catalog and bundled manifest from the build-40 app artifact.
  From progression index 4, all next five packages became locally available:
  100 requests, 10,073,053 cached bytes. Advancing to index 5 fetched only 22 new
  assets, with all next five complete and 12,367,042 bytes retained.
  See [live-prefetch.json](live-prefetch.json).
- Earlier native work: Debug 1.2.4 (40), harness disabled, built, signature
  verified, installed and launched on the iPhone 12. A pre-existing native
  runner entered gameplay successfully before the user stopped device work.
  That artifact contains the lookahead change only, not the later catalog fix.
  The user subsequently reported that play seemed to be working.

## Review

Code reuse, quality and efficiency reviewers ran on the initial change.
Suggestions to share the test's hash oracle with production and cache a
five-entry count were declined: they weaken test independence or add redundant
state without useful savings. Inline correctness review covers the final diff;
an additional independent correctness review covers serving asset authority.

## Storage findings and limitations

The app-managed asset cache is a memory Map; obsolete comments calling it
IndexedDB are not an implementation guarantee. WebKit also manages HTTP disk
caching: a pre-existing 10:27 phone inventory showed 42,459,873 bytes there.
The current policy evicts assets outside the rolling window regardless of free
budget, with rollback retention exceptions. It does not keep every played level
until the byte budget fills. Neither that budget nor lookahead bounds decoded
textures, browser caches, ads or the complete app footprint.

The build-40 artifact contains five bundled levels; its levels directory is
11,987,359 logical bytes including metadata and the entire Debug app bundle is
87,850,986 logical bytes. A 400 MB persistent disk cache is a separate proposed
change, not implemented by this PR. No CDN or Remote Config mutations occurred.

## Next action

Merge after required CI checks pass. Keep the phone untouched; install the
catalog correction only after device access is authorized again.
