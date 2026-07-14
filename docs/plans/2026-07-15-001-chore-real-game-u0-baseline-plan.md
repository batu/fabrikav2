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
5. Prove editor-native save/reopen persistence independently in raw GrapesJS project data and a licensed Phaser Editor native scene, without claiming Marble mapping or mouse-driven ergonomics.
6. Build Marble Run from a clean exact-`b53b9b04` source snapshot, install and cold-launch it on the live Android device, dwell for delayed UI, and capture the primary menu with source/APK/screenshot provenance.
7. Curate the reports, selected machine-readable results/logs, and screenshots under a hashed evidence directory while omitting the APK and scanning for credentials, tokens, and private URLs.
8. Publish reproducible, read-only commands and explicitly name the gates that remain unproven.

## Acceptance

- `docs/reports/2026-07-15-real-game-editor-u0-baseline.md` exists and contains no credentials or tokens.
- The report says that no Marble Run mapping exists in either editor.
- Prior generic persistence is not misrepresented as Marble persistence or current-main behavior.
- Both currently connected devices are described accurately, and the Android remote checkout is rejected as provenance evidence.
- Portal and PixelSmith limitations are explicit.
- Raw GrapesJS native project data retains stable component/semantic identity, text, style, and hash across a full browser/server restart.
- A licensed Phaser Editor native `.scene` retains stable object identity, position, copy, native authority hash, and deterministic generated graph across a full editor-server restart.
- A fresh source snapshot at exact commit `b53b9b04e7dbfdda9404f55cb12047e02af5af80` builds, installs, cold-launches, and yields a delayed live-device menu capture with recorded APK and screenshot hashes.
- Evidence is committed under `docs/evidence/2026-07-15-realgame-editor-preflight`, hashes verify, the APK is omitted, and no Marble mapping or fidelity claim is made.
- Markdown links resolve and the worktree contains only this bounded documentation-and-evidence work.

## Verification

Run the read-only command set embedded in the report, then:

```sh
test -f docs/reports/2026-07-15-real-game-editor-u0-baseline.md
rg -n 'No Marble Run mapping exists|NEVER run .*pixelsmith generate.*|not provenance-safe|Native GrapesJS persistence|Exact-SHA Android preflight' docs/reports/2026-07-15-real-game-editor-u0-baseline.md
test -f docs/evidence/2026-07-15-realgame-editor-preflight/SHA256SUMS
(cd docs/evidence/2026-07-15-realgame-editor-preflight && shasum -a 256 -c SHA256SUMS)
file docs/evidence/2026-07-15-realgame-editor-preflight/android/menu.png
git diff --check
git status --short
```

U0 includes only disposable editor-native persistence proof and the exact-SHA Android build/install/capture preflight. No Marble editor implementation, Portal deployment, branch merge, or provider-lease mutation belongs to U0.
