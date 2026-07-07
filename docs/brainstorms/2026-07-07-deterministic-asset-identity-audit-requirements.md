---
date: 2026-07-07
topic: deterministic-asset-identity-audit
trello: https://trello.com/c/rQPMcfmJ
card: rQPMcfmJ
stage: brainstormed
status: requirements-locked
---

# Deterministic Asset Identity Audit

## Summary

Add a deterministic asset-identity audit to the existing `tools/audit` gate so shipped game design assets, glyph stand-ins, and font tokens can be checked against committed reference intent. For marble_run, the first manifest must cover the current `design/assets` set, preserve known intentional differences as explicit exceptions, and surface the current sad-face emoji asset gap instead of letting it hide inside copy.

---

## Problem Frame

Batu's request targets the failure recorded in `docs/retros/fidelity-diff-mistakes-ledger.md`: for a clone, "is this the actual reference asset/font/animation?" was treated as polish instead of a first-class pass/fail axis. The repo now has better reference capture tooling (`tools/refcap-compare`) and a `tools/audit` package wired to `npm run audit`, but there is still no machine-readable ledger proving that each shipped `games/<game>/design/assets` file is the same as its canonical source, intentionally different, or explicitly perceptual rather than byte-exact.

marble_run already demonstrates both sides of the problem. `docs/evidence/asset-swap-plan.md` says many sprites and fonts were copied from the reference game and staged under `games/marble_run/design/assets`, while current code still renders `copy['result.lose.emoji']` as a text emoji in `games/marble_run/src/shell/App.ts` for the fail dialog. Recent panel evidence (`docs/evidence/2026-07-07-2030-turn10-verify/panel.json`) still flags the fail dialog iconography as a major divergence. The next implementation should make that class of drift show up in `npm run audit` before a human review has to rediscover it.

---

## Assumptions

*This requirements doc was authored without synchronous user confirmation. The items below are agent inferences that fill gaps in the input - un-validated bets that should be reviewed before planning proceeds.*

- The first implementation should extend `tools/audit` rather than create a separate root script, because the card explicitly says "Wire into npm run audit" and the existing package already owns guardrail severity, formatting, fixtures, and root discovery.
- Canonical sources for machine comparison must be repo-resolvable at audit time. Historical paths named in docs, such as the old sugar3d `vida` asset paths, can be recorded as provenance only when the bytes are not present in this v2 worktree; they cannot be the comparison source unless they exist in-repo or are mirrored under `refs/`.
- "Warn first run, error once the manifest is complete" needs an explicit machine flag in the per-game manifest or companion metadata. Without a flag, the linter cannot distinguish an intentionally incremental manifest from a silently incomplete one.
- Perceptual comparison should reuse the `tools/refcap-compare/src/phash.mjs` signature/distance behavior where the referenced image type can be decoded by existing code. Unsupported asset types should fail clearly or use exact-byte/intentional-difference entries rather than silently skip.
- The font-size/family metrics file is hand-measured reference truth, not image analysis performed by the audit. The audit validates committed design tokens against that committed reference metrics file.

---

## Actors

- A1. Planner/implementer: adds the audit rule, manifest, fixtures, and marble_run data.
- A2. Future pipeline worker/conductor: runs `npm run audit` and needs failures to be deterministic, local, and actionable.
- A3. Game owner/designer: reviews manifest entries for intentional visual differences and font metric truth.
- A4. Linter: deterministic code in `tools/audit` that compares shipped assets, scans glyph stand-ins, and validates token metrics.
- A5. marble_run design surface: the first game whose `design/assets`, `design/copy.ts`, and design tokens become covered by the rule.

---

## Key Flows

- F1. Complete manifest audit
  - **Trigger:** `npm run audit` runs on a game whose asset-identity manifest declares itself complete.
  - **Actors:** A2, A4, A5.
  - **Steps:** The linter enumerates shipped design assets, loads the manifest, verifies every shipped asset has a mapping, compares each mapped source according to its expected mode, scans glyph stand-ins, validates token metrics, and reports any divergence as a hard error.
  - **Outcome:** A green audit means every covered shipped asset identity and reference metric is accounted for.
  - **Covered by:** R1, R2, R3, R4, R5, R8, R9.

- F2. Incremental manifest audit
  - **Trigger:** `npm run audit` runs while a game's manifest is explicitly marked incomplete.
  - **Actors:** A1, A2, A4.
  - **Steps:** The linter still enumerates missing mappings and divergences, but reports completeness-related findings as warnings where the manifest says the game is still being populated.
  - **Outcome:** The first landing can expose current debt without reddening the whole gate until the manifest is declared complete.
  - **Covered by:** R3, R6, R11.

- F3. Glyph stand-in detection
  - **Trigger:** A game copy module contains an emoji or pictographic value used where the reference expects artwork.
  - **Actors:** A4, A5.
  - **Steps:** The linter scans copy values, detects the glyph candidate, checks for an explicit manifest entry that names it as a glyph-vs-asset case, and emits a failure or warning based on manifest completeness.
  - **Outcome:** Text glyphs such as marble_run's sad-face fail icon cannot hide as ordinary copy.
  - **Covered by:** R4, R6, R12.

- F4. Font token metric validation
  - **Trigger:** `npm run audit` reads a game with a committed reference metrics file.
  - **Actors:** A3, A4, A5.
  - **Steps:** The linter reads the hand-measured reference metrics and validates the relevant design token font families and font sizes against it.
  - **Outcome:** A font regression is reported as a deterministic token mismatch, not deferred to visual review.
  - **Covered by:** R5, R7, R13.

---

## Requirements

**Manifest and coverage**
- R1. Each covered game must have an asset identity manifest at `games/<game>/design/asset-identity.json`.
- R2. The manifest must map every shipped file under `games/<game>/design/assets` to a canonical source, an expectation mode, and enough rationale/provenance for a reviewer to understand why that source is authoritative.
- R3. The audit must report `MISSING-MAPPING` for any shipped design asset without a manifest entry.
- R4. The audit must support at least these expectation modes: `exact-bytes`, `perceptual`, and `intentionally-different` with a non-empty reason.
- R5. For `exact-bytes`, the audit must compare byte hashes of the shipped file and source file and report `DIVERGENT` when they differ.
- R6. For `perceptual`, the audit must reuse `refcap-compare`'s perceptual signature/distance behavior and report `DIVERGENT` when the configured threshold fails.
- R7. For `intentionally-different`, the audit must not compare bytes as pass/fail, but it must require an explicit reason and include that exception in audit output or debug data so exceptions remain visible.
- R8. Manifest source paths used for machine comparison must resolve inside the repository. If a historical external/source-tree path is useful context, it must be provenance metadata rather than the only comparison source.

**Glyph-vs-asset coverage**
- R9. The audit must scan game design copy modules for emoji or pictographic glyph values that can stand in for reference art.
- R10. Every detected glyph-vs-asset case must have an explicit manifest entry that either maps it to a canonical asset source or marks it intentionally different with a reason.
- R11. marble_run's `result.lose.emoji` value must be reported by the audit until it is either replaced with reference artwork or documented as an intentional difference in the manifest.
- R12. Existing ordinary text copy must not become an asset-identity violation merely because it is user-facing text; the glyph rule is specifically for art-like glyph stand-ins.

**Font metrics**
- R13. Covered games must be able to commit a `reference-metrics.json` file under the game design/reference area that records hand-measured reference font families and font sizes relevant to design tokens.
- R14. The audit must validate configured design token font-family and font-size values against the committed reference metrics and report deterministic mismatches.
- R15. The marble_run seed data must cover the current display/body font family tokens and the UI font-size tokens that are material to the known reference-font drift.

**Audit integration and severity**
- R16. The new linter must run as part of the existing root `npm run audit` command and follow `tools/audit`'s existing result shape: hard errors fail the command, warnings print but do not fail.
- R17. A game whose manifest is explicitly incomplete may warn for missing mappings during the first run; once the manifest declares complete coverage, missing mappings and divergent exact/perceptual comparisons must be hard errors.
- R18. The marble_run manifest landed with this card's implementation must be complete enough to make `npm run audit` green while still exposing known current divergences as either warnings, hard errors in targeted tests, or documented intentional differences.
- R19. Linter messages must name the game, manifest entry or missing file, expectation mode, source path, and failure kind so a future worker can fix the right asset without rerunning with extra debug flags.

**Tests and fixtures**
- R20. `tools/audit` unit tests must include passing and failing fixtures for exact-byte identity, perceptual divergence, missing mappings, intentional differences without a reason, glyph-vs-asset detection, and font metric mismatch.
- R21. At least one test or fixture must prove the audit reports the marble_run sad-face emoji class before a fix or explicit exception is applied.
- R22. At least one test must prove the complete-manifest state escalates missing mappings from warning/incremental status to hard failure.
- R23. The implementation must avoid new npm dependencies unless planning explicitly justifies and gates them; deterministic local code or reuse of existing repo code is preferred.

---

## Acceptance Examples

- AE1. **Covers R1-R5, R16, R19.** Given a complete manifest maps `button-green.png` with `exact-bytes`, when the source bytes differ from the shipped bytes, `npm run audit` exits non-zero and reports `DIVERGENT` with both paths.
- AE2. **Covers R3, R17, R22.** Given a shipped design asset is absent from a complete manifest, when audit runs, it exits non-zero with `MISSING-MAPPING`; given the same game is explicitly incomplete, the same finding is printed as a warning.
- AE3. **Covers R6, R20.** Given two perceptual image fixtures that exceed the configured distance threshold, when audit runs, it reports a perceptual `DIVERGENT` finding using the shared `refcap-compare` signature/distance implementation.
- AE4. **Covers R7, R20.** Given a manifest entry is `intentionally-different` without a reason, when audit runs, it fails the entry as invalid rather than treating it as a pass.
- AE5. **Covers R9-R12, R21.** Given a copy module contains `result.lose.emoji: "😢"` and no glyph-vs-asset manifest entry covers it, when audit runs on the fixture or marble_run seed case, it reports a glyph-vs-asset finding.
- AE6. **Covers R13-R15, R20.** Given `reference-metrics.json` records a reference font family and size and the design tokens disagree, when audit runs, it reports a font metric mismatch naming the token and expected value.
- AE7. **Covers R16-R18.** Given the marble_run manifest is populated with all current shipped design assets plus documented current exceptions, when `npm run audit` runs at repo root, the land gate remains green while the known intentional differences remain visible.

---

## Success Criteria

- Future workers can answer "is this shipped asset the same as the in-repo reference?" by running `npm run audit`, not by rereading screenshots or old comments.
- marble_run has a committed, reviewable asset-identity manifest covering the current shipped design assets and the sad-face glyph stand-in.
- Known current divergences are either fixed or explicitly documented as intentional differences; no shipped `design/assets` file is unmapped.
- Font family and size drift becomes a deterministic token/metrics audit concern instead of only a visual review concern.
- The next planning worker has clear severity rules for first-run warnings versus complete-manifest errors.

---

## Scope Boundaries

- Do not build an autonomous visual judge. This audit is deterministic state plus actions; agents still decide how to fix findings.
- Do not require live device capture for this audit. Device visual verification remains required for visual changes, but asset identity comparison itself should be local and reproducible.
- Do not compare against paths that exist only in a developer's private checkout. Canonical comparison sources must be committed or mirrored into the repo.
- Do not solve every fidelity issue in the latest panel evidence. This card covers asset identity, glyph stand-ins, and font token metrics; layout, button text, ribbon geometry, and gameplay composition remain separate visual-fidelity work unless they are required to populate the manifest honestly.
- Do not open a pull request as part of this pipeline card; the conductor owns branch integration.

---

## Key Decisions

- Extend `tools/audit`: it already owns repo guardrails, root wiring, warnings versus errors, fixtures, and `npm run audit` integration.
- Make manifest completeness explicit: warning-first behavior needs a deterministic switch so it cannot become permanent quiet debt.
- Treat glyph art as asset identity, not copy: a crying emoji used as fail-screen art is exactly the class of reference-asset stand-in this audit exists to expose.
- Require repo-resolvable sources for pass/fail comparison: provenance alone is not enough for a machine check.
- Reuse `refcap-compare` perceptual hashing where perceptual comparison is needed, preserving the calibrated behavior already used for reference captures.

---

## Dependencies / Assumptions

- Existing audit package: `tools/audit/src/cli.js`, `tools/audit/src/lib.js`, and current linter/test patterns.
- Existing perceptual signature implementation: `tools/refcap-compare/src/phash.mjs`.
- Existing marble_run design assets and copy: `games/marble_run/design/assets`, `games/marble_run/design/copy.ts`, `games/marble_run/design/tokens.css`, and `games/marble_run/design/theme.ts`.
- Existing asset provenance and known debt: `docs/evidence/asset-swap-plan.md`, `docs/retros/fidelity-diff-mistakes-ledger.md`, and recent panel evidence under `docs/evidence/2026-07-07-2030-turn10-verify/`.
- Root wiring: `package.json` already exposes `"audit": "node tools/audit/src/cli.js"` and `tools/audit` is an npm workspace.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R2, R8, R18][Technical] Where should canonical per-sprite source bytes live when the only current source is historical prose naming the old sugar3d path? Planning should choose between mirroring sources under `games/marble_run/refs/` or marking those entries as intentionally different/provenance-only until sources are committed.
- [Affects R6, R20, R23][Technical] Which asset file types should support perceptual comparison in v1 of this linter, given `refcap-compare` currently decodes PNG captures? Planning should either constrain perceptual entries to supported formats or add justified decoder support.
- [Affects R13-R15][Needs research] What exact font metrics should be hand-measured from marble_run refs, and which token names are material enough for the first `reference-metrics.json`?
- [Affects R17, R18][Technical] What manifest field name should represent completeness so the warning-to-error transition is obvious to humans and easy for the linter to enforce?
