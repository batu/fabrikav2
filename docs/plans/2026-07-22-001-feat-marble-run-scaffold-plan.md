---
title: "feat: scaffold games/marble_run from shell_template"
date: 2026-07-22
type: feat
origin: Trello card HOttWphz (MRV2-1) — card description is the product contract
trello: https://trello.com/c/HOttWphz
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
depth: standard
---

# feat: Scaffold games/marble_run from shell_template

## Summary

Create `games/marble_run` as a rebranded copy of `games/shell_template` (find_the_dog's commercial shell with the Win/Lose stub inner game): package `@fabrikav2/marble_run`, appId `com.basegamelab.marblerun`, display name "Marble Run". No engine, assets, or screens are ported — placeholder art stays. Exit bar: typecheck + unit lane green for the new package and zero `shell_template`/find_the_dog naming survivors outside comments.

## Problem Frame

MRV2 rebuilds fabrika v1's Sugar3D/Marble Run (canonical source: `fabrika/games/marble_run/sugar3d`, appId `com.basegamelab.marblerun`) pixel-faithfully on the fabrikav2 stack. This first card only lays the workspace foundation: a booting shell-first game package that later cards fill with the real engine and art.

## Key Technical Decisions

- **KTD1 — Manual copy of `games/shell_template`, not `tools/create-game`.** create-game stamps from `games/_template`, a thin scaffold without the full commercial shell (`src/ads`, `analytics`, `shop`, `bootstrap.ts`, `public/levels`, …). The card names shell_template as the source; a diff confirms _template diverges substantially. Copy manually and mirror create-game's substitution list (`package.json`, `game.config.ts`, `index.html`, `capacitor.config.ts`, `native-resources/`, `README.md`).
- **KTD2 — Package name `@fabrikav2/marble_run`** (snake_case), matching every sibling (`@fabrikav2/find_the_dog`, `@fabrikav2/block_blast`, …). The card's `@fabrikav2/marble-run` suggestion yields to local convention, as the card itself instructs.
- **KTD3 — appId is exactly `com.basegamelab.marblerun`** per the card, not shell_template's `.dev`-suffixed pattern (`com.basegamelab.shell_template.dev`). This matches the v1 shipped appId and the `refs/manifest.yaml` reference package. Flag in the handoff that the `.dev` suffix convention was consciously dropped.
- **KTD4 — Preserve existing `games/marble_run/refs/` and `games/marble_run/evidence/`.** The directory already holds v1 reference captures and the refcap-compare `manifest.yaml`. The copy must merge around them: never overwrite or delete anything already under `games/marble_run/`, and do not copy `shell_template/refs/` (its `manifest.yaml` would clobber the marble_run one) or `shell_template/evidence/` (foreign device evidence).
- **KTD5 — Exclude `design/candidates/` (~87 MB) plus `node_modules`, `dist`, `coverage`.** Candidates are shell_template's historical generation artifacts, not build inputs; duplicating them bloats the repo for zero function. The live design sheet (`design/assets.ts`, `design/assets/`, lists, `asset-identity.json`, `asset-specs/`) is the placeholder art the card says to keep — it copies over. Before committing, verify nothing under `src/` or `design/assets.ts` imports from `design/candidates/`.
- **KTD6 — No root workspace edits expected.** Root `package.json` workspaces already include the `games/*` glob, and there is no root tsconfig references graph. The only root-level change should be `package-lock.json` growth from `npm install` registering the new workspace — that is the "minimal root workspace wiring" the scope fence allows.

## Scope Boundaries

**In scope:** `games/marble_run/**` (new package files), `package-lock.json` regeneration.

**Out of scope (later MRV2 cards):** porting the v1 engine/gameplay, real Marble Run assets or screens, device shells (`npx cap add ios`), device verification, App Store metadata beyond the identity strings. Do not touch other games or shared packages. Anything outside the fence is a SURPRISES item, not a change.

---

## Implementation Units

### U1. Copy shell_template into games/marble_run

**Goal:** All shell_template package files exist under `games/marble_run/` alongside the pre-existing `refs/` and `evidence/` dirs, still bearing template naming (rebrand is U2).

**Files:** `games/marble_run/**` (new: `package.json`, `game.config.ts`, `capacitor.config.ts`, `index.html`, `vite.config.ts`, `vitest.config.ts`, `playwright.config.ts`, `tsconfig.json`, `eslint.config.js`, `src/`, `tests/`, `public/`, `design/` sans `candidates/`, `content/`, `docs/`, `native-resources/`, `README.md`).

**Approach:** Copy with explicit excludes per KTD4/KTD5: skip `node_modules`, `dist`, `coverage`, `design/candidates`, `refs`, `evidence`. Copy into the existing `games/marble_run/` without deleting anything already there.

**Test scenarios:** Test expectation: none — pure file copy; U4 verifies the result. Spot-check after copy: `games/marble_run/refs/manifest.yaml` still says `game: marble_run`, and `games/marble_run/design/candidates` does not exist.

**Verification:** `git status` shows only additions under `games/marble_run/`; pre-existing refs/evidence files unmodified.

### U2. Rebrand identity strings

**Goal:** Every game-identity value names Marble Run; zero non-comment `shell_template`/`find_the_dog` survivors.

**Dependencies:** U1.

**Files (survivor map from grepping shell_template; comment-only hits may stay):** `package.json` (name → `@fabrikav2/marble_run`), `game.config.ts` (id → `marble_run`), `capacitor.config.ts` (appId → `com.basegamelab.marblerun`, appName → `Marble Run`), `index.html`, `design/copy.ts` (`game.title` value → "Marble Run"), `README.md`, `native-resources/README.md`, `design/asset-identity.json`, `design/assets.ts`, `design/ASSET-LIST.md`, `src/` hits (`bootstrap.ts`, `config/cdn.ts`, `config/KeymasterConfig.ts`, `platform/StoreMetadata.ts`, `shop/IapService.ts`, `attribution/AttributionService.ts`, `analytics/*.ts`, `scenes/GameScene.ts`, `core/GameState.ts`, `ui/shareWin.ts`, `ui/RatePrompt.ts`, `testing/TestHarness.ts`, `data/*`, `v1core/ui/*`), `tests/**` hits, `docs/*.md`, `public/levels/**` (`stub_level_*` ids are generic stubs — rename only if they embed template naming).

**Approach:** Re-run the survivor grep (`grep -rniE 'shell_template|shell-template|shell template|find_the_dog|findthedog' games/marble_run`) inside the new package and fix each hit: identifiers/ids/config values must change; explanatory comments referencing the template lineage may remain (card: "zero survivors outside comments"). Do not rename shell architecture concepts (e.g. generic "shell" wording) — only template/FTD identity.

**Test scenarios:** The inherited unit suite (`tests/unit/*.test.ts`) is the behavioral net — any id it asserts (game id, analytics ids, harness flow) must be updated coherently, not force-passed. Survivor grep over `games/marble_run` returns comment-only hits.

**Verification:** Grep output attached to the eventual handoff listing every remaining hit with justification (all comments).

### U3. Register the workspace

**Goal:** npm knows the new package; lockfile updated.

**Dependencies:** U2.

**Files:** `package-lock.json` (root).

**Approach:** `npm install` from repo root. Expect no `package.json` workspaces edit (KTD6); if one turns out to be needed, that is still inside the card's "minimal root wiring" allowance.

**Test scenarios:** Test expectation: none — config/registration; U4 is the proof.

**Verification:** `npm ls @fabrikav2/marble_run` (or `npm run typecheck -w @fabrikav2/marble_run` resolving) succeeds.

### U4. Green lanes and boot proof

**Goal:** The card's acceptance: typecheck + unit green for the package; app boots to the stub scene with all shell pages reachable.

**Dependencies:** U3.

**Files:** none new (fixes fold into U2 files if lanes surface misses).

**Approach:** Run, and report verbatim in the handoff: `npm run typecheck -w @fabrikav2/marble_run`, `npm run test:unit -w @fabrikav2/marble_run`, plus repo `npm run audit` if the audit lane covers games (create-game README says scaffolds must pass it). Boot proof for this scaffold card: `vite build` succeeding plus the inherited unit smoke/harness tests covering the shell screens — an actual on-device run is not this card's deliverable (no native shell exists yet; later MRV2 cards own device verification). State that limit explicitly in the handoff rather than claiming device-verified boot.

**Test scenarios:** Existing inherited suite passes unmodified in intent (updated ids only). No new tests required for the scaffold.

**Verification:** All commands exit 0; outputs quoted in the card handoff.

---

## Verification Contract

1. `npm run typecheck -w @fabrikav2/marble_run` → exit 0.
2. `npm run test:unit -w @fabrikav2/marble_run` → exit 0.
3. `npm run build -w @fabrikav2/marble_run` (vite build) → exit 0 (boot-capable bundle proxy; device boot deferred to later cards).
4. Survivor audit: `grep -rniE 'shell_template|shell-template|shell template|find_the_dog|findthedog' games/marble_run --include='*.ts' --include='*.json' --include='*.html' --include='*.md' --include='*.js'` → every hit is a comment; list all hits in the handoff.
5. Pre-existing `games/marble_run/refs/**` and `evidence/**` byte-identical to before (git shows no modifications there).

## Definition of Done

`games/marble_run` exists as `@fabrikav2/marble_run` with appId `com.basegamelab.marblerun` and display name "Marble Run"; template placeholder art retained; refs/evidence untouched; verification contract items 1–5 all green and reported; no changes outside `games/marble_run/**` + `package-lock.json`.

## Assumptions

- The `.dev` appId suffix is intentionally dropped (KTD3, card-explicit value wins). Surface in handoff.
- `design/candidates/` exclusion (KTD5) is acceptable as repo-hygiene; if the implementer finds a build-time reference to it, copy the referenced subset instead and note the surprise.
- `public/levels/stub_level_*` stubs stay as-is; they are generic, not template-branded.
