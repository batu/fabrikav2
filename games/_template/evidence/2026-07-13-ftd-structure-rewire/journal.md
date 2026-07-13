# Append-only journal — FTD structure rewire (card qWCv9tUo)

Entries are append-only. Each records what was done, what was observed, and the
next step. Newest at the bottom.

---

## Entry 1 — 2026-07-13 — Orientation, blueprint, red-before plan

**State at start.** Card reopened by the USER CORRECTION (comment 45). Worktree
clean at `905c0339` (U1 round-3 freeze seal). The frozen shell is 7 surfaces in
the two proof games and 6 in `games/_template`; `menu`/`win`/`fail` are
structurally wrong versus settled FTD.

**Reading.** Traced FTD Home/LevelComplete/LevelFailed + FailContinueOffers;
the contract parser (`packages/kernel/src/shellContract.ts`, 4050 lines) and its
cross-checks (roles↔families/slots, instances↔roles/bindings/families/parents,
requiredActions↔instances/bindings, `accessibility.traversalGroup`+`order` for
traversal); the proof controller/SDK/shop-catalog seams (real `IapService` +
`FakePurchaseProvider`, `DisabledAdProvider`); the UI primitives I may reuse
(`mountHomeMenu` bottom-action dock, `mountResultCard` accepts a game-owned
action-slot `HTMLElement` + fresh `art` element). Confirmed template↔proof are
not and never were byte-identical (6 vs 7 surface, no-IAP vs IAP SDK), so item 5
byte-identity is a proof-twin invariant — see task-pack D1.

**Blueprint (contract deltas, minimal + reuse-first).**
- Menu: add role `bottom-nav` (static group, bottom-center) + instance `menu.nav`;
  reparent `menu.play` (keep dominant primary) and move `menu.shop`/`menu.settings`
  off the header into the dock via a new bottom-anchored icon-action role; encode
  order shop<play<settings through `accessibility.traversalGroup`+`order`.
- Win: add bindings `state.reward-amount` (read), `flow.claim` (action),
  `flow.claim-double` (action); role `reward-readout` (static); instances
  `win.reward`, `win.claim`, `win.claim-double`; keep `win.next` (now gated) and
  make `win.home` optional; add requiredActions for claim/claim-double.
- Fail: add bindings `flow.continue-coins` (action), `commerce.bundle` (action);
  instances `fail.currency` (reuse currency-counter), `fail.continue-coins`,
  `fail.bundle` (optional); keep `fail.retry`; drop `fail.home` from the required
  initial surface.

**Behavior blueprint (proof controller, frozen twin).** Win sub-state
`{rewardAmount, claimed, claimedDouble}`; `claim()`/`claimDouble()` grant once and
gate `next()`; fail continue-coins deducts `CONTINUE_COST` once and only when
affordable; bundle purchases via `iap.purchase`. Constants: reward base 5,
continue cost 10 (task-pack D3). Deterministic `ProofRewardedAdProvider` seam
(D4).

**Pre-edit artifacts landed.** This journal + `task-pack.md`; FTD android
references relocated byte-identically to `references/find-the-dog/android/`.

**Next.** Write the red-before kernel-contract + template-shell assertions,
capture RED, then implement contract → proof controller/SDK → renderer/CSS/copy →
mirror to phaser + template → recompute hashes → gates → two-commit reseal.
Device frames remain conductor-owned (Android/ADB) and are recorded as remaining.

---

## Entry 2 — 2026-07-13 — Implementation landed; template v1-lock discovered

**Contract (v2).** Added the menu nav group (`bottom-nav` role + `menu.nav`,
reparenting shop/play/settings in shop<play<settings traversal order), the win
reward/claim vocabulary (`state.reward-amount`, `flow.claim`, `flow.claim-double`;
`win.reward`/`win.claim`/`win.claim-double`; `win.next` retained, runtime-gated),
and the fail rescue vocabulary (`flow.continue-coins`, `commerce.bundle`;
`fail.currency`/`fail.continue-coins`; optional `fail.bundle`). Dropped
`win.home`/`fail.home`. Kernel suite green (122); strengthened the registry test
with a positive structural assertion and updated the migration `droppedInstanceIds`.

**Proof games (grapes + phaser, byte-identical frozen files).** Controller: a
deterministic idempotent reward machine (claim once, claim-2x once via a
`ProofRewardedAdProvider` rewarded seam, Next gated on claim, replay/final-level
idempotency) and a fail rescue (coin-continue deducts 10 once when affordable,
free retry, IAP bundle over the real `IapService`/`FakePurchaseProvider` seam
priced at $4.99, granting no coins). SDK/catalog: rewarded provider + a scripted
`rescue_bundle` product in its own group (invisible to the shop grid). Renderer +
CSS: bottom dock (shop/play/settings, play dominant), win claim card (reward
readout + claim/claim-2x + gated Next), fail rescue card (currency + continue +
retry + bundle). Rewrote the 8 interaction-coupled `template-shell.test.ts`
blocks and the shop-proof dock assertion, and added a 7-test reward/rescue
behavior block (idempotency, ad-unavailable, insufficient coins, bundle,
double-tap guards). Both proof games: 93/93. Regenerated
`baseline/behavior-hashes.json`.

**Template v1-lock (see task-pack D1).** Began mirroring the reduced rewire into
`games/_template`, then found the hard block: the template validates against the
FROZEN v1 contract, whose vocabulary has none of the new instances. A v2-shaped
template fails its own contract-mapping test, v1 bytes can't change, and a v2
template would need a shop surface (breaking create-game's 6-state invariant).
Reverted the template code changes; it stays its frozen-v1 self (27 tests green).
Recorded this as an architectural conflict for the conductor.

**Next.** Commit A (functional: contract + proofs + hashes + refs + evidence),
reseal the two-commit freeze as commit B, run the full project gate, capture
web-canvas frames (device deferred to the conductor), hand off.

---

## Aesthetics round-1 P1 remediation (2026-07-13, reopened from aesthetics_reviewed)

Fable's round-1 review returned FIX-THEN-SHIP with five P1 blockers; all five are
closed in the v2 contract + both proof games (byte-identical frozen files),
renderer/CSS only where possible.

- **P1-1 Play copy.** `menu.play` was "Continue"; the FTD source hierarchy labels
  the dominant center action **Play** (`HomeScene.ts` L559-574, aria "Play Level
  N"). Changed the copy seed to "Play" in both games (frozen, twin-identical
  apart from the title line).
- **P1-2 dock contrast.** Shop/Settings dock labels were dark body text on the
  dark slate dock surface (~2.3:1, fails AA). Moved the nav-action label ink to
  the light on-accent token (~5.8:1, matches the white nav icons) and bumped it
  to bold. Renderer CSS only (lane-owned).
- **P1-3 pre/post-claim disclosure.** The pre-claim win surface no longer
  discloses a disabled Next: it renders **only** reward + Claim + Claim 2x, then
  swaps them for a single enabled **Next** after a claim. This required one
  honest contract change — `win.next` is now `required: false` (a conditional
  post-claim navigation instance, mirroring the already-optional `fail.bundle`):
  with all of win.claim/win.claim-double/win.next `required`, no single rendered
  surface could satisfy the contract-mapping test across the pre/post split. The
  parser still accepts it (the `win-next` requiredAction is validated by
  visibility, not the instance `required` flag; `required` only relaxes the
  renderer's obligation). Controller/economy behavior is unchanged. Kernel green
  (122); added a `win.next.required === false` assertion.
- **P1-4 fail safe-area.** The docked rescue sheet floored its bottom padding at
  space-md; bumped to `max(space-lg, env(safe-area-inset-bottom))` so the bundle
  clears the device home indicator instead of reaching the raw viewport bottom.
- **P1-5 bundle as card.** The bundle used the borderless tertiary quiet-exit
  grammar and read as loose text; it is now a complete bounded purchase
  card-button (white card surface + its own accent border) carrying the visible
  price. Renderer class + CSS only.

Strengthened frozen tests for each seam (Play copy + dock ink, pre/post
disclosure with a dedicated test, bundle-is-a-card + no-tertiary, fail safe
bottom). Both proof games: 95/95. Regenerated `baseline/behavior-hashes.json`
(only the two changed test files). Web-canvas frames recaptured under
`evidence/2026-07-13-ftd-aesthetics-p1/` in both games; device proof stays
conductor-owned. `games/_template` code + `tools/create-game` + package-lock
untouched.
