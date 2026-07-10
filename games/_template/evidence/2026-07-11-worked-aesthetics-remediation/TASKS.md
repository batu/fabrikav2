# Intentional starter-shell remediation

## Task T1 - Make the starter shell read as a game, not a scaffold

### Status

partial

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

### Spawn Rules

- If a newly discovered visible issue is unrelated to the acceptance criteria, record it as a follow-up instead of expanding this task.
- If any criterion remains partial after capture, append another iteration rather than advancing.
