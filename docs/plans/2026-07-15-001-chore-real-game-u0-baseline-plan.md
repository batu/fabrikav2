---
title: "Real-game editor U0 verified baseline - Plan"
type: chore
date: 2026-07-15
topic: real-game-editor-u0-baseline
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: docs
origin: goal.md
trello: https://trello.com/c/81E78eqU
---

# Real-game editor U0 verified baseline - Plan

## Objective

Freeze the verified starting state for the real-game UI round-trip goal before Marble Run editor work begins. The artifact must separate current facts from historical proof, classify old editor work as reusable plumbing or invalid authority, and record honest device, Portal, PixelSmith, capacity, and ledger boundaries.

## Work

1. Record the exact `origin/main` and goal-branch SHAs that define this baseline.
2. Classify the prior generic Phaser and GrapesJS artifacts without importing or changing them.
3. Record current read-only checks for installed Phaser Editor, connected devices, Android checkout provenance, Portal exposure/durability, PixelSmith capabilities, and provider leases.
4. Point to the machine-local per-agent ledger and repo-local mechanical event stream.
5. Publish reproducible, read-only commands and explicitly name the gates that remain unproven.

## Acceptance

- `docs/reports/2026-07-15-real-game-editor-u0-baseline.md` exists and contains no credentials or tokens.
- The report says that no Marble Run mapping exists in either editor.
- Prior generic persistence is not misrepresented as Marble persistence or current-main behavior.
- Both currently connected devices are described accurately, and the Android remote checkout is rejected as provenance evidence.
- Portal and PixelSmith limitations are explicit.
- Markdown links resolve and the worktree contains only this bounded documentation work.

## Verification

Run the read-only command set embedded in the report, then:

```sh
test -f docs/reports/2026-07-15-real-game-editor-u0-baseline.md
rg -n "No Marble Run mapping exists|NEVER run `pixelsmith generate`|not provenance-safe" docs/reports/2026-07-15-real-game-editor-u0-baseline.md
git diff --check
git status --short
```

No editor implementation, device build, Portal deployment, branch merge, or provider-lease mutation belongs to U0.
