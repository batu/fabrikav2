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

`protocol.json`'s `freeze` block seals this baseline. It records the landed U1
integration SHA (`baselineCommit`) plus the canonical SHA-256 of `protocol.json`,
`fences.json`, and every `baseline/*` file. A `null` `baselineCommit` means the
baseline is NOT sealed and scored work cannot begin; a non-null commit means it
is sealed and the frozen bytes are pinned.

**Canonical hash rule (deterministic, non-circular):**

- `protocol.json` is hashed over the SHA-256 of its parsed JSON with the
  top-level `freeze` key removed and the remaining keys recursively sorted, then
  serialized compactly. Excluding the `freeze` block — which *stores* the hashes
  — from its own input is what makes the rule non-circular: sealing the record
  never changes the recorded protocol hash.
- `fences.json` and every `baseline/*` file are hashed over their exact on-disk
  bytes.
- `hashAlgorithm` is `sha256`.

**Verifier:** `npm run freeze-gate` (`tools/verify-gate/freeze-gate.mjs`) is the
executable seal check. It fails closed on a `null`/malformed `baselineCommit`, a
commit that is absent from the repo or not an ancestor of `HEAD`, a hash
mismatch, or a missing/extra frozen file, and self-disables (SKIP) on branches
without this baseline. It runs as part of `npm run project-gate`; its logic is
unit-tested in `tools/verify-gate/test/freeze.test.mjs`. Re-seal after any
authorized change to `protocol.json` (payload), `fences.json`, or `baseline/*`
by recomputing the hashes and updating the `freeze` block.
