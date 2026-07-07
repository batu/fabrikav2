---
title: "MINE-4: state-normalized tour captures"
date: 2026-07-07
trello: https://trello.com/c/u8Lu1y29
card: u8Lu1y29
stage: brainstormed
status: requirements-locked
---

# State-normalized tour captures - requirements

## Summary

The allstates capture tour should normalize persistent game state before it drives any capture state, so menu, level, and result screenshots compare against the same progression profile every run. The harness contract should expose optional save reset/seed hooks that games with persistence can implement, while games without persistence continue to run the tour unchanged.

---

## Problem Frame

Recent capture evidence showed menu and level-panel scores swinging from roughly 30 to 75 due only to saved state differences such as coin balance, current level, and board progression. That state noise dominated the visual signal on multiple screens, so judges compared unlike screenshots and treated persistence drift as fidelity drift.

The capture tour already controls scene navigation through `snapshot()`-confirmed harness driving. It does not yet control the saved progression that the menu, saga map, HUD, and result surfaces read while those states are captured.

---

## Assumptions

*This requirements doc was authored without synchronous user confirmation. The items below are agent inferences that fill gaps in the input - un-validated bets that should be reviewed before planning proceeds.*

- The reference progression profile should represent a fresh install after early progress: current/unlocked level 2 and a small coin balance equal to one level reward, proposed as 25 coins for marble_run.
- The seed profile should force purchase/settings-adjacent values to a fresh-install shape when the game tracks them, proposed as no ads disabled and audio/haptics enabled.
- The immediate production consumer is marble_run; games/_template should carry the optional contract and tour behavior so future games inherit the pattern. tap_ten currently has no durable save state to seed.

---

## Actors

- A1. Device capture runner: launches the harness build, waits for tour state markers, and captures canonical states.
- A2. Game harness implementer: exposes state-query and action hooks used by the tour and capture tools.
- A3. Visual judge/reviewer: compares captures and should see gameplay/UI differences rather than save-state noise.

---

## Key Flows

- F1. Normalized allstates capture
  - **Trigger:** A harness-enabled build starts with the allstates insitu tour selected.
  - **Actors:** A1, A2
  - **Steps:** The tour detects allstates, asks the harness to reset durable save state when supported, asks the harness to seed the reference progression profile when supported, then drives the canonical states through existing confirmed navigation.
  - **Outcome:** Every captured state starts from the same persisted progression profile regardless of what localStorage or device storage contained before launch.
  - **Covered by:** R1, R2, R4

- F2. Comparison after state normalization
  - **Trigger:** A visual judge compares current captures to the reference set.
  - **Actors:** A1, A3
  - **Steps:** Menu, level, win, and fail states all reflect the seeded progression; visual scoring is no longer dominated by prior user progress, coin count, or unlocked-level drift.
  - **Outcome:** Fidelity scores measure rendering differences instead of save-state differences.
  - **Covered by:** R3, R5

---

## Requirements

**Harness save-state contract**

- R1. The shared game harness contract must allow games to optionally expose a full save reset hook and a deterministic seed hook that accepts a structured profile.
- R2. A game that implements the seed hook must make subsequent harness snapshots reflect the seeded progression values used by visible menu, HUD, and level-selection surfaces.
- R3. Games that do not implement the optional save hooks must keep the existing allstates tour behavior; absence of persistence support is not a failure.

**Allstates tour behavior**

- R4. The allstates tour must reset and seed supported save state before driving the first canonical state, not midway through the state list.
- R5. The tour must continue to drive and confirm canonical states through the existing `snapshot()`-based state checks and tour-state marker flow.
- R6. marble_run must implement the save hooks against its real persistent save state so the seeded profile affects menu progression, coin displays, level HUD, and result surfaces.
- R7. games/_template must document and exercise the optional save hooks so newly scaffolded games inherit the state-normalized capture contract.

**Verification**

- R8. Unit coverage must prove the allstates tour calls reset/seed before driving states.
- R9. Unit coverage must prove a seeded profile is observable through the relevant harness snapshot path.
- R10. Verification must clearly distinguish local/unit proof from real-device capture proof; this stage does not itself require a fresh on-device panel run.

---

## Acceptance Examples

- AE1. **Covers R1, R4, R8.** Given an allstates tour and a harness that records calls, when the tour starts, reset and seed are called before the first state drive.
- AE2. **Covers R2, R6, R9.** Given marble_run has stale progress such as a high coin balance and later unlocked level, when the harness reset/seed path applies the reference profile, a subsequent snapshot reports the seeded level and coin balance.
- AE3. **Covers R3.** Given a game harness has no save hooks, when the allstates tour runs, it still drives the canonical states and marks them as before.
- AE4. **Covers R5.** Given state normalization succeeds, when a canonical state cannot be reached or settle-confirmed, the tour still marks that state as failed rather than emitting a false success.

---

## Success Criteria

- Menu, level, HUD, and result captures no longer oscillate based on prior save data when allstates runs.
- A downstream planner can implement the work without inventing whether normalization belongs in the tour, the harness contract, or the visual judge.
- A downstream reviewer can verify the card with focused tests for reset/seed invocation and seeded snapshot visibility.

---

## Scope Boundaries

- Do not change the visual judge scoring model or tune panel thresholds on this card.
- Do not update reference screenshots solely as part of defining the save normalization contract.
- Do not add autonomous retry/convergence behavior to the tour; it remains a deterministic scripted fixture that returns control.
- Do not require every game to implement persistence hooks immediately; the contract is optional, and only games with save-backed visual state need concrete support.
- Do not alter normal player-facing reset behavior unless required to support the harness-only reset/seed path.

---

## Key Decisions

- Normalize in the allstates tour before state driving: this is the earliest shared point that controls every captured state without moving judgment logic into the visual judge.
- Make the harness hooks optional: this keeps the contract compatible with simple games and templates while allowing persistence-heavy games to remove state noise.
- Keep verification focused on deterministic local behavior for this stage: real-device capture remains the later in-situ/evidence responsibility.

---

## Dependencies / Assumptions

- The existing allstates tour and device runner continue to use canonical states `menu`, `level`, `settings`, `pause`, `win`, and `fail`.
- marble_run snapshots already expose save-backed values needed to observe seeded progression.
- The exact reference profile values should be revisited during planning against the current reference captures; the proposed starting profile is level 2 with 25 coins.

---

## Outstanding Questions

### Resolve Before Planning

- None.

### Deferred to Planning

- [Affects R1, R2][Technical] Choose the exact shared profile type name and how much game-specific data it permits.
- [Affects R6, R9][Technical] Decide whether marble_run should add a harness-only save reset method to its save-state class or compose existing public save operations.
