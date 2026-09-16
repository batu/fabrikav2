# Collection + Sanctuary device reference set

Ten device captures from the iPhone, each judged PASS by the gate-B image pass
on 2026-09-17 (`docs/evidence/2026-09-16-ftb-collection-sanctuary/gate-b-verdicts.jsonl`).

These are the regression baseline for the feature. They replace the design
sheets in `docs/sanctuary-exploration/vertical-slice-2026-09-16/assets/` for
that purpose: those sheets are composites built with estimated anchors on a
flat background BEFORE the device pass, so they disagree with the shipped
screen in ways that are corrections rather than regressions — the bird is
anchored by its feet now, and the card portrait fits the porthole so the
beanie's pom-pom survives.

Regenerate with:

    /tmp/ftb-capture.sh <state>          # build + install with one tour state pinned
    tools/agates/pass_b_captures.py      # judge every row

States come from `FIND_THE_DOG_TOUR_STATES` in `src/testing/TestHarness.ts`.
