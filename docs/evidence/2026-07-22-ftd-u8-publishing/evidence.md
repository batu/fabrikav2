---
status: passed
subject: FTD U8 publishing saga, schema, UI, and CI release gate
created: 2026-07-22
mode: pipeline
---

# Evidence: FTD U8 publishing saga, schema, UI, and CI release gate

## Verdict

Passed: current-commit release gates confirm deterministic generated contracts and public packages, provider-free publication and exact-readback reconciliation, accessible publishing state contracts, lint, type safety, and a fixture build; the committed desktop-browser review separately confirms the human publishing surface with no P1 finding.

## What Changed

- Added Pydantic-owned public level schema generation, generated runtime TypeScript, immutable package export, geometry/catalog/sequence validation, and retained-sequence rollback.
- Added approval-bound publish and rollback sagas with stable request replay, serialized reservation, exact remote readback, restart reconciliation, atomic local finalization, and fail-closed remote publication defaults.
- Added the desktop publishing desk for preview digest/changelog, approval binding, durable saga states, reconciliation/finalization errors, and retained rollback selection.
- Added focused schema/OpenAPI/type drift checks, CI wiring, editor documentation, and the root `editor:verify` gate. `levels-index.json` remains intentionally because create-game still consumes it.

## Evidence Captured

| Type | Artifact / Command | Result |
|------|--------------------|--------|
| release gate | `npm run editor:verify` | passed: OpenAPI/generated editor types current; generated level types current; 104 public packages plus catalog and retained index validated; 369 backend tests passed with 20 intentional deselections; TypeScript passed; 62 UI tests passed; ESLint passed; fixture build passed |
| focused saga | `npm run editor:publishing:test -w @fabrikav2/ftd-level-editor` | passed: 25 provider-free schema, catalog/sequence, publishing, reconciliation, and publishing API tests |
| visual states | `aesthetics/s1-fresh-load.png`, `aesthetics/s2-after-validate.png`, `aesthetics/s3-approve-enabled.png`, `aesthetics/s4-saga-activity.png` | passed: fresh, validated, approval-enabled, and fail-closed activity/error states captured in the desktop internal tool |
| visual review | `aesthetics/review.md` | passed with no P1 findings; one P2 disabled-button consistency issue and two P3 alignment/wrapping nits are explicitly deferred |

## Reviewer Assessments

| Reviewer | Status | Result |
|----------|--------|--------|
| independent motion-visual reviewer (conductor-side aesthetics gate) | passed | Desktop publishing hierarchy, spacing, contrast, grant-binding copy, and fail-closed presentation were legible with no clipping or P1 defect. |

## Gaps

- No release-blocking verification gap. Live provider publication, credential changes, deployment, v1 data copying, and authority activation were deliberately excluded by the U8 contract and remain separately approved U9/activation work.
- Deferred non-blockers: unify the disabled Approve treatment with rollback, improve long-digest wrapping, and align the preview heading.
- Full repository audit and whole-game lint retain unrelated baseline findings outside this card; the card-owned `editor:verify` release gate is green.

## Next Action

None.
