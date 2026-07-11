---
status: passed
subject: Grapes canonical raster and asset-authority seam repair
created: 2026-07-11
mode: pipeline
---

# Evidence: Grapes canonical raster and asset-authority seam repair

## Verdict

Committed head `b3678d2f` passes the kernel and template contract gates, proves the approved Kenney fixtures against their source bytes, and closes all four validated review findings without changing retained runtime raster bytes.

## What Changed

- Source-raster eligibility and resource budgets are separate from rendered role geometry.
- The template seed contains one U1 asset catalog with one semantic slot per identity and exact provenance facts.
- Embedded-schema and TypeScript source-path validation now reject the same leading traversal segments.
- PNG alpha facts come from real chunk framing rather than a whole-file substring match.
- Every raster-policy coherence rule has a direct regression case, and control-character policy has one implementation.

## Evidence Captured

| Type | Artifact / Command | Result |
|------|--------------------|--------|
| test | `npm run test:unit -w @fabrikav2/kernel` | passed: 8 files, 92 tests |
| test | `npm run test:unit -w @fabrikav2/game-template` | passed: 6 files, 58 tests |
| contract | `npm run typecheck -w @fabrikav2/kernel` and template equivalent | passed |
| static analysis | `npm run lint` for kernel and template | passed |
| provenance | `KENNEY_APPROVED_SOURCE_ROOT=/Users/base/dev/appletolye/assets npm run audit:kenney -w @fabrikav2/game-template` | passed: 23 PNGs, 2 fonts, 2 licenses |
| build | `npm run build -w @fabrikav2/game-template` | passed: 108 modules transformed |
| byte identity | retained pre/post rename PNG comparison | passed: 23 of 23 byte-identical |
| review | `/tmp/compound-engineering/ce-code-review/20260711-172119-c9c18b3d/review.json` | ready with fixes; all 4 applied |

## Reviewer Assessments

| Reviewer | Status | Result |
|----------|--------|--------|
| multi-agent code review | passed after fixes | 9 reviewers, 4 validated findings, 3 validators |
| independent Codex adversarial pass | passed | no additional findings in the canonical review run |

## Gaps

- No device claim is made. This is a headless contract/provenance repair, and all retained runtime image bytes and bindings remain unchanged.

## Next Action

None.
