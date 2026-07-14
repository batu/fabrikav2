---
status: partial
subject: U5 seven-scene Phaser Editor authoring + portable publisher — authoring-parity verification
created: 2026-07-14
mode: pipeline
---

# Evidence: U5 seven-scene Phaser Editor authoring + portable publisher

## Verdict
Core U5 behavior is fully verified and green — the deterministic authoring/publisher
toolchain, the three accepted immutable P0/A/B publications, and their real-browser
seven-state render all pass — with one explicit, PR-acceptable gap: the card's
`project-gate` is red only at `fence-gate`, a conductor-owned merge-topology
attribution artifact with **zero real out-of-fence writes**, not a lane defect.

## Artifact contract classification
**headless-logic** (primary) — the U5 deliverable is a deterministic, editor-free
authoring toolchain + portable publisher (205 unit tests, determinism, AST-fact
parity, typed fail-closed block codes, kernel-v2 validation, non-circular manifest
preimages). Its visual surface is proven at **browser level** (real Chromium, seven
states, fonts loaded without fallback) — the authoring lane's honest ceiling.

**Target-device in-situ proof is out of scope for U5 by card contract** (Definition
of Done: runtime/projection/apply/device proof belong to U6/U8/U10) and the pipeline
already recorded `tested_insitu` skipped for this card (card comment 60). U5 has
**not** proven anything on a physical device and does not claim to; U6 consumes the
accepted P0/A/B chain and performs the Pixel 6a device proof.

## What Changed
- Seven-scene Phaser Editor authoring project (390×844) as the sole editable authority;
  generated code committed as hash-pinned, AST-fact-validated derived output.
- Curated R9 catalog + editor asset pack; typed fail-closed validation (`validate`) over
  the kernel v2 contract; deterministic portable `phaser-native` publisher.
- Three accepted immutable publications published after the VIP-Bundle overlap repair
  (card comment 48): **P0** `c27be2bf` (frozen seed), **A** `3b4d7cdb` (menu.title
  live-copy/move), **B** `35690099` (menu.settings→icon_control_confirm; distinct from A).
- Recovered + committed real-Editor provenance (`recovered-provenance.json`,
  `provenance-b.full.json`) after a transient authoring session.

## Evidence Captured
| Type | Artifact / Command | Result |
|------|--------------------|--------|
| test | `npm -w @fabrikav2/phaser-shell run verify-authoring` | **EXIT 0** — see `assets/verify-authoring.log` |
| test | phaser-shell unit (`vitest run`) | 22 files / **205 tests passed** |
| test | `validate` (typed fail-closed gate) | `{"result":"ok","blocks":[]}` |
| browser | `render` (Playwright/Chromium, real render) | **6/6 passed** — P0/A/B each render all 7 states; direct-boot texture guard; review journey |
| test | proof-game unit + build (`shell_proof_phaser`) | 11 files / **95 tests passed**; vite build OK (kenney-future TTFs bundled) |
| cli | `status` P0/A/B (immutable-vs-manifest) | 3× `outcome: "ready"`, `exists: true` |
| cli | `proof` P0/A/B (offline, network-free render) | 3× `{"ok": true, "findings": []}` |
| data | `accepted.json` P0/A/B distinctness | 3 distinct ids, **A ≠ B** |
| provenance | `provenance-b.full.json` sha256 | `e47181dd…` (matches card comment 55; compile-deterministic, authority stable across restart, 7 scenes) |
| provenance | `recovered-provenance.json` | `matchesAcceptedJson: true`, 3 distinct ids, `issues: []` |
| gate | `npm run audit` | **PASS** (pre-existing orphaned-token warnings only) |
| gate | `npm run freeze-gate` | **PASS** — baseline `89620259` sealed, 5 frozen files hash-verified, A==B |
| gate | `npm ci` lock byte-identity | `package-lock.json` sha `92f6ab30` **before == after**; manifests/lock git-clean |
| gate | `npm run project-gate` | **FAIL at fence-gate only** — conductor-owned copy-attribution; see Analysis + `assets/fence-gate-analysis.txt` |

## Reviewer Assessments
| Reviewer | Status | Result |
|----------|--------|--------|
| game-aesthetics (adversarial, prior stage) | passed | **0 ship-blocking P1** on the accepted P0'/A'/B' captures (card comments 59/61). Branded fonts load without fallback; Pause≠Settings; Win/Fail match the pastel system; VIP-Bundle overlap gone. Residual P2/P3 forwarded to U6, non-blocking. |

No fresh reviewer was re-run: the visual output was reviewed and passed by the
adversarial game-aesthetics gate in the immediately-preceding `aesthetics_reviewed`
stage, and the six real-browser render proofs independently confirm the shell renders
all seven states. Re-running the same review adds no signal.

## Analysis
Required because status is `partial`. Attempted the card's authoritative command
`npm -w @fabrikav2/phaser-shell run verify-authoring && npm run audit && npm run project-gate`.

- **verify-authoring:** green (exit 0) — every U5 deliverable is proven: authoring
  parity, deterministic publisher, AST-fact parity, block codes, the three accepted
  P0/A/B publications, and their real-browser seven-state render with fonts.
- **audit:** green (only pre-existing seed-token warnings, none in the phaser authoring surface).
- **project-gate:** red **only** at `fence-gate`. Bare it refuses a diverged branch
  without `FENCE_GATE_LANE`; with `FENCE_GATE_LANE=phaser` it flags `games/_template/**`
  and `experiments/design-frontends/**` entries over a 703-path range.

Ground truth (see `assets/fence-gate-analysis.txt`): a plain content diff with **no**
copy detection over `9781e179..HEAD` shows **674 files changed, all 674 inside the
phaser lane** (`tools/phaser-shell/`, `games/shell_proof_phaser/authoring|evidence/`);
**zero** non-lane content changes. The flagged out-of-lane entries are `git
--find-copies-harder` attributions: the lane duplicates byte-identical Kenney
assets/fonts into its content-addressed immutable publications, and copy detection
credits those to their out-of-lane source blobs (e.g.
`experiments/design-frontends/assets/icon-control-shop.png` is blob `bdadadc7…` at both
base and HEAD — never modified). Integration tip `9781e179` is an ancestor of HEAD and
both descend from the sealed U1 baseline `89620259`, so the earlier
integration-descendancy blocker (card comments 27/28) is resolved; the remaining fence
red is the shared-asset copy-attribution the conductor owns at merge (card comments
33/36/47/58). The grapes twin advanced through the identical topology (card comment 28).

This gap does not touch U5's changed behavior — it is a merge-tooling attribution over
branch topology, cannot be fixed from inside the lane by design, and has zero real
out-of-fence writes. It is therefore explicit and acceptable for PR review.

## Gaps
- **project-gate/fence-gate red (conductor-owned, PR-acceptable).** Copy-attribution of
  shared Kenney assets/fonts duplicated into immutable publications; 0 real out-of-fence
  writes. Resolves at conductor merge (advance/reseal the integration base so the
  shared-asset sources are in-base, or run the conductor merge allowance).
- **Proof-game generated-code lint** (`games/shell_proof_phaser/eslint.config.js`, a
  U1-owned file outside the phaser fence) reports `no-explicit-any` on Editor-emitted
  `.ts` + immutable publication snapshots. Not part of `verify-authoring` or the card
  command; the ignore must land via the conductor's U1-owned seam (card comment 58).
- **Target-device in-situ proof is U6's, not a U5 gap** — out of scope by card DoD;
  `tested_insitu` already skipped for this card (card comment 60).

## Next Action
Conductor: at merge, run `FENCE_GATE_LANE=phaser` and reconcile the integration base so
the shared-asset copy-attribution reads clean (or apply the conductor merge allowance),
and land the Editor-generated-code lint ignore via the U1-owned `eslint.config.js` seam.
Then U6 consumes the accepted P0=`c27be2bf` / A=`3b4d7cdb` / B=`35690099` chain for
P0→A→B→B and performs the Pixel 6a device proof.
