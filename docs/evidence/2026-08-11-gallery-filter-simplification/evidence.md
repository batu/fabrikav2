---
status: passed
subject: Find the Bird Gallery filter simplification
created: 2026-08-11
mode: pipeline
---

# Evidence: Find the Bird Gallery filter simplification

## Verdict

The production build, focused Gallery smoke test, and live Portal inspection confirm that background-only and archived levels are excluded and review states are mutually exclusive.

## What Changed

- Replaced technical completion controls with All active, Lineup, Hitboxes need review, Cutouts need review, and Reviewed.
- Derived cards, counts, filter options, tag totals, and focused navigation from the same active-card population.
- Added regression fixtures for archived-only, background-only-only, and mixed background/playable sessions.

## Evidence Captured

| Type | Artifact / Command | Result |
|------|--------------------|--------|
| build | `npm run build` | passed |
| browser smoke | `npm run test:gallery-retired-actions` | passed |
| live screenshot | `/tmp/ftd-gallery-simplified-final.png` | Portal shows All active 69, Lineup 44, Hitboxes need review 0, Cutouts need review 57, Reviewed 12; no completion controls or background-only cards |

## Reviewer Assessments

| Reviewer | Status | Result |
|----------|--------|--------|
| correctness | passed after fix | archived cards no longer leak into totals |
| adversarial | passed after fix | lineup and tag counts use active unique levels |
| testing | passed | boundary fixtures cover hidden and mixed variants |
| maintainability | passed | no structural findings |
| project standards | passed | no violations |
| agent-native | passed | no capability regression |

## Gaps

- The neighboring `test:sequence-page` smoke remains red on its pre-existing portrait-thumbnail expectation (`expected 9:16, got 1`); this change does not touch the Lineup page or thumbnail styling.

## Next Action

None.
