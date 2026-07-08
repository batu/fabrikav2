---
date: 2026-07-07
topic: orphaned-token-audit
trello: https://trello.com/c/CIa1Dlzp
card: CIa1Dlzp
stage: brainstormed
status: requirements-locked
---

# Orphaned Token Audit

## Summary

Add a deterministic `tools/audit` check that warns when a game design token defined in `design/tokens.css` has no static `var()` consumer in shared UI or the owning game source. The check keeps design-sheets edits honest: a designer changing a generated token should be able to trust that an audit warning will surface tokens that currently render nowhere.

---

## Problem Frame

The design-sheets round-trip now owns generated `games/<game>/design/tokens.css` files. That makes token edits easy, but it also makes silent drift easy: a token can remain in the sheet and generated CSS after the visible UI has migrated away from it, so a designer changes the sheet and nothing on screen responds.

The card calls out the recent `--fab-color-accent` drift as the motivating failure. Existing `tools/audit` checks enforce token-only UI code, asset identity, reference captures, structure, harnesses, and related guardrails, but none answer the liveness question: "does this generated token have any consumer left?" This work should add that missing static signal without turning every cleanup decision into a hard gate.

---

## Assumptions

*This requirements doc was authored without synchronous user confirmation. The items below are agent inferences that fill gaps in the input - un-validated bets that should be reviewed before planning proceeds.*

- The first implementation should be warning-only because the card explicitly requests `WARN 'orphaned token'`; root `npm run audit` should still exit 0 when orphaned-token findings are the only findings.
- A token should count as live when a direct `var(--token)` consumer exists in `packages/ui` or the owning `games/<game>/src`, or when a token alias chain in `tokens.css` reaches a token with such a consumer. Alias-only cycles or definitions with no downstream consumer should still warn.
- The check should scan each game's generated `games/<game>/design/tokens.css`, not `packages/ui/src/ui.css` neutral defaults as source design-token definitions.
- A consumer must be a real source reference, not a comment, not the token's own declaration, and not a design-file-only reference that never leaves the generated design layer.
- Intentional or transitional orphans should be allowlisted with a reason, not silently ignored. Stale allowlist entries should be visible so the allowlist does not become permanent hidden debt.

---

## Actors

- A1. Designer/reskin author: edits design sheets and expects generated token changes to affect visible UI.
- A2. Pipeline worker/planner: implements and validates the audit rule.
- A3. Future conductor/reviewer: reads `npm run audit` output and decides whether a token is intentional debt or a cleanup target.
- A4. Audit linter: deterministic code in `tools/audit` that extracts token definitions, finds consumers, applies allowlist rules, and emits warnings.
- A5. Game template and marble_run: the first real surfaces that must prove the rule works without breaking the audit gate.

---

## Key Flows

- F1. Orphan detection during audit
  - **Trigger:** A worker runs `npm run audit`.
  - **Actors:** A2, A3, A4.
  - **Steps:** The linter enumerates generated game token definitions, resolves direct and transitive consumers, applies documented allowlist entries, and reports remaining unconsumed tokens as warnings.
  - **Outcome:** Audit output names every unallowlisted token that currently has no static consumer.
  - **Covered by:** R1, R2, R3, R4, R5, R6, R8.

- F2. Intentional orphan handling
  - **Trigger:** A token is intentionally retained for a future sheet, reference contract, or external consumer not visible to the static scan.
  - **Actors:** A2, A3, A4.
  - **Steps:** The implementer adds an allowlist entry with the game, token, and reason; audit suppresses the orphan warning while still validating that the entry refers to a real token.
  - **Outcome:** Intentional debt is explicit and reviewable rather than lost in noisy output.
  - **Covered by:** R7, R9, R10.

- F3. Template protection
  - **Trigger:** A new game starts from `games/_template` or the template changes its design token set.
  - **Actors:** A1, A2, A4, A5.
  - **Steps:** The template's generated tokens are scanned against template source consumers; any unused token either gets a real consumer or a documented allowlist reason.
  - **Outcome:** New games inherit a clean token-liveness contract.
  - **Covered by:** R11, R12, R13.

---

## Requirements

**Token extraction and consumer resolution**
- R1. The audit must enumerate custom properties defined in each `games/<game>/design/tokens.css` file whose names match the project design-token namespace.
- R2. The audit must record the defining game, token name, source file, and line number for each token so findings are actionable.
- R3. The audit must search `packages/ui` and the owning `games/<game>/src` for `var(--token)` consumers using the same repo-root conventions as existing `tools/audit` linters.
- R4. The audit must not count comments, the token's own declaration, or generated design files as final consumers.
- R5. The audit must treat token-to-token aliases in `tokens.css` as live only when the alias chain reaches a token with a real consumer in the shared UI or owning game source.
- R6. Tokens with no direct or transitive consumer must produce a warning finding whose text includes `orphaned token`.

**Allowlist and severity**
- R7. The audit must support an allowlist for intentional orphaned tokens, with enough metadata to identify the game, token, and human reason.
- R8. Orphaned-token findings must use warning severity, matching existing `tools/audit` warning behavior: warnings print in `npm run audit`, but do not make the command fail.
- R9. Allowlisted orphaned tokens must not produce the normal orphan warning, but the allowlist entry must remain reviewable in source.
- R10. Stale or invalid orphan allowlist entries must be surfaced by audit output so removed or renamed tokens do not leave dead exceptions behind.

**Integration footprint**
- R11. The new check must be wired into the existing `tools/audit/src/cli.js` runner and formatted consistently with the current linter result output.
- R12. `tools/audit/README.md` must document the new token-consumers check, its warning severity, the consumer search scope, and the allowlist policy.
- R13. The first implementation must cover `games/_template` and `games/marble_run` honestly: any current orphan should either warn or have a documented allowlist reason.
- R14. The implementation must avoid new dependencies unless planning finds a clear need; CSS token and `var()` extraction should be deterministic and local.

**Tests and fixtures**
- R15. Unit tests must include a passing fixture where tokens are consumed by `packages/ui` and by a game `src` file.
- R16. Unit tests must include a warning fixture where a token is defined in `tokens.css` but has no consumer.
- R17. Unit tests must include an alias fixture proving a token is considered live when its alias chain reaches a consumed token, and orphaned when the chain reaches no consumer.
- R18. Unit tests must include an allowlist fixture proving intentional orphans are suppressed and stale allowlist entries are surfaced.
- R19. At least one test or integration assertion must prove the CLI prints `orphaned token` as a warning and still exits successfully when no hard errors exist.

---

## Acceptance Examples

- AE1. **Covers R1-R6, R8, R19.** Given `games/demo/design/tokens.css` defines `--fab-color-unused` and no scanned source contains `var(--fab-color-unused)`, when `npm run audit` runs, it prints a warning containing `orphaned token`, the game, token name, and definition location, then exits 0 if there are no hard errors.
- AE2. **Covers R3, R15.** Given `games/demo/design/tokens.css` defines `--fab-color-accent` and `packages/ui` contains a real CSS rule using `var(--fab-color-accent)`, when audit runs, that token produces no orphan warning.
- AE3. **Covers R3, R15.** Given `games/demo/design/tokens.css` defines `--fab-color-hud-panel` and `games/demo/src` contains a real rule or source string using `var(--fab-color-hud-panel)`, when audit runs, that token produces no orphan warning.
- AE4. **Covers R4, R17.** Given a token is referenced only in a comment or only in its own declaration, when audit runs, that reference does not satisfy the consumer requirement.
- AE5. **Covers R5, R17.** Given `--fab-color-outline` feeds `--fab-color-border` in `tokens.css` and `--fab-color-border` is consumed in scanned source, when audit runs, `--fab-color-outline` is treated as live; given the alias chain reaches no consumed token, both tokens warn unless allowlisted.
- AE6. **Covers R7, R9, R10, R18.** Given `--fab-future-sheet-token` is allowlisted with a reason, when audit runs, it does not emit the normal orphan warning; given the token is later removed from `tokens.css`, audit surfaces the stale allowlist entry.

---

## Success Criteria

- Designers and reviewers can run `npm run audit` and see which generated game tokens currently have no static path to visible UI code.
- The check preserves the existing audit contract: hard errors still fail the gate, while intentional cleanup warnings stay visible without blocking unrelated work.
- `games/_template` remains a trustworthy seed for new games because every generated token is either consumed or explicitly documented as intentionally orphaned.
- marble_run no longer relies on memory or ledger comments to notice token-consumer drift after sprite or UI migrations.
- The next planning worker has concrete severity, allowlist, fixture, and documentation requirements without needing to invent product behavior.

---

## Scope Boundaries

- Do not build a runtime visibility analyzer. This static check cannot prove a consumer is mounted or visible on a device; visual/runtime verification remains a later-stage responsibility.
- Do not require cleanup or deletion of every current orphan in the first implementation. The card asks for warnings and an allowlist, not a hard cleanup gate.
- Do not scan private v1 repos or the external design-sheets checkout. This check operates on committed files in this repo.
- Do not treat `packages/ui/src/ui.css` neutral token defaults as game design-token definitions. They are possible consumers, not the generated design surface being audited.
- Do not open a pull request as part of this pipeline card; the conductor owns branch integration.

---

## Key Decisions

- Add this as a `tools/audit` linter: the existing package already owns repo guardrails, root `npm run audit` wiring, warning severity, fixtures, and formatter conventions.
- Keep first-run severity at warning: the value is surfacing drift without blocking unrelated branches while the token set is still being cleaned up.
- Require a reasoned allowlist: intentional design-sheet placeholders are valid, but they must remain explicit source control decisions.
- Count transitive aliases only when they lead to real source consumers: this avoids false positives for semantic tokens that feed consumed aliases while still catching alias chains that render nowhere.

---

## Dependencies / Assumptions

- Existing audit architecture: `tools/audit/src/cli.js`, `tools/audit/src/lib.js`, `tools/audit/allowlist.json`, and per-linter test fixtures under `tools/audit/test/fixtures/`.
- Current generated token surfaces: `games/_template/design/tokens.css` and `games/marble_run/design/tokens.css`.
- Current consumer surfaces: `packages/ui/src/ui.css`, `packages/ui/src/*.ts`, `games/_template/src`, and `games/marble_run/src`.
- Existing root script: `package.json` exposes `"audit": "node tools/audit/src/cli.js"`.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R1, R3][Technical] Which exact file extensions should count as consumer files beyond CSS and TypeScript, and should the check reuse `SOURCE_EXTS` plus `.css` from existing audit helpers?
- [Affects R7-R10][Technical] Should orphaned-token allowlist entries live in the existing `tools/audit/allowlist.json` under a new key, or in a dedicated token-consumers allowlist file to keep exception schemas separate?
- [Affects R5, R17][Technical] How much CSS parsing is needed for alias chains versus a simple comment-stripped declaration scanner that recognizes `--fab-*` declarations and `var(--fab-*)` references?
