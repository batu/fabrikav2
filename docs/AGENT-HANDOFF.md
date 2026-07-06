# AGENT-HANDOFF — claim-gated verify enforcement layer

This document describes the **structural** verification enforcement added by card
`elkcIthD`. The point: AGENTS.md #7/#8 and the `verify-device` tool both route
through the agent's *judgment*, so verification stays skippable — and it was
skipped repeatedly (proxy substitution) and rubber-stamped. This layer moves
enforcement **from judgment to structure**. Everything here is DETERMINISTIC (no
LLM) and SELF-DISABLING (a no-op for non-game projects).

## The three pieces

All logic lives in `tools/verify-gate/` (a unit-tested Node workspace). The shell
hook is a thin shim that self-disables and delegates.

### 1. Claim-gated Stop hook
- **Shim:** `agents/hooks/verify-visual-claim.sh` (mirrored to `.claude/hooks/`
  by the standard sync — see "Activation" below).
- **Wired in:** `agents/settings.json` under a `Stop` hook.
- **Core:** `tools/verify-gate/cli.mjs` → `src/classify.mjs`.
- On turn end it reads the **last assistant message** from the transcript and
  **BLOCKS** (Claude Code Stop-hook `{"decision":"block"}`) **iff ALL** of:
  1. the message makes a **done-claim** (regex, case-insensitive:
     `done|verified|works|renders? correctly|looks right|matches the reference|pixel|fidelity|shipped|complete on device`,
     anchored to word boundaries so `abandoned`/`frameworks` don't false-fire);
  2. `git diff` vs the merge-base with `origin/main` (plus untracked files)
     touches a **visual glob**: `games/*/src/**`, `games/*/design/**`,
     `packages/ui/**`;
  3. there is **no fresh** verify-device evidence — no
     `docs/evidence/*device-verify*/panel.json` (or `games/*/evidence/**/panel.json`)
     with an mtime **newer** than the newest changed visual file;
  4. the message has **no `UNVERIFIED:` marker**.
- The block message names the changed visual files, the exact command
  `npm run verify-device -- --game <g>`, and cites AGENTS.md #8.
- **Gate on the CLAIM, not the file:** a refactor that touches a visual file but
  makes no done-claim does **not** block. This precision is the whole point and
  is unit-tested (`test/decide.test.mjs`, `test/classify.test.mjs`).

### 2. UNVERIFIED ledger (self-disabling escape hatch)
- When the last message contains `UNVERIFIED: <reason>`, the hook appends
  `{ts, changed_files, reason}` to `.work/verify-ledger.jsonl` and **does not
  block**. Skipping stays possible — but is **recorded, never silent**.
- Core: `src/ledger.mjs`.

### 3. Merge gate (ship-time backstop)
- `tools/verify-gate/merge-gate.mjs` (root script:
  `npm run verify-merge-gate`). For a diff that touches visual globs it
  **HARD-FAILS** (exit 1) when there is no fresh real `panel.json` covering the
  change — even if the ledger is full of `UNVERIFIED` entries. This is the
  ship-time backstop for the escape hatch. Fail-**closed** (an unexpected error
  is a hard fail), unlike the Stop hook which fails **open**.
- Conductors should run it in the landing gate for visual-touching cards.

## Self-disable (catalog-safe)
Both the shell shim and the Node cores exit as a no-op when
`tools/verify-device/cli.mjs` is absent **or** there is no `games/` dir. Safe to
promote catalog-wide to non-game projects — it simply does nothing there.

## Activation / sync
The card's footprint is `agents/**` (the source of truth). Claude Code loads the
**live** copies under `.claude/` (`.claude/settings.json`, `.claude/hooks/`),
which are byte-identical mirrors maintained by the `agents/ → .claude/` sync
(same as `block-destructive-git.sh`). This worker committed only the `agents/`
source; **the conductor's sync step must mirror `agents/hooks/verify-visual-claim.sh`
and the `Stop` hook in `agents/settings.json` into `.claude/`** to make the hook
live. Catalog promotion is a separate conductor step (do not touch the agency
repo).

## Tests
`npm test` (or `npm run test:unit -w @fabrikav2/verify-gate`) — 50 tests:
done-language detect (positive + negative incl. refactor-no-claim = NO BLOCK),
visual-glob match, evidence freshness (stale = block, fresh = pass), UNVERIFIED
bypass + ledger append, self-disable when tool/games absent, transcript parsing,
git diff/untracked plumbing, and both `decideStop`/`decideMerge` gates. The shell
hook delegates to this tested Node core — logic is unit-tested, not just bash.
