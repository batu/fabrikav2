---
title: "Phaser-native Shell Runtime + Immutable Apply (DUAL U6) - Plan"
type: feat
date: 2026-07-12
topic: dual-u6-phaser-native-runtime-apply
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: goal.md
execution: code
origin: goal.md
origin_commit: 2ec08c51
origin_branch: experiment/dual-design-frontends
trello: https://trello.com/c/s1P6oJI2
depends_on:
  - gJtZP63y   # U5 — Phaser Editor authoring + portable publisher (produces the publications U6 consumes)
---

# Phaser-native Shell Runtime + Immutable Apply (DUAL U6) - Plan

## Goal Capsule

- **Objective:** Render the functional seven-surface shell (`menu, level, shop, settings, pause, win, fail`) entirely through Phaser 4, bound to the same frozen `TemplateShellController` + fake `TemplateSdk` the DOM lane uses, and prove the identical immutable **P0 / A / B / B** application contract — a valid A applies, distinct B over A applies, and reapplying B is a true byte/mtime/git no-op — with the same typed outcome vocabulary as the Grapes/DOM lane.
- **Product authority:** Batu approves the experience side-by-side on the physical Android device (a later U7/U8/U10 gate). This card owns the Phaser **runtime / projection / application** lane only; it consumes U5's accepted `phaser-native` publications and never re-authors them. The landed `shell-presentation-v2` kernel contract owns geometry, identity, publication/projection IDs, and profile artifact rules; U6 reuses them and introduces no third design document.
- **Execution profile:** Deep, single-lane implementation with one hard upstream dependency (U5 publications) and one conductor-owned shared-surface prerequisite (renderer-fence unfreeze; see Preconditions). All work lands to `experiment/dual-design-frontends`. The conductor runs the first live Phaser-in-WebGL shakedown; U10 (not U6) adds device coordinate bridging.
- **Stop conditions:** Stop with a named `comparison_blocked`/`no-go` handoff — never a workaround — if: U5 has not landed an accepted publication for U6 to consume; the renderer-fence unfreeze prerequisite has not landed; Phaser 4 explicit-WEBGL cannot boot in the target environment (no `AUTO` fallback); or texture/font readiness cannot be observed deterministically before `ready`. Do not begin U10 device bridging, warm-propagation timing, or scored sessions here.

## Product Contract

### Summary

Turn accepted `phaser-native` Editor publications (from U5) into an immutable DOM-parity runtime that draws the whole shell in one persistent explicit-WEBGL `Phaser.Game`, selects exactly one revision through an atomic pointer, and exposes renderer-neutral evidence (state, revision, CSS-client action rectangles, post-paint readiness) without any DOM shell. The behavior source (controller, SDK, catalog, harness, in-situ tour) is a read-only lane input; U6 only re-projects it through Phaser and proves the deterministic apply loop.

### Problem Frame

The Phaser lane must be behaviorally and semantically indistinguishable from the Grapes/DOM lane at the contract level, while being a genuinely different renderer (canvas, not DOM). Three hazards define the work:

1. **No DOM crutch.** The current `games/shell_proof_phaser/src/shell/` is the U1-seeded **DOM** renderer (`TemplateShell.ts` + `template-shell.css`) frozen byte-identical to the Grapes twin. Reusing any of it — or exposing `data-fab-*` DOM hooks as the evidence source — is "DOM-shell reuse disguised as Phaser-native" and is disqualifying. The Phaser renderer must derive the same action identities and rectangles from **live display objects**.
2. **Immutable apply parity.** U6 must reproduce, for the `phaser-native` profile, the same fail-closed preflight → immutable `design/revisions/<projectionId>/` → atomic `design/revision.json` → deterministic ledger → drift audit loop the DOM lane (U4) implements, with byte/mtime/git-clean no-op on B-over-B and the negative asset-identity control preserving the prior revision.
3. **Deterministic readiness on an async renderer.** Phaser loads textures/fonts asynchronously and re-renders on its own clock. `ready` must be scoped to `(projectionId, state, epoch)` and asserted only after zero loader failures, all required resources/actions/bindings resolved, Shop init, a visible sentinel, and the next `POST_RENDER`. Scene `create()`/`READY` alone is insufficient, and every async result must be epoch-guarded so a stale texture/Shop callback cannot satisfy a newer state's readiness.

### Requirements (traceability to goal.md#U6)

- **R1–R6 (product slice):** All seven surfaces render as distinct, drivable, capturable Phaser compositions; Pause is a distinct composition from Settings; Shop is a real scrollable surface wired to `controller.sdk.iap`; the placeholder `level` keeps its mechanic-mount region plus Test Win / Test Lose; the optional second-currency counter shows the synthetic `snapshot.secondaryCurrency` (=12). Shared 390×844 design system, baseline safe-area, 48 px min action, controller state, synthetic SDK data, curated Kenney rasters, fonts, copy seed, and semantic role/slot catalog are used unchanged.
- **R11–R13 (authority & portability):** Phaser Editor `.scene` state (via U5's publication) is the only editable visual authority; the runtime projection, previews, and evidence are derived records, never hand-edited back into authority. U6 compiles/validates accepted publications into an immutable `phaser-native` v2 revision that identifies its renderer profile, typed editor-source hashes, asset-catalog hash, artifacts, and source asset hashes. The runtime builds and runs offline without Phaser Editor or its account; no license/credential/machine-path bytes enter git, logs, or ledger.
- **R14–R18 (application):** Human-only and agent-assisted sessions apply matched accepted revisions with no raw-source edits; an unrepresentable request returns `unsupported-intent` and never hand-patches a projection or runtime; the same local commands `validate / publish / preflight / apply / status / proof` exist with the same typed outcomes `applied / no-op / blocked-drift / invalid-revision / unsupported-intent`; **P0/A/B/B** preserves behavior source, selects only complete validated output, and makes the second B a filesystem no-op.
- **R19, R22–R23, R26–R27, R30–R31 (parity, exit, discipline):** U6 exposes the renderer-neutral probe and a Phaser-rendered revision sentinel so U7 parity and U10 device proof can consume them (U6 does not itself claim device readiness); cross-lane parity is semantic/behavioral, not pixel equality; a clean-checkout, network-disabled rebuild reproduces B without Phaser Editor or cached output after a separately recorded dependency-prep step; all work stays inside the Phaser lane fence.

### Acceptance Examples (goal.md)

- **AE1 (R1–R6):** Driving Menu → Shop → Settings → Play → Pause → Win → Fail through the shared controller yields seven distinct Phaser surfaces; Shop uses the fake provider; Pause ≠ Settings; Win/Fail preserve shared progression; the second-currency counter shows the same synthetic state as the DOM twin.
- **AE3 (R10–R12):** A publication that hides a required action, assigns an incompatible raster, injects active content/remote URL/unsafe path, or moves an action outside the safe region returns a **typed block** and leaves the prior selected projection unchanged.
- **AE4 (R14–R18):** Applying A, then B over A, then B again yields two complete distinct revisions and a true no-op; behavior hashes stay fixed; each ledger names every intervention.
- **AE5 (R19, R22–R23, R26, R31):** After local parity, the runtime reports the exact revision plus a host-verified screenshot sentinel; a runtime echo or browser-only success cannot substitute (device proof is U10, but U6 must emit the sentinel it consumes).
- **AE7 (R27–R29):** With Phaser Editor and network unavailable, rebuilding the committed proof game from its portable accepted revision reproduces the accepted shell.
- **AE8 (R30–R32):** A lane-fence or shared-file violation blocks the card before landing; any evidence is private and scrubbed.

### Scope Boundaries

**In scope:** the `phaser-native` runtime renderer over the frozen controller/SDK; the projection/preflight/apply/status/proof application loop under `tools/phaser-shell/src/application/`; immutable `design/revisions/**` + atomic `design/revision.json`; the Phaser evidence-probe readers (CSS-client action rectangles, post-paint readiness, revision sentinel); hash-bound renderer-local offline references under `refs/`; the vendor-exit offline build; unit/render/lifecycle/A-B-B/security/offline tests.

**Out of scope (belongs to other units — do not start):** re-authoring or editing publications (U5); Android WebView evaluation, coordinate-to-screen bridging, real-tap actuation, and warm-propagation timing (U10); cross-lane parity aggregation and the unscored agent dry-run gate (U7); physical-device use and the decision report (U8/U9); any change to `_template`, `create-game`, existing games, the v1 contract, or shared/root dependencies.

### Assumptions (stated because they change the outcome)

- **A1 — U5 publication shape is authoritative but not yet landed.** This plan targets the U5 publication contract as specified in U5's plan (`authoring/publications/<publicationId>/` = `ShellPublishedRevisionV2` record + portable full-file manifest + canonical bundle `scenes/*.js`, `scene-manifest.json`, `asset-pack.json`, `asset-identity.json`, `assets/*.png`). If the landed U5 output diverges from this shape, U6's projection/bundle-ingest step reworks against the real artifact. **U6 must not start building until an accepted U5 `publicationId` exists on the integration branch.**
- **A2 — The kernel v2 `phaser-native` profile and geometry resolvers are landed and frozen** (verified: `packages/kernel/src/shellContract.ts`, `packages/kernel/contracts/shell-presentation.v2.json`). U6 consumes them read-only.
- **A3 — The conductor-owned renderer-fence unfreeze (Precondition P0 below) lands before U6.** Without it, U6 cannot legally diverge `src/shell` / `src/main.ts` or add `design/revisions/**` without breaking the shared frozen-behavior guard.
- **A4 — Explicit WEBGL boots in the CI/sandbox and (via conductor) the Android WebView.** If not, the correct outcome is a named blocked/no-go, never an `AUTO` fallback.

## Planning Contract

### Key Technical Decisions

- **KTD1 — One persistent explicit-WEBGL `Phaser.Game`; swap compositions, never the canvas.** Boot a single `Phaser.Game` with `type: Phaser.WEBGL` (no `AUTO`) and the Scale Manager in `FIT` portrait against the canonical 390×844. Apply changes the *active seven-surface composition* by loading/selecting the new revision's scenes into the live game; it never destroys/recreates the `Phaser.Game` or its canvas. This satisfies "keep one canvas alive" and the warm-propagation seam U10 later measures.
- **KTD2 — Pull-model renderer bound through the frozen `harness.render` callback.** The controller is pull-only (`snapshot()` + boolean verbs, no observer). The Phaser renderer exposes a `render()` that re-reads `snapshot()` and repaints the active scene; it is passed to the frozen `createTemplateHarness({ render })` and invoked after every mutating verb — exactly the DOM lane's `controller.<verb>(); render();` discipline, with zero controller/harness byte changes.
- **KTD3 — Reuse kernel geometry; never reimplement anchor/safe-area math.** Place every semantic instance by calling `projectShellGeometry({ anchor, geometry, viewport, caps, assetSize })` (and `normalizeShellGeometry` where authored px must be normalized), sourced from the contract's `instances[]` per-state `defaultPresentation.geometry`. Honor `canonicalCanvas` (390×844, `baselineInsets`, `baselineSafeRect`) and per-role `minimumTouchTarget: 48`.
- **KTD4 — Evidence via injected Phaser readers in CSS-client space.** Register `createShellEvidenceProbe({ gameId, contractId: "shell-presentation-v2", rendererProfile: "phaser-native", readers })` and assign it to `window[evidenceProbeWindowKeyForGame(gameId)]`. The `actions()` reader projects each interactive display object's bounds through camera → container → canvas placement → Scale-Manager FIT into **CSS-client pixels** (the coordinates a real pointer event carries), emitting `{ actionId, instanceId, x, y, width, height, visible, disabled }`; `devicePixelRatio` is reported only in `viewport`. No world/backing-store/DPR-multiplied coordinates. Actions are addressed by `(actionId, instanceId)`; duplicate `play` actionIds across instances are legitimate.
- **KTD5 — Epoch-guarded readiness scoped to `(projectionId, state, epoch)`.** Increment an epoch counter on every state change and every apply. `ready` returns true only after: zero loader failures, all required resources/actions/bindings for the state resolved, Shop `iap` init settled (for `shop`), the visible revision sentinel drawn, and the next `POST_RENDER` for the current epoch. Every async texture/font/Shop callback checks its captured epoch before mutating readiness or the scene, so a stale result cannot satisfy a newer state.
- **KTD6 — Mirror the DOM application loop for the `phaser-native` profile.** Implement `tools/phaser-shell/src/application/` as fail-closed `preflight/apply/status/proof` primitives that resolve only explicit `publicationId`/revision inputs, ingest and re-validate the U5 bundle against the `phaser-native` profile, compute the projection id via `computeShellProjectionIdV2` (binding `sourcePublicationId`), stage the candidate in gitignored `.work/`, write the immutable `design/revisions/<projectionId>/` (artifacts `scenes/*.js`, `scene-manifest.json`, `asset-pack.json`, `asset-identity.json`, `assets/*.png`), atomically replace `design/revision.json`, and emit a deterministic ledger. B-over-B is a true no-op (no writes, empty delta, git clean); failure preserves the prior pointer; hand-edited generated bytes → `blocked-drift`.
- **KTD7 — Individual source raster identity preserved.** Load approved individual raster bytes per `asset-identity.json` (`{ instanceId, slotId, assetId, path, sha256 }`); do not atlas or derive textures unless U2 proved a deterministic identity-preserving derivative is required (it did not; default to individual bytes). The negative asset-identity control (swap a raster's bytes under a valid-looking binding) must fail the drift audit and preserve the prior revision.
- **KTD8 — Renderer-local, revision-bound references.** Generate `phaser-native` expected references under `games/shell_proof_phaser/refs/` hash-bound to publication id, projection id, renderer fingerprint, viewport, and safe-area profile before any device run. A judged device capture can never become its own expected reference, and revision A's references cannot verify B.

### High-Level Technical Design

**Two cooperating pieces:** (1) the **runtime renderer** in `games/shell_proof_phaser/src/shell/` (replaces the DOM projection) and (2) the **application lane** in `tools/phaser-shell/src/application/` (produces/selects immutable revisions). They meet at the on-disk `design/revision.json` pointer + `design/revisions/<projectionId>/` bundle that the runtime loads on boot and after each warm apply.

Frozen reuse vs. lane-owned (verified against `baseline/behavior-hashes.json`):

| File | Role | U6 disposition |
|---|---|---|
| `src/core/TemplateShellController.ts` | frozen controller (pull-only) | reuse byte-for-byte |
| `src/sdk/TemplateSdk.ts`, `src/sdk/proofShopCatalog.ts` | fake SDK + catalog | reuse byte-for-byte |
| `src/shell/harness.ts`, `src/shell/insituTour.ts` | renderer-agnostic harness/tour | reuse byte-for-byte (pass Phaser `render`) |
| `src/shell/TemplateShell.ts`, `src/shell/template-shell.css` | **DOM renderer** | **replace** with Phaser scenes |
| `src/main.ts` | boot + probe wiring | **diverge**: mount Phaser game, `rendererProfile: "phaser-native"`, Phaser probe readers, Phaser post-paint `ready` |
| `packages/kernel` geometry/registry, `packages/testkit` `createShellEvidenceProbe` | shared kernel/testkit | reuse read-only |

**Runtime architecture:** a boot module creates the explicit-WEBGL `Phaser.Game`; a revision loader reads `design/revision.json` → loads `design/revisions/<projectionId>/scene-manifest.json` → registers the seven scenes; a surface router maps `snapshot.surface` to the active scene/composition and repaints on `render()`; a semantic layer binds each interactive display object to `(actionId, instanceId)` with `disabled/visible` derived from snapshot state and wires pointer handlers to the controller verbs; a Shop scene consumes `controller.sdk.iap` (init/catalog/restore) with epoch-guarded results; a probe adapter implements the five evidence readers; a scene-isolation wrapper ensures one scene's failure cannot prevent others or corrupt the evidence bridge.

**Application-lane architecture:** `preflight` (resolve explicit publicationId, re-validate bundle against `phaser-native` profile via `parseProjectionRevisionV2`/`parseShellPublishedRevisionV2`, check state-family completeness + required actions + accessibility + safe-area after anchor mapping, block before writes), `apply` (stage in `.work/`, compute projectionId, write immutable revision dir, atomic pointer swap, ledger), `status` (report current pointer/revision/outcome), `proof` (regenerate + byte-diff drift audit, negative controls). Typed outcomes `applied/no-op/blocked-drift/invalid-revision/unsupported-intent`; kernel `ShellValidationIssue` codes (`unknown-profile/profile-mismatch/missing-artifact/unsafe-artifact/compatibility-mismatch`) map into `invalid-revision`/`unsupported-intent`; drift maps to `blocked-drift`.

### Preconditions & Dependencies (READ FIRST — U6 is blocked until these clear)

- **P0 — Conductor-owned renderer-fence unfreeze (SHARED SURFACE; U6 cannot do this in-lane).** The landed `frozen-behavior.test.ts` freezes all of `src`, `design`, `content`, `tests/unit` **byte-identical across both twins** and against `experiments/design-frontends/baseline/behavior-hashes.json`. U6 must (a) diverge `src/shell/**` and the renderer bootstrap in `src/main.ts`, and (b) add `design/revisions/**` + `design/revision.json`. Both break the guard, and the guard file + baseline + `fences.json` are shared/conductor surfaces the U6 hard constraints bar U6 from editing. A single conductor-owned integration card must, **atomically across both `shell_proof_grapes` and `shell_proof_phaser`**: carve renderer files (`src/shell/**`, renderer portion of `src/main.ts`) and `design/revisions/**` + `design/revision.json` out of the frozen byte-walk (keeping `src/core`, `src/sdk`, `content`, `design` seed, and behavior tests frozen); reseal `baseline/behavior-hashes.json`; and extend `fences.json` `lanes.{grapes,phaser}.writable` to include each lane's renderer + runtime tests. Both lanes rerun their gates. This is symmetric with the DOM lane's U4 need; sequence it once, before dispatching either renderer build. (U5's plan names the same carve-out as its S3 prerequisite.)
- **P1 — U5 must land an accepted `phaser-native` publication.** U6 consumes an explicit verified `publicationId` under `games/shell_proof_phaser/authoring/publications/<publicationId>/`. As of this plan, U5 (`gJtZP63y`) has landed only its plan doc — no `authoring/` tree exists. U6's build cannot begin until an accepted publication exists on `experiment/dual-design-frontends`.
- **P2 — Tool-package + verification wiring gap.** `tools/phaser-shell/package.json` currently has no `test`/`typecheck`/`lint`/`build` scripts, and the proof game's package name is `@fabrikav2/shell_proof_phaser` (underscore) with `test:unit` (no `test` alias). The card's verification line `npm --workspace @fabrikav2/phaser-shell test && npm --workspace @fabrikav2/shell-proof-phaser test` will not resolve as written; U6 adds the tool scripts and either adds a `test` alias to the game or the runner uses `test:unit`/the directory path. Flag to conductor; no shared change required (both packages are lane/tool-owned).

### Implementation Constraints

- No editor/generated-source dual authority: the runtime consumes only the immutable published bundle; it never regenerates scenes or edits `authoring/`.
- No Grapes/shared/root dependency or file changes from the U6 worker (kernel, testkit, sdk, ui, verify-device, `experiments/.../{protocol,fences,baseline}`, root manifest/lockfile, the Grapes lane). Anything needed there is a conductor integration card (P0/P2).
- No `Phaser.AUTO` fallback in unsupported environments — explicit WEBGL capability + lifecycle, or a named blocked/no-go.
- No `_template`/`create-game`/existing-game/v1-contract changes.
- Volatile timing/device/env facts live in gitignored `.work/`, never in the deterministic projection bytes or `refs/`.
- Browser e2e (`tests/e2e`) is a manual diagnostic only, never presented as device verification; default verification is local code health + the offline build; device proof is U10.

## Implementation Units

> IDs are sub-units of goal U6. Land in order; U6.0 is a conductor prerequisite, not U6-worker code.

### U6.0 — (Conductor) Land P0 renderer-fence unfreeze + confirm P1 publication
- Conductor-owned integration card executing Preconditions P0 (and confirming P1). Not the U6 worker's code. U6 build starts only after this lands and both lanes' gates are green.
- **Verify:** both twins' `frozen-behavior.test.ts` pass with renderer + `design/revisions` carved out; `baseline/behavior-hashes.json` resealed; `fences.json` updated; an accepted U5 `publicationId` present.

### U6.1 — Phaser boot + persistent explicit-WEBGL game shell
- Add `tools/phaser-shell/src/runtime/` (or `games/shell_proof_phaser/src/shell/`) boot that creates one `Phaser.WEBGL` game, FIT/portrait at 390×844, no `AUTO`. Diverge `src/main.ts` to mount it and keep the harness wiring (`createTemplateHarness({ render })`) intact.
- Add `tools/phaser-shell` scripts: `typecheck`, `test`/`test:unit` (vitest), `lint`, `build` (P2).
- **Verify:** `npm --workspace @fabrikav2/phaser-shell test` runs; game boots to `menu` in a headless/WebGL test context; no canvas recreation across a forced state change.

### U6.2 — Seven-surface renderer bound to the frozen controller
- Implement the seven scenes/compositions and the surface router that repaints from `snapshot()` on `render()`; bind interactive objects to controller verbs; place everything via `projectShellGeometry` from `instances[]`. Pause and Settings are distinct compositions; `level` keeps mechanic-mount + Test Win/Lose; second-currency counter shows `snapshot.secondaryCurrency`.
- **Verify:** all controller journeys match the DOM lane (drive-to across seven states); canvas resize + safe-area preserve shared golden geometry; per-role 48 px minimums hold; scene transitions leak no scenes/listeners across repeated tours.
- **Test homes:** `tools/phaser-shell/test/runtime-lifecycle.test.ts`, `action-geometry.test.ts`; game-side `tests/unit` conformance beside frozen guards.

### U6.3 — Shop surface over the fake SDK, epoch-guarded
- Real scrollable Shop scene consuming `controller.sdk.iap` (init, catalog sections, product cards, Back, Restore, header balance); all async results epoch-guarded.
- **Verify:** Shop opens from Menu, scrolls, exposes catalog/restore/back, returns; `item_beta` shows owned via restore; `item_gamma` renders unavailable; scroll state does not corrupt other surfaces.

### U6.4 — Phaser evidence-probe readers (CSS-client space) + post-paint readiness
- Implement the five `ShellEvidenceProbeReaders` for `rendererProfile: "phaser-native"`; project display-object bounds to CSS-client rects; readiness per KTD5; revision sentinel = first 8 hex of sha256 of the selected projection id.
- **Verify:** `runtime-readiness.test.ts` — `ready` false until textures/fonts/Shop/sentinel/POST_RENDER for the epoch; a forged expected-sentinel echo cannot satisfy the probe; action rects carry `(actionId, instanceId)` + `disabled/visible`; snapshot passes host consumer (`tools/verify-device`) with zero adaptation.

### U6.5 — Projection ingest + bundle validation (`phaser-native`)
- `tools/phaser-shell/src/application/` ingest of an accepted `publicationId`: re-validate the bundle against the `phaser-native` profile (`parseProjectionRevisionV2`, `parseShellPublishedRevisionV2`), reject user-code/import regions, symlinks, path/URL escapes, source↔generated divergence, volatile bytes, mixed/missing profile artifacts; namespace runtime keys by `sourcePublicationId`.
- **Test homes:** `projection-bundle.test.ts`, `projection-security.test.ts`.

### U6.6 — Immutable apply loop + atomic pointer + ledger (P0/A/B/B)
- Fail-closed `preflight/apply/status/proof`; stage in `.work/`; compute `computeShellProjectionIdV2`; write immutable `design/revisions/<projectionId>/`; atomic `design/revision.json` swap; deterministic ledger. B-over-B = true byte/mtime/git no-op; failure preserves prior pointer; drift + negative asset-identity control → `blocked-drift`.
- **Verify:** `application-preflight.test.ts`, `application-abb.test.ts`, `application-atomicity.test.ts` — valid A and B create distinct complete revisions; second B writes nothing and leaves git clean; simulated failure keeps the old pointer; hand-edited generated/`asset-identity` bytes block drift and cannot change rendered output; A's references cannot verify B; unsupported intent cannot patch generated scene code.

### U6.7 — Renderer-local references + offline vendor-exit build
- Generate hash-bound `phaser-native` references under `refs/`; prove a clean-checkout, network-disabled rebuild reproduces B without Phaser Editor or cached output (after a separately recorded dependency-prep step).
- **Verify:** `offline-bundled-build.test.ts`; real-renderer e2e under `tests/e2e` or `tests/runtime` (manual diagnostic); `npm run audit && npm run project-gate` green.

### U6.8 — Live shakedown + evidence (conductor-run) and handoff to U7/U10
- Conductor runs the first live Phaser-in-WebGL shakedown (per Operating Contract §7) and records it; U6 supplies the renderer-neutral probe + revision sentinel U7 parity and U10 device proof consume. U6 does not claim device readiness.

## Verification Contract

| Gate | Command / Observation | Pass condition |
|---|---|---|
| Tool lane | `npm --workspace @fabrikav2/phaser-shell test` (+ `typecheck`, `lint`, `build`) | Projection/security/preflight/A-B-B/atomicity/readiness/lifecycle/geometry/offline suites pass |
| Proof game | `npm --workspace @fabrikav2/shell_proof_phaser test:unit` (see P2 re: `test` alias / name) + `typecheck`, `lint`, `build` | Seven-surface conformance, controller journeys, geometry, Shop, frozen guards pass |
| Shared conformance | Shared controller + geometry conformance run unchanged against the Phaser adapter | Semantic/behavioral parity with the DOM lane (not pixel equality) |
| A/B/B + negatives | `application-abb` / `application-atomicity` fixtures | P0/A/B/B typed outcomes match Grapes; B-over-B no-op; negatives preserve prior revision |
| Lifecycle | Repeated seven-state tours | No scene/listener leaks; textures decode before `ready`; stable memory |
| Offline exit | Clean-checkout, network-disabled rebuild | Reproduces B without Phaser Editor/account/cache |
| Repo gates | `npm run audit && npm run project-gate` | Green; no lane-fence or shared-file violation |
| Live | Conductor Phaser-in-WebGL shakedown | Boots, renders, emits probe + sentinel |

## Definition of Done

- All controller journeys and geometry fixtures match; action rectangles match live display objects (CSS-client space) and 48 px minimums; no listener/scene leaks; textures/fonts finish before `ready`.
- P0/A/B/B and negative controls produce the same typed outcomes as the DOM/Grapes lane; B-over-B is a true byte/mtime/git no-op; blocked-drift and the negative asset-identity control preserve the prior revision.
- A clean, offline build reproduces B without Editor/account/cache; renderer-local references are hash-bound and revision-scoped.
- `npm --workspace @fabrikav2/phaser-shell test && npm --workspace @fabrikav2/shell_proof_phaser test:unit && npm run audit && npm run project-gate` all pass (P2 wiring resolved).
- Preconditions P0/P1 landed; no shared/Grapes/root/editor changes made by the U6 worker; U10 device bridging untouched.
- Implementation ledger records starting/ending SHA, inherited U5 work, model identity, active time, attempts, rework, interventions, added deps/tools, changed surface, and failed gates.

## Sources and Research

- `goal.md` (experiment/dual-design-frontends @ 2ec08c51 / current 9428c062): U6 unit, R1–R32, F2–F3, AE1/AE3–AE5/AE7–AE8, verification contract, implementation constraints.
- Conductor U6 seam audit (card `s1P6oJI2`, comment 2): runtime/lifecycle, readiness scoping, CSS-client rectangles, required test homes.
- Landed kernel v2: `packages/kernel/src/shellContract.ts`, `packages/kernel/contracts/shell-presentation.v2.json` (`phaser-native` profile, publication/projection ID schemes, `projectShellGeometry`/`normalizeShellGeometry`, `computeShellProjectionIdV2`, `parseProjectionRevisionV2`).
- Landed testkit: `packages/testkit/src/harness/evidenceProbe.ts` (+ test), `contract.ts` (`ShellEvidenceProbe`, CSS-client `ClientPoint`).
- Frozen behavior surface: `games/shell_proof_phaser/src/{core,sdk,shell}/**`, `tests/unit/frozen-behavior.test.ts`, `experiments/design-frontends/baseline/behavior-hashes.json`, `experiments/design-frontends/fences.json`.
- U5 plan (card `gJtZP63y`): publication format, editor-source hashes, AST-fact parity, CLI surface, and the explicit U5→U6 ownership split (apply/projection/pointer/runtime are U6).
- Origin DOM plan `docs/plans/2026-07-10-002-feat-grapesjs-shell-specialization-plan.md` + `goal.md#U4`: the application-loop pattern U6 mirrors for `phaser-native`.
