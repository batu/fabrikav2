# Archived scratch-board backlog — 2026-07-22

Cards archived from the project's scratch board todo/ideas columns during the 2026-07-22 clean-slate pass. Full text preserved below; cards remain recoverable from the Trello board archive.

## PIXELSMITH-DIFFERS: encode Batu's recurring defect classes into the judge (`CqafMhYB`)

In /Users/base/dev/appletolye/pixelsmith (uv project). Batu: 'some of them are repeating so you need to capture and integrate them into the pixelsmith differs for them to find.' Add a RECURRING-DEFECTS checklist that pixelsmith judge ALWAYS evaluates per crop, alongside the freeform critique: (1) banner/ribbon TRANSPARENCY (opaque box behind a sprite banner = defect); (2) ASSET IDENTITY (element uses an asset visibly different from the reference's — flag glyph-vs-asset swaps); (3) GLYPH CENTERING in circular/pill buttons; (4) CONTENT CONTAINMENT (text/icons leaking outside their pill/chip bounds); (5) SIBLING SIZE CONSISTENCY (tab cells/buttons in a row unequal). Structured output: each check pass/fail + evidence phrase. Wire into judge's schema so agents get them machine-readable. Tool stays a tool (single judge call, returns).

## PIXELSMITH-GEN: image generation verb (icons/assets/wireframes) + ai_asset style-guide pipeline (`nX3Dwpq6`)

In /Users/base/dev/appletolye/pixelsmith. Batu: icon fidelity must go up; add generation capability. New verb `pixelsmith generate`: inputs = style reference image(s) + asset spec (name, size, transparent bg, style tokens); pipeline = (a) build a style guide from references using the ai_asset approach (https://github.com/tnbao91/ai_asset, MIT — vendor the studio_primer/style-token schema, adapted), (b) produce the image via available generators (start: OpenRouter image models / gpt-image; design the generator interface pluggable), (c) post-process: downscale, transparent-bg validation, write into the game's design/assets with asset-identity entry. TOOL not loop: one spec in → one asset out. Include a smoke test with a mocked generator. Conductor runs the live shakedown.

## MINE3-4: at-rest reference-capture checklist for foreign apps (device policy aware) (`b9iWv9u4`)

Markdown doc + optionally a small conductor script: wake → dismiss-keyguard → screen_off_timeout bump → force-stop → launch → GPG/consent dialog dismissal taps → screencap; note Family-Link-locked apps are NEEDS-BATU. Lives in docs/ near verify-device. From gap #5 (arrow shipped-ref blocked, BB required 3 rounds of dialog fighting).

## PIXELSMITH: at-rest reference mode + --out path bug (`JOmzJykn`)

In /Users/base/dev/appletolye/pixelsmith: (1) `capture --at-rest --bundle-id <id>`: launch foreign app, settle-wait, screenshot WITHOUT tourstate gating, labeled as reference-provenance (at-rest, no state claim) — for shipped-app refs. (2) BUG: --out resolves relative to pixelsmith cwd and created a DIRECTORY named <name>.png; resolve out paths against the caller's cwd and write a file. Tests both.

## MINE-3 [agency, CONDUCTOR-RUN]: merge-card untracked-path handling (scratch globs) (`JBn8sf6Y`)

SESSION EVIDENCE: merge-card refused landings 5+ times on untracked conductor scratch (in-progress evidence dirs, ledger) — each a manual commit-or-move loop. BUILD: merge-card consults .gitignore'd + a project config list (twf_gate.scratch_globs, e.g. docs/evidence/*-in-progress, .work/) and ignores ONLY those untracked paths in the dirty-tree check; any other dirt still refuses. Footprint: agency twf_merge.

## SDK-STATUS readout: tour-capturable on-device SDK evidence (harness builds) (`6or83mHX`)

THE RIGHT PATH to deterministic on-device SDK evidence (log-mining dead-ends: WKWebView JS console never reaches os_log; devicectl has no console stream). BUILD: in HARNESS builds only, an SDK-status readout — a tour-capturable line (a11y element + tiny on-screen strip, same pattern as tourstate) rendering each SDK's live state: admob:init-ok|err adjust:session-sent analytics:<n>-events iap:catalog-loaded. The allstates tour (or a dedicated 'sdkstatus' script) dwells on it; the device capture becomes the SDK evidence artifact. Solver: state+capture stays tool-shaped (no autonomy). Interactive legs stay human: ad-render tap + sandbox IAP purchase remain a Batu-present session (park note on IKoUD7lI). Footprint games/marble_run src/sdk+shell+testing + _template port. AC: device capture shows the status line with real values.

## MINE2-1 [agency]: shell wrappers must no-op in non-interactive shells (codex stdin-hang, 2x ~75min lost) (`Xl8FFMPN`)

LEDGER 00:20+: the agency shell function wrapping codex calls _agency_tmux_warn which doesn't exist in non-interactive bg shells -> `codex` fell through to bare invocation waiting on stdin — TWICE, ~75min lost each. FIX in the agency shell snapshot/rc: wrappers guard `typeset -f _agency_tmux_warn >/dev/null || _agency_tmux_warn(){ :; }` (or `command -v`), AND document the safe headless invocation (`command codex exec ... </dev/null`) in the conduct skill preflight. Footprint agency shell init + skill doc.

## MINE2-2 [gallery]: permanent-URL gaps found by first live use (port guard, hostname, not-on-tailscale) (`7gwpPcvJ`)

LEDGER 01:05 + live acceptance: (a) a stale http.server squatted loopback:8787 silently shadowing the service — the server should detect port conflicts at startup and fail LOUD (or the health endpoint should self-identify so a squatter is detectable); (b) config url http://bases-mac-mini:8787 unresolvable from the host itself and from non-Tailscale clients — Batu needed a throwaway trycloudflare tunnel (the exact thing Gallery exists to kill). FIX: gallery serve self-identify header + port-conflict check; document/automate a NAMED tunnel (cloudflared named tunnel or tailscale funnel) as the permanent public URL; `gallery url` command printing the working URL(s) incl. short form (tmux line-wrap ate the long tokened URL — consider short request paths or QR in terminal). Footprint /Users/base/dev/appletolye/gallery.

## MINE2-4 [agency]: headless-codex jobs need incremental commits (capacity-death salvage shouldn't be luck) (`cwtgApSa`)

LEDGER 01:45: MINE-1's codex died at GPT-5.5 capacity ON the commit step after 720K tokens; the complete green implementation survived only as uncommitted working-tree files (conductor salvaged). FIX: the headless-codex prompt template (conduct skill / agency docs) instructs COMMIT AFTER EACH COHERENT UNIT (not one commit at the end); optionally a wrapper that auto-commits WIP on codex non-zero exit. Footprint conduct-skill prompt patterns + optional agency helper.

## FIX FIDELITY 12: uncarded polish findings (animated bg, particles, red glare, app icon, connector, HINT) (`avdCfLXt`)

The 38-finding rigorous diff (docs/evidence/2026-07-06-1747-rigorous-diff) has findings NOT in any fix card. Address the achievable ones: (1) ANIMATED/MOVING background — reference bg drifts/parallax; ours is static; add subtle motion. (2) PARTICLE clash — ours particles are fine but clash with the scene; tune. (3) RED GLARE on mistake — reference flashes a red glare on a wrong tap; ours has none; add. (4) HINT tile — warm-tan chunky panel to match (may be partly done by chrome card; verify). (5) TWIN-RAIL connector — reference saga connector is a twin-rail; ours is a single rope (asset/CSS). (6) APP ICON (N7) — set the real app icon (vida app-icon asset) so it's not the default. Pick the highest-fidelity subset; each visible change CLOSE-OUT REQUIRES verify-device panel. Some (app icon, red glare) need device to confirm. twf handoff.

## [CONDUCTOR-RUN] SDK on-device SMOKE TEST (ads/IAP/analytics/attribution on real phone) (`IKoUD7lI`)

The kickoff required a FULL SDK implementation TEST; SDKs are implemented+unit-tested but never confirmed working on the real phone. On device (com.appletolye.marblerun.dev, sandbox creds already wired), CAPTURE EVIDENCE that each fires: (a) AdMob or AppLovin — a test/sandbox ad actually RENDERS (screenshot); (b) RevenueCat — a sandbox IAP purchase flow opens + completes (screenshot); (c) analytics — Firebase + owned-mirror events emit (log/console capture); (d) Adjust — attribution/session event fires (log capture). This is CONDUCTOR device+evidence work, not code. Deliver docs/evidence/<ts>-sdk-ondevice/ with a per-SDK PASS/UNVERIFIED table + screenshots/logs. Sandbox only, no production. twf handoff.

## AUDIT #23: make customer-info subscriptions replaceable and removable (`Ny3w0aZ4`)

Problem: `packages/sdk/src/iap/service.ts:365-389` registers a provider callback that closes over the first handler. A `registered` flag prevents replacement and null does not unsubscribe, so stale consumers continue receiving updates.

Classification: direct-to-work
Pipeline: full
Task-class: iap-wiring
Depends_on: 9SQPxvlw
Touches: packages/sdk/src/iap, packages/sdk/test
Contract: packages/sdk/src/iap/service.ts (consumer of AUDIT #4 operation contract); subscription identity must not alter purchase serialization.

Approach: register one stable provider dispatcher that reads current subscriber state, or explicitly unsubscribe/re-register when supported. Define replacement and removal semantics, prevent duplicate callbacks, and clean up provider listeners on service disposal/reset.

Acceptance criteria:
1. Replacing A with B means only B receives future updates.
2. Passing null/removing a subscription prevents further callbacks.
3. Repeated registration does not multiply provider listeners.
4. Tests cover replacement during delivery, removal, teardown, and provider error.
5. Preserve the purchase settlement contract from AUDIT #4 and verify on device in later stages.

Verification: focused IAP tests, SDK typecheck, root unit tests, eslint. Commit only.


## AUDIT #11: make analytics replay acceptance atomic across workers (`3iIP44kI`)

Problem: `packages/services/src/analytics-worker/ingest.ts:150-160` checks replay state, awaits storage, then records it. Concurrent identical requests both see absence, both write, and both return 202. In-memory replay/rate state is also isolate-local.

Classification: needs-plan
Pipeline: short
Task-class: analytics-idempotency-contract
Depends_on: csYLD5PK
Touches: packages/services/src/analytics-worker, packages/services/test, deployment/storage docs
Contract: packages/services/src/analytics-worker/idempotency.ts (owner: this card); insert-if-absent result must be the sole acceptance decision across concurrent isolates.

Approach: move dedupe to an atomic shared primitive (transactional insert, unique key, or storage-native compare/set) with bounded TTL and a clear behavior for storage outage. Keep rate limiting independently scoped.

Acceptance criteria:
1. Two concurrent identical events yield exactly one durable acceptance.
2. Behavior holds across separate worker instances, not only one process.
3. Retries receive a stable idempotent response; different events are not collapsed.
4. Tests use a real concurrency barrier and a storage-contract fake; document deployment binding/migration.
5. No production migration/deploy by worker.

Verification: focused concurrency tests, services typecheck/unit, root audit/eslint. Commit only.


## AUDIT #7: reject stale or mismatched xcresult evidence (`sErUSdf3`)

Problem: `tools/verify-device/cli.mjs:116-128,284,343-349` imports an xcresult without source revision, lane, build time, or device provenance, defaults it to a device lane, and stamps current `generatedAt`. A stale bundle becomes fresh proof.

Classification: needs-plan
Pipeline: short
Task-class: evidence-provenance-contract
Depends_on: 9l9Ploxe
Touches: tools/verify-device/cli.mjs, tools/verify-device/src/panel.mjs, tools/verify-device/src/attachments.mjs, tools/verify-device/test, tools/verify-device/README.md
Contract: tools/verify-device/src/panel.mjs (owner: this card); producer-stamped revision, build/capture time, lane, device identity, and artifact digest must survive import and be validated against current request.
Lessons: contract-ownership, contract-seam

Approach: stamp provenance at production, never import-time; validate revision/age/lane/device/app identity and reject missing legacy provenance in strict mode. If signing is unnecessary locally, at minimum bind a content digest and source metadata so restamping cannot refresh it.

Acceptance criteria:
1. Stale, wrong-revision, wrong-game, wrong-lane, and missing-provenance bundles fail strict import.
2. Import does not rewrite capture time or upgrade lane classification.
3. Valid current bundles round-trip unchanged and tests detect tampering.
4. Legacy handling is explicit and cannot pass strict.

Verification: verify-device provenance/import tests, package typecheck/lint, root unit/audit. Commit only.


## AUDIT #8: make the landing gate block FAIL evidence panels (`OAGkORM5`)

Problem: `tools/verify-gate/src/classify.mjs:171-204` intentionally ignores `verdictPass`; tests assert that a fresh panel with verdict FAIL is acceptable, conflicting with `docs/AGENT-HANDOFF.md:69-77` fail-closed guidance.

Classification: direct-to-work
Pipeline: short
Task-class: release-gate-fix
Depends_on: sErUSdf3
Touches: tools/verify-gate/src/classify.mjs, tools/verify-gate/test/classify.test.mjs, tools/verify-gate/test, docs/AGENT-HANDOFF.md
Contract: tools/verify-device/src/panel.mjs (consumer); landing must accept only the verified-passing verdict/provenance semantics established by AUDIT #6/#7.

Decision: this audit remediation adopts fail-closed semantics. A FAIL, UNVERIFIED, partial-required, malformed, or stale panel blocks landing with an actionable reason.

Acceptance criteria:
1. FAIL panels fail the gate; PASS with valid coverage/provenance can pass.
2. Tests previously locking in permissive behavior are replaced with policy-correct expectations.
3. Error output names the blocking verdict/state and evidence path.
4. Docs and all gate entry points agree; no bypassing later in the landing chain.

Verification: verify-gate unit/CLI tests, root land-gate fixture, typecheck/lint/audit. Commit only.


## AUDIT #9: require consumer coverage for shared-package changes (`HbnwMaMg`)

Problem: `tools/verify-gate/src/classify.mjs:194` maps `packages/ui` changes to no affected game slug, so any one fresh game's panel can clear a shared UI change.

Classification: needs-plan
Pipeline: short
Task-class: verification-coverage-contract
Depends_on: OAGkORM5
Touches: tools/verify-gate/src/classify.mjs, tools/verify-gate/src/git.mjs, tools/verify-gate/test, package.json, workspace metadata, docs/AGENT-HANDOFF.md
Contract: package.json workspaces and game dependency manifests are the owner source; gate coverage must derive consumers without a hand-maintained duplicate map.

Decided direction: compute affected game consumers from the workspace dependency graph. For broadly shared roots where every consumer is excessive, support an explicit reviewed representative matrix in versioned config; never let an arbitrary single panel satisfy it.

Acceptance criteria:
1. Shared UI/SDK/testkit/service changes resolve deterministic affected consumers or an explicit matrix.
2. Missing any required panel blocks with the missing game list.
3. Game-local changes retain narrow coverage.
4. Transitive dependencies, new games, removed games, and no-consumer packages have tests.
5. Matrix exceptions require rationale and cannot silently wildcard.

Verification: verify-gate affected-surface tests/CLI fixtures, root unit/typecheck/audit/lint. Commit only.


## AUDIT #14B [blocks-on MTP7vPUh]: emit Agency visual-evidence v1 from Fabrika v2 (`SrMxJm8u`)

Problem: Fabrika v2 `packages/testkit/src/harness/runLayout.ts:68-100` emits `{topic,date,screenshots,...}` under `screenshots/` with no judge, while Agency expects a different evidence artifact. Agency card MTP7vPUh owns the canonical v1 schema and strict validator.

Classification: needs-plan
Pipeline: short
Task-class: evidence-contract-consumer
Touches: packages/testkit/src/harness/runLayout.ts, packages/testkit/src, packages/testkit/test, tools/verify-device, docs/AGENT-HANDOFF.md
Contract: Agency `src/agency/catalog/contracts/visual-evidence-v1.schema.json` (consumer only); import/fixture against the owner contract, never re-declare a divergent local schema.
Lessons: contract-ownership, contract-seam

Do not start until Agency card MTP7vPUh lands and its exact schema/validator handoff is copied into this card. Then make Fabrika v2 emit that contract directly (or through one explicit versioned adapter at the producer boundary), including card, surfaces, producer-stamped provenance, frames, and judge verdict.

Acceptance criteria:
1. Output passes Agency's validator with zero field/path massaging.
2. Every declared surface has an existing frame and judge entry.
3. Failing/unjudged/partial capture cannot be mislabeled pass.
4. Existing consumers receive a documented migration path; no indefinite dual truth.
5. Round-trip fixture is tested in both repositories.

Verification: testkit/verify-device focused tests, typecheck, root unit/audit/lint. Commit only.


## AUDIT #16: make remote Android verification use explicit remote paths (`eC9r17ZT`)

Problem: `tools/verify-device/src/steps.mjs:57,193-245` prefixes commands with SSH but passes local absolute game/APK paths and decides remote Android directory existence from the local filesystem. No staging or path mapping exists.

Classification: needs-plan
Pipeline: short
Task-class: remote-execution-contract
Depends_on: sErUSdf3
Touches: tools/verify-device/src/steps.mjs, tools/verify-device/src/androidDriver.mjs, tools/verify-device/src/args.mjs, tools/verify-device/test, tools/verify-device/README.md
Contract: tools/verify-device/src/steps.mjs (owner: this card); every remote command input must be either a declared remote workspace path or an explicitly staged artifact with digest.

Approach: define a remote workspace root/path mapper and a staging protocol for APK/config inputs. Probe remote existence remotely, quote safely, and stamp the remote host/path/digest into evidence provenance.

Acceptance criteria:
1. No local absolute path is embedded in remote commands.
2. Missing/mismatched remote artifacts fail before device actions.
3. Local lane behavior remains unchanged.
4. Tests use a fake SSH executor asserting exact remote commands, staging, quoting, and cleanup; include one live recipe that can be run outside sandbox.

Verification: verify-device remote/Android tests, typecheck/lint, root unit/audit. Commit only.


## AUDIT #32: put deadlines on verification budget and Portal HTTP calls (`9OcoLEMc`)

Problem: `tools/verify-device/src/budget.mjs:39` and `src/portal.mjs:77` await fetch without abort deadlines. Optional Portal delivery runs before strict exit and can hold verification indefinitely.

Classification: direct-to-work
Pipeline: short
Task-class: reliability-fix
Depends_on: eC9r17ZT
Touches: tools/verify-device/src/budget.mjs, tools/verify-device/src/portal.mjs, tools/verify-device/cli.mjs, tools/verify-device/test

Approach: attach explicit configurable AbortController deadlines, classify timeout separately, and ensure optional reporting cannot delay or overwrite the authoritative verification result. Bound response reads and retries.

Acceptance criteria:
1. Hung budget/Portal endpoints terminate within configured bounds.
2. Required budget failure and optional delivery timeout have distinct exit/report semantics.
3. Verification verdict is finalized independently of optional delivery.
4. Fake-timer/fake-fetch tests cover timeout, abort race, slow body, retry, and success.

Verification: verify-device HTTP tests, package typecheck/lint, root unit/audit. Commit only.


## AUDIT #24: generate every package identity from one canonical application ID (`coepKXfO`)

Problem: `tools/create-game/src/create-game.mjs:140,159,171` emits forms such as Capacitor `com.fabrika.woolcrush` while manifest/harness metadata uses `com.fabrikav2.wool_crush`; underscore stripping also makes distinct slugs collide.

Classification: needs-plan
Pipeline: short
Task-class: scaffold-contract
Touches: tools/create-game/src/create-game.mjs, tools/create-game/test, games/_template, packages/manifest, package.json
Contract: tools/create-game/src/create-game.mjs (owner: this card); canonical app ID and slug/name transforms must round-trip identically through Capacitor, manifest, harness, native projects, and verification.
Lessons: contract-ownership

Approach: define and validate one canonical reverse-DNS application ID, derive every consumer from it without lossy collision-prone normalization, and fail early on duplicate/invalid identities. Preserve existing shipped IDs through explicit migration/override metadata rather than silently renaming apps.

Acceptance criteria:
1. Newly generated Capacitor/manifest/harness/native IDs are identical where they represent the same app.
2. `wool_crush` and `woolcrush` cannot collide silently.
3. Existing games retain documented stable IDs or explicit migration files.
4. Tests cover punctuation, Unicode/rejection, long names, duplicate detection, and round-trip.

Verification: create-game focused tests, isolated scaffold generation, root typecheck/unit/audit/lint. Commit only.


## AUDIT #29: make generated native shells self-contained outside the monorepo (`aaE49lhL`)

Problem: `games/_template/package.json:14-17` and create-game output declare none of `@capacitor/core`, CLI, iOS, or Android while instructing `npx cap add`. The warm monorepo lockfile supplies them only through existing games; isolated output is not reproducible.

Classification: direct-to-work
Pipeline: short
Task-class: scaffold-infra
Depends_on: coepKXfO
Touches: games/_template/package.json, games/_template/README.md, tools/create-game/src/create-game.mjs, tools/create-game/test, package-lock.json, tools/audit
Shared: Capacitor version pins live in the root workspace/template dependency policy; import/derive them, do not add independent drifting pins.

Approach: declare all required runtime/CLI/platform packages in generated output using the canonical version policy, document the generated tree, and add an isolated temp-directory install/cap smoke test with no sibling workspace hoisting.

Acceptance criteria:
1. Fresh generated game installs and runs Capacitor config/add/sync checks in isolation.
2. No unpinned remote `npx` fallback is required.
3. Template README and structure whitelist co-evolve with generated native output.
4. Root workspace remains deduplicated and lockfile deterministic.

Verification: create-game tests including isolated smoke, template structure audit, root unit/typecheck/audit/lint. Commit only.


## AUDIT #25: make CI build every declared deliverable and fail on missing scripts (`Uxxbm2tz`)

Problem: `.github/workflows/ci.yml:52-54` runs typecheck/lint/unit only with `--if-present`; it never builds deliverables. Five tool workspaces and `tools/video-refs` can silently escape all gates. The repository also currently has no usable remote URL, so hosted CI is not protecting main.

Classification: needs-plan
Pipeline: short
Task-class: ci-contract
Depends_on: vGKOZPMR, aaE49lhL
Touches: .github/workflows/ci.yml, package.json, tools/*/package.json, games/*/package.json, scripts, docs/AGENT-HANDOFF.md
Contract: package.json workspace scripts (owner: this card); each workspace declares its required typecheck/test/build/audit capabilities and CI executes an explicit matrix without `--if-present` masking.

Approach: define a required workspace capability matrix, add production web builds and representative generated/native-shell checks, include video-refs, and expose intentional exemptions in versioned config. Split expensive jobs while preserving fail-fast signal.

Acceptance criteria:
1. Missing required scripts fail CI with the workspace name.
2. Every game web deliverable builds; shared packages/tools run relevant typecheck/tests.
3. Asset size budget from AUDIT #12 and isolated scaffold smoke from AUDIT #29 are gated.
4. Local `npm run ci` equivalent reproduces the matrix.
5. Document that adding a real remote/branch protection is an operational NEEDS-YOU step; worker must not invent a remote.

Verification: run local CI entry point/matrix, all web builds, root typecheck/unit/audit/lint. Commit only.

