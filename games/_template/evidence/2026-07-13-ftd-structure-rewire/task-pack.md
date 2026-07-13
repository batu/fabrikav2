# Task pack — 2026-07-13 FTD structure rewire (card qWCv9tUo, U1)

Reopened by the USER CORRECTION comment (2026-07-13): the frozen seven-surface
shell is **structurally** wrong on three surfaces versus the settled Find-the-Dog
product. This is a structure/behavior repair, not a styling pass. Keep generic
shell styling; do **not** clone FTD branding/art.

## Authoritative product source (read, not cloned)

- Menu dock: `games/find_the_dog/src/scenes/HomeScene.ts` L178-210, L559-574 —
  persistent bottom `home-nav-bar` with Shop (left), Play (center, dominant),
  Settings (right); currency pills stay in the header; level map above the dock.
- Win claim: `games/find_the_dog/src/ui/LevelCompleteOverlay.ts` L172-215 —
  `rewardLabel`/`rewardAmount` readout, `CLAIM`, and `CLAIM 2x` + `Watch ad`
  rewarded path (`onClaimDouble`), Next gated behind a claim.
- Fail rescue: `games/find_the_dog/src/ui/LevelFailedOverlay.ts` L112-165,
  L269-365 + `src/shop/FailContinueOffers.ts` — coin balance chip, `coinContinue`
  (deducts `levelContinueCoinPrice`), free `retry`, optional `egoOffer` IAP
  bundle with a real price/state; **no Home** on the initial surface.
- Settled Android references (moved into this branch, byte-identical):
  `references/find-the-dog/android/{menu,win,fail}.png`
  (sha256 menu=453f35a7…, win=d784c518…, fail=400395f0…).
- Pixelsmith pre-judgments: `/private/tmp/ftd-shell-rewire-pixelsmith/{menu,win,fail}-critique.json`
  (scores 30/22/18, all `fail`). Every listed *structural* defect is a `blocker`;
  the "title should be Find the Dog" defects are expected divergence (generic
  styling, no branding clone) and are intentionally **not** actioned.

## Required repair (comment 45, items 1-7)

1. MENU: persistent bottom nav group with three ordered semantic actions
   `menu.shop`, `menu.play`, `menu.settings`; Play centered + dominant; Shop and
   Settings leave the header; progression stays above the dock.
2. WIN: expose the earned reward amount; replace the initial Next/Home with
   `win.claim` and `win.claim-double`. `win.claim-double` carries explicit Watch-ad
   copy and calls a deterministic proof rewarded-ad seam; grants the 2x bonus
   exactly once; ordinary claim never double-grants; `win.next` is unavailable
   until a claim succeeds, then advances exactly once; replay/final-level reward
   idempotency preserved.
3. FAIL: rescue surface exposing `fail.currency`, `fail.continue-coins`,
   `fail.retry`, optional `fail.bundle`. Continue-coins deducts the configured
   proof cost exactly once and resumes only when affordable; Retry is free; the
   fake bundle uses the existing proof IAP seam with a real visible price/state
   and may be absent/disabled without breaking Retry; `fail.home` removed from
   the required initial surface.
4. Update `shell-presentation.v2` only (preserve v1 bytes): minimum
   roles/bindings/requiredActions/instances for nav, reward claim, rewarded
   claim, coin continue, optional bundle; parent groups + traversal order encode
   the observed structure.
5. Update `games/_template` + both proof games; frozen behavior files stay
   byte-identical across the two proof games; recompute behavior hashes and
   re-seal the U1 two-commit freeze honestly. Do not edit U3/U5/U6 lane-owned
   authoring outputs.
6. Proof-first: strengthen kernel-contract and template-shell tests, run them RED
   against the old contract, then implement. Cover happy paths, insufficient
   coins, ad/bundle unavailable, double taps, home/driveTo reset, final-level
   replay, and semantic DOM roles/order.
7. Iterative visual artifacts before production edits (this task-pack + the
   append-only `journal.md`); post-change visual proof is device-owned by the
   conductor if the worker sandbox cannot reach ADB — recorded as remaining,
   never faked.

## Scope fence

`packages/kernel/contracts/shell-presentation.v2.json` + its tests; frozen
template/proof-game `src`/`design`/`tests`/`docs` needed for this repair;
`experiments/design-frontends` `baseline`/`protocol`/`fences` for an honest
reseal; `references/find-the-dog/android`. No v1 contract changes, no unrelated
game changes, no dependency/lockfile changes, no U3/U5/U6 authoring implementation.

## Resolved ambiguities (stated, not assumed silently)

- **D1 — template participation (REVISED after discovering a hard block).** The
  template is a **frozen shell-presentation-v1** consumer: its
  `tests/unit/template-shell.test.ts` validates every rendered semantic instance
  against `shell-presentation.v1.json`, its config is locked to the 6-state list
  `[menu, level, settings, pause, win, fail]` by `tools/create-game/test/create-game.test.js`
  (OUT of scope), and its SDK has no IAP wiring. The new structure
  (`menu.nav`, `win.claim`, `win.reward`, `fail.continue-coins`, …) is **v2-only** —
  it is *unregistered* in the frozen v1 contract, so a v2-shaped template fails
  its own contract-mapping test, and v1 bytes may not change (item 4). Migrating
  the template onto v2 would additionally require a shop surface (breaking the
  6-state create-game invariant) or a `menu.shop`-optional contract wart. This is
  an **architectural conflict in the literal instruction**, so the structural
  rewire lands where it can be expressed honestly: the **v2 contract + both v2
  proof games** (the actual U1 subject and every downstream U3/U5/U6 dependency).
  The template is left as its frozen-v1 self (its tests stay green). Whether to
  separately migrate the template to v2 is a conductor/architecture decision,
  flagged in the handoff. "byte-identically for every frozen behavior file"
  (item 5) is satisfied by the two proof games (grapes == phaser).
- **D2 — contract version.** Extend `shell-presentation-v2` in place; the v2
  `compatibilityHash` necessarily changes and U3 republishes its unscored
  evidence (already flagged downstream). v1 stays byte-frozen.
- **D3 — reward/rescue economics (deterministic proof constants).** Base reward
  = 5 coins (first completion; 0 on replay/final-level idempotency). Ordinary
  claim grants base ×1; claim-2x (ad granted) grants base ×2, once; the two claim
  paths are mutually exclusive. Continue cost = 10 coins (affordable from the
  default 25-coin save; the insufficient-coins path is exercised by seeding a
  lower balance). Bundle is a real-money IAP over the existing fake provider —
  visible price, grants no currency, resumes the level on success, disabled when
  store metadata is unavailable.
- **D4 — rewarded-ad seam.** A deterministic local `ProofRewardedAdProvider`
  inside the proof SDK grants by default and can be seeded to report the ad
  unavailable (`{granted:false}`), so the "ad unavailable / try later" path is
  testable without a real ad SDK. `packages/sdk` stays conductor-owned/untouched.
- **D5 — post-claim navigation.** The initial win surface shows only reward +
  claim + claim-double (no Next/Home). After any successful claim, the claim
  group is replaced by `win.next` (primary, advances once) + `win.home` (tertiary),
  so Home stays reachable but is not on the required initial surface.

## Verification plan

`npm run typecheck`, `npm run test:unit` (kernel + both proof games), `npm run lint`,
`npm run build`, `npm run freeze-gate`, `npm run project-gate`
(`FENCE_GATE_ALLOW_INTEGRATION=1` — this integration card is diverged from the
integration branch pre-land, per the comment-44 env contract). Verify pageCount
still 7, ordered publication states, Settings non-modal vs Pause modal, and the new
menu-dock order / win-claim gating / fail-rescue behavior. Device capture of the
four frames is downstream and conductor-owned (Android via ADB) — recorded as
remaining, never faked.
