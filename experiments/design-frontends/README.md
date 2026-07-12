# Dual Design Frontends — frozen experiment baseline (U1)

This directory owns the shared, renderer-neutral comparison baseline for the
GrapesJS-versus-Phaser-Editor design-frontend evaluation (`goal.md`, cards
U1–U10). Everything here is evidence input or protocol data — never runtime
input for a proof game.

## Layout

| Path | What it is |
| --- | --- |
| `protocol.json` | The frozen comparison protocol: lanes, gates, session rules, typed outcomes. |
| `fences.json` | Machine-readable lane file fences, shared surfaces, and frozen behavior paths. |
| `implementation-ledger.schema.json` | JSON Schema every U2–U6 handoff ledger entry must validate against. |
| `evidence.schema.json` | JSON Schema for comparison evidence records (device runs, warm edits, sessions). |
| `task-sets/` | The frozen matched-brief operation classes; U10 seals the actual scored briefs. |
| `baseline/` | Frozen facts: behavior hashes, accepted dependency pins, device profile. |
| `assets/` | Card-owned seed assets with provenance sidecars (the approved Shop icon). |
| `fixtures/phaser-feasibility/` | The U2 disposable feasibility probe and its accepted report (read-only). |

## Baseline rules

- The two proof games, `games/shell_proof_grapes` and `games/shell_proof_phaser`,
  are created from one hash-verified seed. Their frozen behavior copies are
  pinned in `baseline/behavior-hashes.json` and guarded by the
  `frozen-behavior` unit test committed inside both games.
- `games/_template` and `tools/create-game` are explicit non-targets of the
  experiment and stay byte-identical to main.
- The semantic authority is `packages/kernel/contracts/shell-presentation.v2.json`
  (`shell-presentation-v2`, seven states, `dom-css` + `phaser-native` renderer
  profiles). V1 remains immutable and readable; its byte hash is pinned in
  `packages/kernel/tests/shellContractRegistry.test.ts`.
- The renderer-neutral evidence probe wire contract is producer-owned in
  `packages/testkit/src/harness/evidenceProbe.ts` and consumed fail-closed by
  `tools/verify-device/src/evidenceProbe.mjs`.
- A shared-surface change after the lane fork goes through a conductor-owned
  integration card, updates both behavior copies atomically, and invalidates
  affected evidence (`fences.json` names the shared surfaces).

## Freeze record

The conductor records the landed integration SHA and the canonical hashes of
`protocol.json`, `fences.json`, and `baseline/*` in `protocol.json`'s
`freeze` block when U1 lands. Until then `freeze.baselineCommit` is `null` —
a null freeze means the baseline is NOT yet sealed and scored work cannot
begin.
