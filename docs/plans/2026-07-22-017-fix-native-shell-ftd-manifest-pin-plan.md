---
title: "fix: native-shell FTD manifest pin"
date: 2026-07-22
type: fix
origin: trello-card-OK8VngBe (card description; no brainstorm document)
trello: https://trello.com/c/OK8VngBe
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
---

# fix: native-shell FTD manifest pin

## Goal Capsule

Restore a trustworthy native-shell land gate by ensuring the Find the Dog manifest-contract test pins the complete approved iOS local-package graph, including `CapacitorLocalNotifications`, while preserving the 152-entry SKAdNetwork catalog contract. Work is limited to `tools/native-shell/**` plus this plan artifact; Find the Dog app and manifest files are read-only authorities.

The Trello card and `games/find_the_dog/native-resources/ios/shell-manifest.json` define the requested outcome. The spawn baseline at `f4aa6309` already contains the requested package-name pin from merge commit `199750e2`, so execution must begin by verifying the live baseline and must not create a redundant code edit merely to produce a diff. The implementation worker owns the narrow checks and an honest no-op handoff if the gate is already green; the TWF conductor owns landing.

---

## Product Contract

### Summary

The native-shell contract test previously expected four Find the Dog local Swift packages after the approved manifest added `CapacitorLocalNotifications`, causing a deterministic pre-existing failure in every merge gate. The contract test must mirror current manifest reality so a native-shell failure signals real drift rather than a stale pin.

### Requirements

- R1. The Find the Dog manifest-contract assertion exactly matches the ordered `ios.localPackages[].name` values in `games/find_the_dog/native-resources/ios/shell-manifest.json`, including `CapacitorLocalNotifications` between `CapacitorHaptics` and `CapacitorFirebaseAnalytics`.
- R2. The native-shell unit suite passes against the committed Find the Dog manifest and SKAdNetwork catalog.
- R3. The approved 152-entry SKAdNetwork catalog count and uniqueness assertions remain unchanged unless direct inspection of the committed catalog proves that approved reality changed.
- R4. No Find the Dog application, generated iOS shell, manifest, catalog, or unrelated workspace code is modified.
- R5. If the spawn baseline already satisfies R1-R4 and all required checks pass, execution records the card as already resolved upstream instead of manufacturing a redundant tools change.

### Acceptance Examples

- AE1. Given the current committed manifest contains five local packages, when the manifest-contract test runs, then its ordered name pin includes the same five names and the suite passes.
- AE2. Given `CapacitorLocalNotifications` is removed, reordered, or renamed in either the manifest or the test pin without the other side changing, when the suite runs, then the exact-list assertion fails visibly.
- AE3. Given the catalog still contains 152 unique identifiers, when the suite runs, then both the length and uniqueness assertions pass without changing their expected count.
- AE4. Given baseline `f4aa6309` already contains the exact pin and the suite is green, when the worker inspects the diff, then no unnecessary source edit is introduced.

### Scope Boundaries

- Modify only `tools/native-shell/**` if verification exposes remaining drift; this plan under `docs/plans/**` is the required planning artifact.
- Treat `games/find_the_dog/native-resources/ios/shell-manifest.json` and `games/find_the_dog/native-resources/ios/applovin-skadnetwork-ids.json` as read-only inputs.
- Do not touch FTD app code, generated `games/find_the_dog/ios/**` output, dependency versions, native-shell implementation behavior, or unrelated tests.
- Do not broaden the task into replacing the explicit approved-value pin with a tautological assertion derived from the same manifest under test.

### Product Contract Preservation

Product Contract unchanged from the Trello card, with R5 added to reflect the verified spawn-baseline state.

---

## Planning Contract

### Key Technical Decisions

- KTD1. Keep the manifest-contract test as an explicit ordered allowlist. It independently detects unreviewed manifest graph changes; generating the expected list from `actualManifest` would remove that protection.
- KTD2. Use the committed recipe manifest as the package-graph authority and the committed catalog JSON as the catalog authority. Compare the exact ordered local-package names before deciding whether any edit is needed.
- KTD3. Preserve the existing catalog length and uniqueness checks at 152 when the current catalog still has 152 unique entries. Package-graph drift does not imply catalog drift.
- KTD4. Apply the smallest possible correction in `tools/native-shell/test/native-shell.test.mjs` only if live inspection or test execution reveals a mismatch. The observed baseline already includes `CapacitorLocalNotifications`, so a green verification path is intentionally a no-op for source code.

### Patterns and Constraints

- Follow the existing `Find the Dog manifest contract` test in `tools/native-shell/test/native-shell.test.mjs`, which pins identities, remote package versions, ordered local package names, Firebase analytics traits, and catalog cardinality in one focused integration contract.
- Use workspace scripts from `tools/native-shell/package.json`; the workspace has `test:unit` and `lint` scripts but no dedicated `typecheck` script. The repository-level typecheck uses `--if-present`, so it performs no native-shell-specific typecheck work.
- Do not run browser E2E or device verification: this card changes a Node test contract and has no runtime UI or mobile rendering behavior.

### Sequencing

First compare the explicit test allowlist with the committed manifest and count unique catalog identifiers. Then run the native-shell unit suite. Only if those checks reveal unresolved drift should the test pin or directly related assertions be edited; after any edit, rerun unit tests and lint. Finally, inspect the diff to prove all source changes remain within `tools/native-shell/**`, or record that the upstream merge already resolved the card.

---

## Implementation Units

### U1. Reconcile and verify the FTD manifest contract

**Goal:** Make the native-shell gate accurately enforce the current approved Find the Dog package graph without weakening its independent pins.

**Requirements:** R1-R5; AE1-AE4.

**Dependencies:** None.

**Files:** Read `games/find_the_dog/native-resources/ios/shell-manifest.json` and `games/find_the_dog/native-resources/ios/applovin-skadnetwork-ids.json`; modify and test `tools/native-shell/test/native-shell.test.mjs` only if a mismatch remains.

**Approach:** Compare the ordered `ios.localPackages[].name` list against the explicit array in the manifest-contract test. Confirm `CapacitorLocalNotifications` occupies the same position and that the catalog still has 152 unique identifiers. Run the focused workspace suite before editing because commit `199750e2` appears to have resolved the stale pin already. If the suite is green and the lists match, preserve the source tree unchanged and report the upstream resolution; otherwise make only the missing pin/count correction and rerun all gates.

**Patterns to follow:** The exact-value assertions in the existing `Find the Dog manifest contract` describe block.

**Test scenarios:**

- Covers AE1. The exact ordered local-package allowlist is `CapacitorApp`, `CapacitorHaptics`, `CapacitorLocalNotifications`, `CapacitorFirebaseAnalytics`, and `RevenuecatPurchasesCapacitor`, matching the manifest byte-for-byte by value and order.
- Covers AE2. A temporary reasoning check confirms that omitting or moving `CapacitorLocalNotifications` would fail the existing `toEqual` assertion; no weaker membership-only assertion is substituted.
- Covers AE3. The catalog length is 152 and the set of `skadnetwork_id` values also has size 152.
- Covers AE4. A final Git diff contains no FTD app or manifest changes and no redundant native-shell source edit when baseline verification passes.

**Verification:** The focused native-shell unit suite and ESLint pass; the manifest/list and catalog/count observations are stated in the implementation handoff; the final path-scoped diff is empty or limited to the necessary test correction.

---

## Verification Contract

Run from the repository root:

```bash
npm --prefix tools/native-shell run test:unit
npm --prefix tools/native-shell run lint
npm run typecheck --workspace @fabrikav2/native-shell --if-present
git diff --check
git diff --name-only
```

In addition to command success, directly inspect `games/find_the_dog/native-resources/ios/shell-manifest.json` and confirm its ordered `ios.localPackages[].name` list equals the explicit list in `tools/native-shell/test/native-shell.test.mjs`. Directly inspect `games/find_the_dog/native-resources/ios/applovin-skadnetwork-ids.json` and confirm it contains 152 entries and 152 unique `skadnetwork_id` values. The typecheck command is expected to be a no-op because this workspace has no `typecheck` script; report that honestly rather than claiming a workspace typecheck ran.

---

## Definition of Done

- The explicit FTD local-package pin and committed manifest agree exactly, including `CapacitorLocalNotifications` in the approved order.
- The native-shell unit suite and ESLint pass.
- The catalog remains pinned to 152 entries and all 152 identifiers are unique, unless inspected approved reality proves a different count and the related assertion is updated together.
- No FTD app, native recipe, generated iOS shell, dependency, or unrelated workspace file is modified.
- If baseline `f4aa6309` is already green, the result is recorded as resolved upstream with no fabricated source-code change.
- No temporary diagnostics, abandoned edits, unrelated cleanup, or pull request remains.
