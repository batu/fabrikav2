# Intentional starter-shell remediation

## Task T1 - Make the starter shell read as a game, not a scaffold

### Status

passed

### Goal

Make the template's menu, gameplay demo, progression nodes, and Pause overlay
read as one intentional Kenney-backed starter experience at a 390 x 844 viewport.

### Why Now

The independent aesthetics review found a prototype-grey Pause card, internal
scaffold copy, weak Kenney presence, ambiguous progression states, and flat demo
actions. Those P1 findings block the next aesthetics review.

### User Lens

A new game maker should see a usable starter flow with an obvious next action,
not implementation instructions or exposed debug controls.

### Pre-Shot Targets

- Menu: hero, completed/current/locked progression nodes, and Continue action.
- Level: starter gameplay copy plus the two required demo outcomes.
- Pause: title and all three actions over the paused scene.
- Settled Win and Fail cards.

### Repro Setup

- Route: `/`
- Viewport: 390 x 844 CSS pixels
- Fixture: default synthetic save (level 2 current, level 1 complete, level 3 locked)
- State: real clicks through Play, Pause, and the rendered demo controls; wait for every overlay to settle.

### Acceptance Criteria

- Copy presents an intentional generic starter game; no developer/scaffold phrasing is visible.
- The Kenney hero and progression-node variants are visually prominent and distinguish completed, current, and locked states.
- The two required demo outcomes remain visible and semantic, with one clearly primary and the other deliberately secondary.
- Pause uses a cream/pastel grounded card with readable title and three visible actions, while all controls remain at least 48 px.
- Win and Fail remain settled, readable, and preserve Next/Retry/Home behavior.

### Expected Visual Result

A compact adventure sample: one clear path forward, distinct progression
landmarks, and a calm pause card that feels part of the same world.

### Constraints

- Keep all changes inside `games/_template/`.
- Reuse the existing shared UI components and semantic Kenney fixtures.
- Keep the one controller, six state flow, accessibility hooks, and two outcome controls.

### Out of Scope

- New mechanics, packages, authored GrapesJS state, create-game changes, shared UI-kit forks, and physical-device claims.

### Verification

- Matching 390 x 844 before/after screenshots from real rendered clicks.
- Template typecheck, unit tests, lint, build, and the approved-source Kenney audit.

### Result

Passed at 390 x 844. Matching screenshots and metrics cover all six states, and
the real-click tour covers Pause-origin Settings return, Resume, both outcomes,
and a settings toggle. Contract identities now map one-to-one to accessible DOM
owners, including level 1 and level 3 progression edges. Physical-device proof
remains explicitly out of scope for U2.

### Spawn Rules

- If a newly discovered visible issue is unrelated to the acceptance criteria, record it as a follow-up instead of expanding this task.
- If any criterion remains partial after capture, append another iteration rather than advancing.

## Task T2 - Restore Trailhead hierarchy after blind review

### Status

passed for Worked after the second blind-review remediation; pending an
independent Aesthetics Reviewed judgment

### Goal

Make the level HUD, playable-mechanic socket, progression landmarks, Pause card,
and failure surface read as a deliberate Trailhead starter at 390 x 844.

### Why Now

Blind Sol review found P1 visual regressions in the freshly captured U2 shell:
the `Trail 2` HUD identity is clipped, the dashed playfield remains a prototype
placeholder, the target/open-lock language makes progress provisional, and the
failure ribbon and glyph are illegible.

### User Lens

A game maker should immediately see where they are, what the replaceable
mechanic region is for, which trail nodes are complete/current/locked, and how
to retry a failed run—without mistaking template diagnostics for production UI.

### Pre-Shot Targets

- Menu: hero emblem and completed/current/locked route nodes.
- Level: full HUD identity, mechanic socket, and quiet template-preview strip.
- Pause: retained level, scrim, and compact action hierarchy.
- Fail: ribbon title, failure glyph, Retry, and subdued Home action.

### Repro Setup

- Route: `/`
- Viewport: 390 x 844 CSS pixels
- Fixture: default synthetic save (Trail 2 current, Trail 1 complete, Trail 3 locked)
- State: settled real clicks through Play, Pause, Complete round, and Preview retry.

### Acceptance Criteria

- `Trail 2` is fully visible on the active HUD without ellipsis or wrapping.
- Hero and mechanic socket no longer render the bullseye placeholder; the socket is solid, game-like, and still explicitly replaceable.
- Completed is a clear success mark while Locked remains a closed lock, with Current still distinct.
- The fail ribbon has readable title contrast and the failure glyph sits on a strong contrasting field; Retry is the only primary action.
- The preview strip remains functional, clearly template-only, semantic, and subordinate; Pause preserves the level beneath a lighter, tighter overlay.

### Expected Visual Result

A compact Trailhead sample with a clear in-level identity, a purposeful active
playfield, unambiguous progression landmarks, and a failure state that directs
the player back to Retry.

### Constraints

- Keep all changes inside `games/_template/` and reuse existing shared UI primitives.
- Keep the one controller, the existing six-surface flow, accessibility hooks, 48 px targets, semantic Kenney provenance, and browser-only evidence scope.

### Out of Scope

- New mechanics, GrapesJS/authoring state, package UI changes, dependencies, new game defaults, device proof, and production removal of the required outcome controls.

### Verification

- Proof-first focused unit assertions for the Sol P1/P2 seams.
- Matching 390 x 844 real-click browser captures and metric record.
- Template typecheck, unit tests, lint, build, and approved-source Kenney audit.

### Spawn Rules

- If a new visual issue is not one of the scoped hierarchy seams, log it as a follow-up instead of expanding T2.
- If the independent review remains partial, append another T2 iteration rather than advancing.

### Result

The focused renderer suite was deliberately red on five new Sol-seam
assertions, then green (17 focused tests) after the scoped correction. The
settled `u2-conductor-fixed-*` 390 x 844 real-click browser captures and
metrics show the full HUD identity, solid playfield, distinct route landmarks,
tighter preserved-level Pause surface, and a high-contrast Retry-first fail
surface. Every recorded action is at least 48 px. This is browser diagnostic
evidence only; Android/iPhone behavior remains unverified.

### Second Blind-Review Remediation

The next Sol gate found remaining player-facing component/scaffold language,
Pause HUD reflow, and failure styling that still looked like a system-error
dialog. Six focused assertions were added red-first. The final implementation
keeps progression states in art plus accessibility metadata, uses neutral
player copy, freezes Pause HUD geometry, and replaces the cross/beveled plaque
with a retry glyph and soft `Try again` title surface. The focused suite now
passes 18 tests; `u2-sol2-final-*` is the matching six-state browser capture
set. Physical-device behavior remains outside U2.
