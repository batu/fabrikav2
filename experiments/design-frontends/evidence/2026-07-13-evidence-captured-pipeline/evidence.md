---
status: partial
accepted: true
subject: U1 seven-surface FTD-structure shell — evidence_captured pipeline consolidation
contract: visual-runtime
created: 2026-07-13
mode: pipeline
head: 98c0422c9b4425fd516a92b951d64dccd0d05735
---

# Evidence: U1 seven-surface FTD-structure shell (evidence_captured stage)

Card: **GRAPES SHELL 2.5/8** (qWCv9tUo) — renderer-neutral seven-surface U1
baseline with the 2026-07-13 Find-the-Dog structure rewire (Menu bottom-nav
dock, Win reward-claim gating, Fail rescue surface, distinct Settings vs Pause,
seven-page Shop). This is the `evidence_captured`-stage pipeline consolidation:
it re-runs the reproducible deterministic gates at the exact branch HEAD and
consolidates the already-durable physical-iPhone seven-state device proof and
the independent interaction review into one artifact.

## Verdict

**partial — accepted for PR review.** Both evidence lanes are strong at HEAD
`98c0422c`: the deterministic repository gate is fully green (reproduced here),
and the source-grounded seven-state shell — Menu, Level, Shop, Settings, Pause,
Win, Fail — is captured on a signed physical iPhone with the required
Find-the-Dog interaction structure present, legible, and safe-area-clear on
every surface. An independent interaction reviewer confirmed six of seven
surfaces cleanly and raised no broken behavior; the residual gaps (a post-claim
Win frame not shot on the physical device, and one downstream-owned touch-target
measurement) are otherwise verified by green unit tests, committed device-viewport
captures, and prior independent review, so they are explicit and acceptable for
PR review rather than blockers.

## Contract classification

**visual-runtime.** The card renders game/shell pixels (Menu / Win / Fail /
Shop / Settings / Pause), so the authoritative claim is on-device runtime
rendering plus the deterministic contract/economy logic behind it. The device
lane is owned/captured on a real iPhone (comment 69/70); the logic lane is
reproducible via the repository gate.

## Evidence captured this run (deterministic, reproducible)

| Type | Command | Result |
|------|---------|--------|
| repository gate | `FENCE_GATE_ALLOW_INTEGRATION=1 npm run project-gate` | **PASS — 6/6 green** at HEAD `98c0422c` |
| — typecheck | all workspaces | passed |
| — test:unit | all workspaces | passed; kernel **127**, both proof games **95/95** each, verify-device **340**, verify-gate **242** |
| — audit | token/asset/structure | passed (pre-existing orphaned-token warnings only) |
| — check-claude-mirror | agents vs .claude mirror | PASS |
| — fence-gate | lane fence | SKIP — diverged integration card acknowledged (`FENCE_GATE_ALLOW_INTEGRATION`), trusted-base `9428c062`; shared-surface changes are conductor-reviewed |
| — freeze-gate | U1 freeze seal | PASS — baseline `89620259` sealed; 5 frozen files hash-verified; A-vs-B content equal |

Full gate log: this run's stdout (project-gate `PASS — 6 command(s) green`, exit 0).

## Device evidence consolidated (visual-runtime claim)

Durable physical-iPhone proof lives at
[`docs/evidence/2026-07-13-u1-seven-state-iphone/`](../../../../docs/evidence/2026-07-13-u1-seven-state-iphone/evidence.md)
(iOS 18.7.8, wired, Developer Mode enabled; 390×844 CSS px with iPhone
safe-area metrics; all seven states marker-gated, zero capture failures).
I inspected each committed frame first-hand for this consolidation:

| State | Frame | Required structure — observed |
|-------|-------|-------------------------------|
| Menu | `menu.png` | Persistent bottom dock: **Shop / Play (center, dominant green) / Settings**; Coins balance + level-map progression above the dock; top+bottom safe areas clear |
| Level | `level.png` | In-play: Coins HUD, Pause control top-right, gameplay canvas |
| Shop | `shop.png` | Full-page surface, header Back + title; **Coins (navy) vs Gems (deep-green) distinct**; two-column Item A `$0.99` / Item B `OWNED` (inert) / Item C locked `UNAVAILABLE`; Restore Purchases card |
| Settings | `settings.png` | **Full-page page-surface, no scrim/modal**; header Back + centered title; Music / Sound effects / Haptics toggle rows |
| Pause | `pause.png` | **Compact centered modal dialog over scrimmed frozen gameplay**; Resume / Settings / Return home; no toggle rows — visually distinct from Settings without reading the label |
| Win | `win.png` | **Pre-claim** surface: "5 Coins earned" + **Claim** + **Claim 2x / Watch ad**, and **no Next/Home** (claimed-only disclosure) |
| Fail | `fail.png` | Rescue surface: 25 Coins balance, **Continue · 10 Coins** (paid), free **Retry**, distinct **Rescue bundle · $4.99 / "Continue this level"** (disclosed outcome); **no Home** |

Structured Pixelsmith source-flow assessments (committed alongside the frames):
**Menu 85 pass · Win 85 pass · Fail 94 pass**.

## Independent reviewer

`ce-ui-interaction-reviewer` inspected all seven committed physical-iPhone frames
plus the three Pixelsmith JSONs. **Status: partial.** It confirmed six of seven
surfaces cleanly satisfy the interaction contract — Menu dock order + Play
dominance, Level HUD/Pause, Shop three-state item grid + dual currency, Settings
full-page (no scrim), Pause compact modal over scrim (distinct from Settings
without reading labels), and the Fail rescue surface (paid Continue · 10 Coins,
free Retry, priced Rescue bundle · $4.99 with disclosed "Continue this level"
outcome, no Home). Safe areas are respected on every frame. Two findings, both
resolved or bounded below:

- **P2 — post-claim Win surface not in the physical-device bundle.** The captured
  `win.png` is the **pre-claim** surface (reward + Claim + Claim 2x/Watch-ad, no
  Next/Home). This is the *correct, contract-compliant* device frame (win.next and
  win.home are genuinely claimed-only and default-hidden — comment 54/56), and it
  matches `evidence.md`/`win.json`. The reviewer's "post-claim expected" premise
  came from the review prompt, not from a wrong capture. Residual real gap: no
  *post-claim* Win frame (primary Next + subordinate Home) was shot on the
  physical iPhone. That transition is nonetheless verified by:
  green unit tests (`games/shell_proof_*/tests/unit/template-shell.test.ts`
  L739-759 — pre-claim hides `win.next`/`win.home`; post-claim reveals Next then
  Home; ran green this session, both proof games 95/95), and committed
  device-viewport (390×844@2x) post-claim captures
  `games/shell_proof_{grapes,phaser}/evidence/2026-07-13-ftd-aesthetics-p{1,2}/win-postclaim.png`
  independently reviewed **PASS** (card comment 60). The only missing item is a
  redundant post-claim screenshot on the physical device.
- **P3 (confidence 50%) — back control near the 48px touch-target floor.** The
  Shop header Back is CSS-proven **48×48 CSS px** (`.template-shell__icon-action`
  sets `min-width`/`min-height: var(--fab-btn-min-size)` = 48px;
  `--page-back` adds `width: var(--fab-btn-min-size)`). The kit Settings
  `.fab-page-back` geometry is conductor-owned (`packages/ui`) and its precise
  on-device touch-rectangle is already scoped to the downstream U10 device
  measurement pass (comment 16/60). Not a confirmed defect.

Reviewer's neutral-skin deltas (missing mascot, star-vs-coin glyph, cart-vs-bag,
"TRAIL COMPLETE" wording) are intentional per the neutral-skin contract — no action.

## Gaps (explicit, accepted for PR review)

1. **Post-claim Win frame not captured on the physical iPhone.** The physical
   tour shoots one frame per deterministic state, so the Win capture is the
   pre-claim surface. The post-claim reveal (primary Next + subordinate Home) is
   verified by green unit tests + committed device-viewport post-claim captures +
   prior independent PASS (see reviewer section), not by a physical-device frame.
   *Risk:* low — a redundant screenshot of an already-test-proven, already-reviewed
   transition; no broken behavior.
2. **Kit Settings back-control on-device touch rectangle not directly measured.**
   Shop header Back is CSS-proven 48×48; the kit `.fab-page-back` is conductor-owned
   and its precise device measurement is scoped to U10. *Risk:* low.
3. **Android in-situ unavailable** (ubuntu-server enumerates no ADB device,
   comment 61). iOS is the authoritative device lane and it passed all seven states.
4. Neutral template states deliberately carry no trusted one-to-one visual
   reference, so the generic verifier reports "no-applicable-evidence" for
   pixel-reference scoring; structure is assessed by source-flow comparisons and
   Pixelsmith rather than skin replication (by design).

## Next action (release gate — conductor-owned)

During the device-landing verification, capture a **post-claim Win** frame
(primary Next + subordinate Home) on the physical iPhone to close gap 1 (or
accept the test + device-viewport coverage), and fold the kit Settings
back-control touch-rectangle into the **U10** device measurement pass (gap 2).
Neither blocks the branch land: the conductor lands HEAD `98c0422c` to
`experiment/dual-design-frontends` and verifies the SHA in that branch log.
