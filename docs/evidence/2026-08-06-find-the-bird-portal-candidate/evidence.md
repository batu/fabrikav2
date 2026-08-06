---
status: blocked
subject: Find the Bird first Portal release candidate
created: 2026-08-06
mode: pipeline
---

# Evidence: Find the Bird Portal candidate

## Verdict

Blocked only at the physical-device publication gate. The clean 53-level
campaign, selective five-starter native bundle, live Bird CDN, signed
harness-free Release app, and nested Portal browser preview are coherent at
merged-main revision `e2bea87b28f6cd1d2531ee90a614bc594c725b8b`. Portal was left
unchanged because the paired iPhone is unavailable and the exact build therefore
has no physical-device gameplay video or derived release poster.

## What Works

- All five starter packages are committed and manifest-authorized. The native
  bundle contains only those five level directories and rewrites catalog
  authority to the exact packaged bytes.
- The runtime defaults to the dedicated Find the Bird worker. Its live revision
  3 manifest has the same 53-level order and five-starter prefix as the repo.
- The signed Release app uses bundle id `com.basegamelab.findthebird`, marketing
  version `1.0`, build `1`, no `CAPACITOR_DEBUG`, and passes strict `codesign`
  verification.
- Portal's real zip extraction and nested-path rewrite changed three files and
  left zero unresolved owned references. Home and gameplay rendered at 390x844
  with no failed responses, page errors, or horizontal overflow.
- The first-release description and changelog basis are factual. The live Portal
  database still has no `find-the-bird` game or build row.

## Defects Resolved

1. Four of the five declared bundled starters were missing from Git. Their exact
   runtime files were recovered from a previously signed production archive,
   visually inspected, committed, and revalidated against every manifest hash
   and byte size.
2. Find the Bird inherited Find the Dog's default CDN origin. A failing
   regression test demonstrated the cross-game route, and the fallback now uses
   `ftb-level-origin.batuaytemiz.workers.dev`.
3. The old candidate's two QA-labeled scenes are no longer campaign starters.
   The current five clean starter scenes replace that obsolete blocker.
4. Native catalog snapshots previously retained source-tree bundle flags and
   package metadata. The selective build now reconciles them with exactly what
   ships.

## Verification

- Find the Bird unit suite: 44 files, 285 tests passed.
- TypeScript and focused ESLint over every changed TypeScript file: passed at
  the artifact revision. Full Find the Bird ESLint also passes at the branch tip
  after two mechanical, runtime-neutral baseline fixes.
- Live CDN: manifest HTTP 200; 53 ordered levels; 61 sampled assets across a
  starter, streamed level, and final level matched declared hashes and sizes.
- iOS environment validation, Vite build, Capacitor sync, Release Xcode build,
  build provenance, strict signature verification, and artifact hashing: passed.
- Human inspection: all four recovered starter paintings plus the current nested
  Portal home and gameplay screens were inspected.

## Publication Blocker

`Batu's iPhone` (iPhone 12) remains paired but its CoreDevice tunnel is
`unavailable`; the last recorded connection is 2026-08-01. Installing the exact
Release app returned CoreDevice error 1011 because the device could not be
located. Browser screenshots are diagnostic evidence only. They cannot be
promoted to the required production gameplay video or release poster.

## Evidence Artifacts

- [`release-manifest.json`](release-manifest.json) records source, commands,
  hashes, identities, live CDN checks, and the remaining gate.
- [`assets/portal-preview-home.png`](assets/portal-preview-home.png) shows the
  current rewritten nested Portal preview home screen.
- [`assets/portal-preview-gameplay.png`](assets/portal-preview-gameplay.png)
  shows current gameplay through the same preview.
- Candidate native and web archives are under
  `/private/tmp/ftb-portal-candidate-e2bea87b/`. They are not publication
  artifacts until the exact physical-device gate passes.

## Next Action

Connect and unlock Batu's iPhone by cable. Install the exact merged-main
harness-free app, capture normal-speed gameplay, derive the poster, then publish
and verify the immutable Portal entry. Rebuild only if runtime code moves beyond
the recorded source revision first.

```json
{
  "skill": "ce-evidence",
  "status": "blocked",
  "artifact_path": "docs/evidence/2026-08-06-find-the-bird-portal-candidate/evidence.md",
  "verdict": "The clean candidate passes source, build, CDN, and nested-browser gates; Portal publication is blocked only by missing exact-build physical-device capture.",
  "mode": "pipeline",
  "evidence": [
    {
      "type": "manifest",
      "label": "sanitized release manifest",
      "result": "candidate fields complete; publication_state blocked on device capture",
      "path": "docs/evidence/2026-08-06-find-the-bird-portal-candidate/release-manifest.json",
      "url": null
    },
    {
      "type": "test",
      "label": "Find the Bird unit suite",
      "result": "passed: 285 tests in 44 files",
      "path": null,
      "url": null
    },
    {
      "type": "rendered-preview",
      "label": "Portal nested browser preview",
      "result": "home and gameplay render without failed responses, page errors, unresolved owned paths, or horizontal overflow",
      "path": "docs/evidence/2026-08-06-find-the-bird-portal-candidate/assets/",
      "url": null
    }
  ],
  "reviewers": [],
  "gaps": [
    "The exact harness-free artifact has not been installed or captured on the unavailable physical iPhone."
  ],
  "next_action": "Connect and unlock Batu's iPhone, install the recorded merged-main artifact, then capture and publish it unless runtime code has moved.",
  "pr_updated": false
}
```
