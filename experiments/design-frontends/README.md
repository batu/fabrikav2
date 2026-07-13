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

## Lane fence verifier

After the fork, each lane (`grapes`, `phaser`) may write ONLY inside its own
`writable` set in `fences.json`. `npm run fence-gate`
(`tools/verify-gate/fence-gate.mjs`) enforces this, measured over `base..HEAD`
where `base` is the trusted merge-base of the lane `HEAD` and the conductor-owned
`integration.branch` (or its origin twin) — never `freeze.baselineCommit`, and
never a caller-supplied ref/base that could collapse the base into `HEAD`.

Round-3 hardening (card `qWCv9tUo`, comment 43) closes four reproduced false
passes:

- **Canonical policy, not working-tree bytes.** The policy that *judges* the diff
  is loaded from the trusted base commit (`git show base:fences.json`). The
  working-tree `fences.json` is used only to bootstrap the candidate integration
  branch name, and it MUST byte-equal the canonical policy — a lane cannot widen
  its `writable` (e.g. to `**`) or redirect `integration.branch`.
- **Missing policy is fatal.** On an experiment branch a deleted `fences.json`
  fails closed; it is never a SKIP.
- **Base cannot collapse to `HEAD`.** If the integration ref resolves to the lane
  `HEAD` (e.g. `integration.branch` rewritten to the lane branch), the empty
  `base..HEAD` diff is refused.
- **Copies are chased.** The diff uses `git diff --raw -z -M -C --find-copies-harder`
  so a pure copy from an UNCHANGED forbidden source into an allowed path is caught
  by its forbidden source side.

The no-lane invocation is lane-explicit / fail-closed: only the integration tip
(`base == HEAD`) or a conscious conductor `FENCE_GATE_ALLOW_INTEGRATION=1`
acknowledgement skips; a diverged branch with no `FENCE_GATE_LANE` fails closed
rather than silently passing the fence. Logic is unit-tested in
`tools/verify-gate/test/fence.test.mjs` and exercised against a real temp git repo
(including all four exploits and the default invocation) in
`tools/verify-gate/test/fence-gate.live.test.mjs`.

## Freeze record

`protocol.json`'s `freeze` block seals this baseline. It records the landed U1
integration SHA (`baselineCommit`) plus the canonical SHA-256 of `protocol.json`,
`fences.json`, and every `baseline/*` file. A `null` `baselineCommit` means the
baseline is NOT sealed and scored work cannot begin; a non-null commit means it
is sealed and the frozen bytes are pinned.

**Canonical hash rule (deterministic, non-circular):**

- `protocol.json` is hashed over the SHA-256 of its parsed JSON with ONLY the
  nested `freeze.hashes` map removed (not the whole `freeze` block) and the
  remaining keys recursively sorted, then serialized compactly. Excluding only
  the map that *stores* the hashes from its own input is what makes the rule
  non-circular — sealing the record never changes the recorded protocol hash —
  while `baselineCommit`, `sealedStage`, `hashAlgorithm`, `hashRule`, and `note`
  all stay authenticated. (The *whole* `freeze` block is stripped only for the
  separate A-vs-B two-commit content check, never for this integrity hash.)
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
