I have enough across all six lenses. Let me compile the findings.

## Cross-Cutting Integration Review — fabrikav2 (main, 13 cards landed)

I read the two contract docs, every package's public surface + exports maps, the analytics/iap/flow seams, the audit linters, CI, and spot-checked the load-bearing test suites. Findings are prioritized; file:line evidence throughout. No BLOCKER breaks the *currently-landed* code — the sharpest issues are latent seams the open cards will hit, one of which is a direct sibling of the wire bug you already found.

---

### SHOULD-FIX 1 — Owned-mirror wire body has no `game_id`; the worker contract is game-keyed. (Sibling of the known wire bug.)
- Evidence: `packages/sdk/src/analytics/owned-mirror-sink.ts:81-87,116-123` — the batch body is `{ schema, events: [{event_id, enqueued_at, name, params}] }`. `packages/services/README.md:3-4` and `docs/architecture/v2-architecture.md:74` both say the worker is "keyed by `game_id`". No `game_id` exists as a structural field anywhere in the envelope (`contract.ts:147-158`) or the body.
- Why it matters: This is *exactly* the class you flagged — a producer (landed sink) and a not-yet-landed consumer (services worker, still a stub) sharing one schema tag (`fabrika-owned-analytics-v1`, line 25) with divergent shape expectations. Note the asymmetry: `env` is a **mandatory typed constructor field** (`analytics.ts:42`) precisely to prevent the FTD-pollution bug — but `game_id`, which is the worker's **primary partition key**, is not required anywhere. A game could bury it in `globalParams`, but nothing enforces it, so a multi-game mirror can receive un-attributable events. The env guardrail was built; the game_id guardrail for the same worker was not.
- Fix: Add `gameId` as a required field on `CreateAnalyticsOptions` (mirror the `env` treatment) and stamp it into the owned-mirror body as a first-class key, OR freeze the worker's ingest contract to read game_id from params and document that. Resolve *before* the services worker is written so both sides agree.
- Card: **services (owned-analytics worker)** card must pin this; **SDK-wiring** card should add the required field.

### SHOULD-FIX 2 — Duplicate `withTimeout` survived the consolidation, inside sdk itself.
- Evidence: `packages/sdk/src/ads/DeathAdCoordinator.ts:40` defines a local `const withTimeout = async (promise, timeoutMs)` while the consolidated `packages/sdk/src/with-timeout.ts:36` is imported by 5 other sdk modules (AppLovinMax, AdMob path, iap/service, attribution ×2).
- Why it matters: The consolidation lens's whole point. Worse than a plain dup: the two have **divergent contracts** — the consolidated one *rejects* with a `TimeoutError` (and ships `isTimeoutError`); the local one *resolves void* on timeout (fire-and-forget). Two same-named helpers with opposite failure semantics in one package is a footgun for the next author who imports the wrong one.
- Fix: Either reconcile DeathAdCoordinator onto the shared helper (wrap in try/catch for the swallow-on-timeout behavior) or rename the local one to `raceOrIgnore`/`settleWithin` so the name collision dies.
- Note on kernel promotion: `with-timeout` currently has **only sdk consumers** (grep confirms zero kernel/ui/testkit uses). No non-sdk consumer argues for kernel promotion *now* — keep it in sdk until a second package needs it. Answer to that lens: promote later, not now.
- Card: **SDK-wiring** card (or a cleanup note); low effort.

### SHOULD-FIX 3 — `no-duplication` audit only compares games↔packages, never package↔package — so Finding 2 is structurally invisible to the guardrail.
- Evidence: `tools/audit/src/no-duplication.js:53-71` — `lintNoDuplication` walks `games/*` only and flags names colliding with `packages/*` exports. There is no packages-internal or package-vs-package scan.
- Why it matters: Guardrail #3 (`v2-architecture.md:112-113`) says "shell code starts shared" and duplication should fail the audit. But a second `withTimeout` (or a second clamp/emitter) *inside or between packages* passes clean. The guardrail enforces the games→shared direction only; the shared layer can rot internally undetected. This is why Finding 2 slipped through per-card review AND the guardrail.
- Fix: Extend the linter to also flag intra-`packages/*` re-declarations of a name another package already exports (with a re-export allowance). Lower-effort interim: at least scan for duplicate *local* function names across sdk.
- Card: **new card** (audit hardening) or fold into SDK-wiring.

### SHOULD-FIX 4 — ESLint is configured but never runs; the "single lint baseline" guardrail is dead.
- Evidence: Root `package.json:15` `"lint": "npm run lint --workspaces --if-present"`; grep confirms **no workspace defines a `lint` script** (packages only have `typecheck` + `test:unit`). CI (`.github/workflows/ci.yml`) runs `npm run lint -w <ws> --if-present` → silent no-op everywhere. `configs/eslint.config.js` exists and its header says "consume from a workspace's own eslint.config.js," but **no workspace has an `eslint.config.js`**.
- Why it matters: `v2-architecture.md:116` lists "single toolchain versions pinned at root" as an anti-v1 guardrail, and the eslint config is the intended baseline. Today unused-vars, no-DOM-in-kernel-adjacent hygiene, etc. are entirely unenforced. The *literal-values* guardrail is still live (via `tools/audit`, which does run), so this is style/type hygiene, not the copy guardrail — hence SHOULD-FIX not BLOCKER.
- Fix: Add a per-workspace `eslint.config.js` (re-exporting the base) and a `"lint": "eslint ."` script, or make CI call `npx eslint` at root. Verify it actually fails on a planted violation.
- Card: **new card** (or scaffolding/CI cleanup).

### SHOULD-FIX 5 — No unified environment resolution; each SDK derives test/prod independently.
- Evidence: three parallel env vocabularies with no shared source: analytics `AnalyticsEnvironment = 'production'|'development'|'test'` (`contract.ts:31`), attribution `AdjustEnvironment = 'sandbox'|'production'` (`AdjustAttributionPlugin.ts:3`), plus AdMob test-flag and RevenueCat `test_`-prefix sandbox selection (`iap/service.ts:117-118`). `AdjustConfig.ts:107` even carries a defensive guard `if (isProductionBuild && environment !== 'production')` — they've already felt this drift locally.
- Why it matters: The decision doc's SDK-test-credentials rule (`DECISIONS...:47-53`) requires *one* build-environment concept fanning out to N SDK-specific modes (Adjust sandbox, AdMob test flag, RC sandbox, analytics env marker) so marble_run's verification can't pollute FTD prod. There's no shared `FabrikaEnvironment` or a single resolver, so the SDK-wiring card must hand-wire 4 independent mappings — the exact place an inconsistency (analytics says `production` while Adjust stays `sandbox`) slips in unnoticed.
- Fix: Add one environment resolver in sdk that takes the build flag and returns the per-SDK env values, so wiring is one call, not four.
- Card: **SDK-wiring** card — this is a core assumption it must absorb.

### NOTE 6 — Architecture doc claims UI screens implement the kernel flow machine; they don't, and the flow machine remains a zero-consumer experimental seed.
- Evidence: `v2-architecture.md:39-41` describes the flow machine as "the screen flow machine (open/close/back-stack contract that `ui` screens implement)." Reality: `kernel/src/flow/machine.ts:12-18` is marked `@experimental`, "ZERO consumers," "WILL be rewritten against real UI consumers … do not wire new consumers." The ui cards instead built `PageStack` orthogonally (`ui/src/PageStack.ts:5-11`: "page navigation is a genuinely different data structure … kernel/flow stays untouched"). No ui screen references kernel/flow (grep: zero imports).
- Why it matters: The doc's central kernel↔ui seam is fiction — the flow machine was *not* rewritten against real consumers as the migration plan promised (`:120-122`); it was bypassed. Its sanctioned adopters are block_blast/arrow (`machine.ts:8`), which aren't the pilot — so the **marble_run pilot won't exercise kernel/flow either**, meaning v1's "dead flow-machine.ts, zero consumers" pattern is being reproduced verbatim. Not breaking (PageStack + game-driven lifecycle suffices), but it's dead weight carried under an `@experimental` flag with no scheduled adopter.
- Fix: Update `v2-architecture.md:39-41` to reflect that PageStack owns back-stack and kernel/flow is an unadopted seed; decide whether the pilot should adopt it (to actually validate it) or freeze/drop it.
- Card: doc fix + a decision on the **marble_run port** card (does it adopt flow, or is flow deferred to block_blast?).

### NOTE 7 — `PurchaseAnalyticsSink` is a second analytics notion; `purchase_unfulfilled` isn't a canonical event.
- Evidence: `iap/fulfillment.ts:70-76` defines its own `PurchaseAnalyticsSink.purchaseUnfulfilled({product_id, purchase_id, outcome})`, decoupled from the sdk analytics facade. `purchase_unfulfilled` is absent from `CANONICAL_EVENT_NAMES` (`contract.ts:50-62`, which has `purchase` but not the unfulfilled variant).
- Why it matters: When the shop card bridges fulfillment to the real `Analytics`, it must (a) declare `purchase_unfulfilled` as a per-game `GameEvent` extension and (b) hand-adapt the `{product_id, purchase_id, outcome}` shape. Reasonable decoupling, but an unbridged seam with no shared constant — easy to name-drift (`purchase_unfulfilled` vs `purchaseUnfulfilled` vs `iap_unfulfilled`).
- Fix: Promote `purchase_unfulfilled` to a canonical event name (or export a shared constant), so the shop wiring maps to a known key.
- Card: **shop UI** card (consumes iap) — flag the bridge explicitly; optionally **SDK-wiring**.

### NOTE 8 — Ad-format type appears twice in sdk (`FullScreenAdType` vs analytics `AdFormat`); composes by luck.
- Evidence: `ads/AdProvider.ts:32` `FullScreenAdType = 'interstitial' | 'rewarded'`; `analytics/contract.ts:113` `AdFormat = 'banner' | 'interstitial' | 'rewarded'`. Provider callbacks fire `onFullScreenAdStarted(adType)` (`AdProvider.ts:40`); the game must translate to `analytics.adImpression({ad_format})`.
- Why it matters: Same concept, two types, same package, no cross-reference. It composes only because `FullScreenAdType ⊂ AdFormat` — a subset relationship nothing enforces. If either list changes independently the ads→analytics wiring silently mistypes.
- Fix: Have analytics `AdFormat` be `FullScreenAdType | 'banner'` (or a shared base), documenting the containment.
- Card: **SDK-wiring** card.

### NOTE 9 — `no-literals` copy heuristic is line-local and misses `game.config.ts`.
- Evidence: `tools/audit/src/no-literals.js:129,139` — `isDomSink` is tested per-line, so `el.textContent = msg` where `msg` was a literal assigned on a prior line escapes. Scope (`scanRoots`, `:50-59`) is `packages/ui/**` + `games/*/src/shell/**` only; `games/<name>/game.config.ts` (screen titles, product names, ad copy) is out of scope.
- Why it matters: Guardrail #2's copy enforcement has two real evasion paths. The line-local limitation is documented as a known heuristic; the `game.config.ts` gap is not — and config is exactly where a game author would paste a literal title string. Also: the scan targets `games/*/src/shell/**`, but the architecture describes games as "canvas + config" with the *shell* being the ui package — so that scan path may never match real game structure.
- Fix: At minimum decide whether `game.config.ts` copy is in-scope (it should be, per the reskin bar); consider a var-taint pass for the assign-then-sink case.
- Card: **audit hardening** (new) / relevant to **game template** card's config conventions.

### NOTE 10 — Minor: `ui` declares a `@fabrikav2/kernel` devDep it never imports.
- Evidence: `packages/ui/package.json` devDependencies `@fabrikav2/kernel: "*"`; grep shows zero non-comment kernel imports in `ui/src`. Harmless now, but it's a phantom-dep-in-reverse that `deps-declared` won't catch (that linter flags undeclared imports, not unused declarations).

---

**Lenses that came back clean (I looked):**
- **API coherence (ui)** — genuinely strong. Every `mount*` takes a single options object and returns `UiHandle` or a subtype extending it (`Button`/`Toaster`/`ConnectivityIndicator` extend `UiHandle`); dismiss/dismissed/idempotency is centralized in `internal.ts createUiRoot`. No deviant component found.
- **Test quality (load-bearing suites)** — flow machine (45 expects/12 cases), iap service (34/17), fulfillment (28/11), PageStack (27/7) assert real behavior, not just "doesn't throw." The two `not.toThrow` hits are each paired with a state assertion (`PageStack.test.ts:63-64` also asserts `depth === 0`; `catalog.test.ts:31` pairs with a throw case). `restore-machine.test.ts` is thinner (13/11) but it's a pure-function contract. No weak/implementation-coupled smells worth flagging.
- **Deep-import bypass** — exports maps are defined per package (kernel/sdk/ui all enumerate subpaths); no landed cross-package deep import into `src/...` internals exists yet. (There's no *linter* preventing future ones, but nothing violates it today.)

**Bottom line:** The single highest-value action is reconciling the **owned-mirror `game_id` seam (Finding 1) before the services worker lands** — it's the live sibling of the bug you already caught, and the worker being a stub is the last moment to fix it cheaply. Findings 2–5 are shared-layer-rot that per-card review can't see because the duplication guardrail (Finding 3) and eslint (Finding 4) are both blind/dead.