---
title: Anchor a verification gate's trust outside the artifact it audits
date: 2026-07-13
category: architecture-patterns
module: tools/verify-gate (dual-design-frontends fence-gate & freeze-gate)
problem_type: architecture_pattern
component: tooling
severity: high
applies_when:
  - Building an integrity or policy gate that runs on the same branch it judges
  - Sealing or freezing a comparison baseline with recorded hashes
  - Enforcing per-lane / per-directory write fences in a shared integration branch
  - Any CI or pre-merge check whose inputs the audited party can influence
tags: [verification-gate, trust-anchor, freeze-seal, fence, security, self-authentication]
related_components: [testing_framework, development_workflow]
---

# Anchor a verification gate's trust outside the artifact it audits

## Context

The dual-design-frontends U1 baseline (Trello card qWCv9tUo) needed two executable
gates: a **freeze-gate** proving the frozen comparison baseline is honestly sealed,
and a **fence-gate** proving each lane wrote only inside its own writable fence. Both
gates shipped with green mocked test suites and were still rejected by independent
adversarial audits — repeatedly. Across four reopen rounds (the round-2 and round-3
repairs, plus two conductor exploit rejections) every reproduced false-pass had the
same shape: **the gate was reading its own trust anchor from an input the audited
party controlled.** A commit was asked to authenticate itself; a lane was allowed to
supply the base or the policy that judged it. The tests were green because they
tested the intended path, not the adversarial one — "first live run is part of the
build" applies to threat models too.

## Guidance

When a gate decides "is this change trustworthy?", every value it trusts to answer
must come from **outside the thing being judged**. Concretely:

1. **Never compare an artifact against itself.** A commit's recorded hashes cannot
   authenticate the commit that stores them, and a `base..HEAD` diff where `base ==
   HEAD` is always empty (a guaranteed pass). Split trust across two artifacts.

2. **Load the judging policy from the trusted source, not the working tree.** If the
   file that defines what is allowed (`fences.json`) lives in the same tree the lane
   can edit, a lane can widen its own permissions, redirect the integration branch,
   or delete the policy to escape it. Load the policy from the trusted **base
   commit** (`git show base:fences.json`) and require the working-tree copy to
   byte-equal it before trusting it.

3. **Compute the comparison base yourself from a conductor-owned identity.** Do not
   accept a base or ref the audited party hands you. Resolve the canonical
   integration branch identity from conductor-owned config, compute
   `merge-base(HEAD, canonicalRef)`, and require it to descend from the recorded
   functional baseline and be an ancestor of HEAD. If an explicit override is
   supplied, it must *equal* the computed trusted base — an arbitrary descendant is
   not sufficient.

4. **Missing or invalid trust anchor is FATAL, never a skip.** A gate that returns
   "SKIP / exit 0" when its policy file is absent, its base is unresolvable, or no
   lane is declared, hands the adversary a one-line bypass (just delete the file).
   The only legitimate skip is an explicitly acknowledged, out-of-band-reviewed case
   (e.g. the conductor's `FENCE_GATE_ALLOW_INTEGRATION`), never a silent default.

5. **Parse adversarial inputs defensively.** Read changed paths NUL-safely
   (`git diff --raw -z -M -C --find-copies-harder`) so embedded newlines/quotes
   cannot split or hide a record; evaluate BOTH sides of a rename/copy; use
   `--find-copies-harder` so a pure copy from an unchanged forbidden source is caught;
   reject a changed tracked symlink (git mode `120000`) even when its path is inside a
   writable glob — a symlink can point anywhere and is not an in-fence edit.

## Why This Matters

A false-passing integrity gate is worse than no gate: downstream work spends real
device runs and rebases trusting a baseline that was never actually verified. Every
bypass in this card was a *green* gate — the danger is not a crash, it is a confident
PASS on an unverified or malicious change. The self-reference is easy to miss because
the honest path looks correct: sealing a record and then hashing the current files
"passes," but proves nothing if the recorded commit is a stale ancestor whose bytes
no longer match. The invariant — trust anchored outside the audited artifact — is
what makes the PASS mean something.

## When to Apply

- Building any gate that runs on, and judges, the same branch/commit/tree it lives in.
- Recording hashes, seals, or signatures inside the file they authenticate.
- Enforcing write permissions defined by a file the writer can also edit.
- Reviewing existing gate logic: search for `== HEAD`, working-tree policy reads,
  caller-supplied bases/refs, and `skip`/`exit 0` on a missing input — each is a
  candidate bypass.

## Examples

**Freeze seal — two-commit topology instead of self-authentication**
(`tools/verify-gate/src/freeze.mjs`, `experiments/design-frontends/protocol.json`):
sealing uses a **functional commit A** (carrying the frozen `protocol.json` payload,
`fences.json`, and `baseline/*` bytes) plus a **freeze-only commit B** whose
`freeze.baselineCommit` points at A and changes nothing but `protocol.json.freeze`.
Two independent hash scopes keep it non-circular:

- The **integrity hash** strips only the nested `freeze.hashes` map, so
  `baselineCommit`, `sealedStage`, `hashAlgorithm`, `hashRule`, and `note` all stay
  authenticated while the map that stores the hashes is the one thing excluded.
- The separate **A-vs-B content check** strips the *entire* freeze block and proves A
  and B carry byte-identical non-freeze payload + `fences.json` + `baseline/*`.

A stale ancestor plus current-file hashes therefore fails: `npm run freeze-gate`
rejects a null/absent/non-ancestor commit, a hash mismatch, a missing/extra frozen
file, or an A-vs-B mismatch (older-ancestor substitution).

**Lane fence — trust the base commit, not the lane's working tree**
(`tools/verify-gate/src/fence.mjs`, `tools/verify-gate/fence-gate.mjs`). Four
reproduced false-passes, all closed by moving the trust anchor:

| Exploit (all returned PASS before) | Root self-reference | Fix |
|---|---|---|
| `FENCE_GATE_BASE=<full HEAD sha>` → empty diff | lane picks its own base | trusted base = `merge-base(HEAD, canonicalRef)`; explicit base must equal it |
| Edit `fences.json` `integration.branch` → lane branch | lane picks the ref that computes the base | integration identity is conductor-owned; ref override must name the canonical branch |
| Widen `writable` to `**` in the working tree | lane supplies its own policy | policy loaded from `git show base:fences.json`; working tree must byte-equal it (`policyMutationReason`) |
| Delete `fences.json` → SKIP exit 0 | missing anchor treated as pass | missing policy is FATAL; no-lane diverged branch fails closed (`decideNoLaneAction`) |

The gate is lane-explicit and fail-closed: `FENCE_GATE_LANE=<grapes|phaser>` enforces
a lane; only the integration tip (`base == HEAD`) or a conscious
`FENCE_GATE_ALLOW_INTEGRATION` acknowledgement may skip.

## Related

- [Data-first semantic contracts and immutable projections](../architecture-patterns/data-first-semantic-contract-and-immutable-projections.md) — sibling U1 learning; shares the fail-closed / deterministic-content-hashing family and the "downstream artifacts are wrappers, not authorities" motif.
- Trello card qWCv9tUo (GRAPES SHELL 2.5/8), comments 27–44 — the round-2/round-3 fence-gate repairs and the two independent conductor exploit rejections that drove this invariant.
