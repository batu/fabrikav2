# fabrika v2 architecture (draft for report + scaffold)

Grounded in evidence at `docs/research/*.md`; decisions locked in
`docs/DECISIONS-2026-07-06-v2-kickoff.md`. This is the scaffold-from document.

## The one-paragraph thesis

v1's cost was not gameplay code — it was the commercial shell. 52% of all commits
carry fix/rework language and they cluster on find_the_dog's in-canvas UI
(GameScene.ts 68% fix-labeled, HUD.ts 65%, styles.css 73%), while the shared package
got 64× less churn and was mostly bypassed (haptics shared module: 1 of 4 games;
attribution: 0 of 4; analytics: never shared at all). v2 therefore ships the shell —
screens, SDKs, theming, build — as the product, and keeps games down to a canvas plus
declarative config. Every design value (color, copy, asset, spacing) lives in a
sheet-driven generated layer, never in hand-written TS/CSS.

## Repo layout (npm workspaces, fresh repo)

```
fabrikav2/
  packages/
    kernel/     # zero-dependency runtime primitives (no DOM, no Phaser)
    ui/         # DOM shell kit: screens + primitives, token-themed only
    sdk/        # provider-agnostic device/monetization services
    services/   # backend-facing: owned analytics worker, remote-config, CDN manifest
    testkit/    # playwright page objects, harness, debug/tuning panel
  tools/
    create-game/    # scaffold generator + port registry
    audit/          # duplication + literal-value linters (see Guardrails)
  configs/          # tsconfig.base, eslint, vite, playwright shared configs
  games/
    <name>/         # gameplay canvas + game.config.ts + design/ (generated)
  .github/workflows/ci.yml   # workspace-matrix CI, every game included
```

### packages/kernel
Typed event emitter, persisted-state (guarded localStorage blob), seeded rand,
responsive/safe-area, and the **screen flow machine** (game screen-state lifecycle).
Carried from v1 core: `runtime` mostly as-is; v1's dead `shell/flow-machine.ts` is the
seed. STATUS 2026-07-06: page back-stack turned out to be a ui concern — `ui/PageStack`
owns it; the flow machine's graduation test is the marble_run port's shell wiring
(game state lifecycle). If the pilot bypasses it too, drop it rather than carry a
second-generation zero-consumer module.

### packages/ui — the shell kit (DOM only)
Screens (each a themeable component with a data contract, no game knowledge):
`HomeMenu`+`SagaMap`, `Shop`, `Settings`, `ResultCard` (win/lose = one modal shell,
two content slots), `PauseOverlay`.
Primitives: `Button`, `ModalShell`, `ToastSystem`, `ToggleRow` (music/sfx/haptics),
`EconomyTransfer` (coin-fly, extracted from FTD's 300-line version — the marble_run
copy dies), `ConnectivityIndicator`, `RestorePurchasesRow`, `OfferSurface`
(hint/booster + fail/continue share one surface), `TutorialOverlay`,
`SceneTransitionCover`.
Hard rule: `ui` contains **zero literal colors, copy strings, or asset paths** —
everything resolves through `--fab-*` CSS tokens and the generated copy/asset modules.
Enforced by lint (see Guardrails).

### packages/sdk
One interface + N adapters per concern; adapters live beside the interface so the
next provider is a file, not a fork:
- `ads`: `AdProvider` interface (generalizing v1 core's AdMob-only `AdService`),
  adapters `admob`, `applovin-max` (port of FTD's 899-line stack), `disabled`.
  Rewarded + interstitial lifecycles.
- `analytics`: canonical event contract + pluggable sinks (`firebase`, `owned-mirror`,
  `console`). Generalizes FTD's 482-line service; block_blast's 122-line shape is the
  minimal contract baseline.
- `iap`: product-catalog schema (from FTD's `ProductCatalog.ts`) + RevenueCat
  purchase/restore/fulfillment.
- `attribution`: Adjust (v1 core's module finally gets its consumer).
- `haptics`: v1 core's implementation as-is (it was fine; adoption was the failure).
- `audio`: minimal `AudioBus` (play/mute/volume/ducking) that games plug clips or
  procedural synths into — kills the 4×~1,860-line rewrite pattern.

### packages/services
- `analytics-worker`: FTD's Cloudflare worker generalized to multi-game (game_id key).
- `remote-config`: FTD's schema/template service made game-agnostic.
- CDN asset manifest/cache: decide per pilot need (v1's version was FTD-only).

### games/<name>
- `src/` gameplay only (Phaser / Three / Canvas2D — free).
- `game.config.ts`: declares screens used, saga shape, economy, ad placements,
  product catalog, analytics events — the shell consumes this, the game never
  touches shell internals.
- `design/` **generated, git-committed, never hand-edited**: `tokens.css`,
  `copy.ts`, `assets.ts` — output of the design-sheets round-trip.

## design-sheets wiring (the reskin round-trip)

Target: sheet edit → `dsheets apply` → regenerated `design/` → build. Zero code edits.

1. **v2 standardizes where design values live** (`games/<g>/design/` + `--fab-*`
   tokens), so ONE generic ingester (`fabrikav2` ingester) replaces per-game bespoke
   ingesters. It reads `game.config.ts` + `design/` + ui-kit component cards.
2. **design-sheets gains (changes allowed per decision):**
   - a **copy schema** (localized-copy leaf type) — today nothing models UI text;
   - **asset-binding apply** for module imports (apply v0 explicitly refuses these);
   - optional layout/spacing token conventions (px scale groups).
3. **Round-trip**: `dsheets build` publishes sheet → claude.ai/design (Batu, agents,
   or external designer edits) → `dsheets diff`/`apply` writes tokens/copy/asset
   bindings back into `games/<g>/design/` atomically → CI builds + screenshot diff.
   Structural/component changes route to a change-brief card on the TWF board instead
   of silent auto-apply.
4. New game creation runs the same path in reverse: `create-game` scaffolds a default
   sheet, so "pick a color scheme and assets for each new game" is a sheet-editing
   session, not a code session — theming-at-creation sits on the time-to-ship path.

## Guardrails (the anti-v1 rules, enforced not aspirational)

1. **Declared deps only** — no phantom `@fabrika/*` imports; CI fails on undeclared.
2. **No literal design values** in `packages/ui` or game shell code — lint greps for
   hex/rgba/copy-string patterns outside `design/` (replaces the broken
   `grep-affected-games.sh`, this time with tests).
3. **Duplication gate** — a game implementing something whose name/shape exists in
   `packages/` fails `tools/audit`; the "extract after 2nd use" rule inverts to
   "shell code starts shared" because v1 proved retro-extraction never gets adopted.
4. **CI matrix covers every workspace** from day one (v1 CI covered 2 of 5).
5. Single toolchain versions pinned at root (v1 had vitest 3 vs 4, capacitor drift).

## Migration path (ordered)

1. Scaffold: workspaces, configs/, CI matrix, tools/create-game skeleton.
2. `kernel` + `testkit` (mostly carry v1 runtime/playwright/debug/testing).
3. `ui` shell kit extracted from FTD's DOM implementations + v1 core/ui
   (mountLevelMap is the proven seed), token-only from the first commit.
4. design-sheets: copy schema + asset-binding apply + generic fabrikav2 ingester.
5. `sdk`: haptics, audio, analytics, ads, iap, attribution (in that order —
   cheapest first, monetization SDKs need native shells to verify).
6. **Pilot: port marble_run/sugar3d** onto shell + ALL sdks (full implementation test).
7. Reskin drill as acceptance: change palette+copy in the sheet, rebuild, ship a
   visibly different marble_run with zero code edits.

## Open decisions that are Batu's (to finalize in report)
- Where sheets live long-term (design-sheets repo vs per-game in fabrikav2).
- Whether v1's CDN/asset-cache layer comes to v2 now or when a game needs it.
- Native shells: keep Capacitor as-is? (assumed yes — same stack rule.)
- Analytics owned-mirror: one worker for all games vs per-game deploys.
- What happens to arrow/block_blast/find_the_dog after the pilot (port order or freeze).
