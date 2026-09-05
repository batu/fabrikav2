# Fabrikav2 evaluation repairs — implementation handoff

Implementation checkpoint recorded on 2026-09-05, before the subsequent user-authorized merge and cleanup. All five selected repairs were implemented and automated verification passed, except the local audit exception described below. At this checkpoint changes were uncommitted in branch `fix/evaluation-repairs`; the evidence below describes that exact state.

## Source and scope

- Worktree: `/Users/base/dev/appletolye/fabrikav2/.worktrees/evaluation-repairs`.
- Reviewed revision and implementation/check base: `06cfd286d58ff6b51e7fd61bad51b697ab23517f`, remote main at task start. Checks ran against this revision **plus the uncommitted implementation**, not the untouched commit.
- Remote main advanced during implementation to `b8c3a3909545b3cdcf1e229032bde754d3bc107b` (analytics PR #54). Its changed files do not overlap these repairs. This worktree was not rebased or merged; combined runtime behavior on that newer revision has not been tested.
- [Original evaluation](/tmp/fabrikav2-evaluation/20260905-PmGfML/report.md), [execution plan](../plans/2026-09-05-evaluation-repairs.md), [supporting artifacts](/tmp/fabrikav2-implementation/20260905-evaluation-repairs/).

The shared SDK/provider architecture, existing verified grant functions, game wallets and lifecycle hooks were retained. No commercial-shell consolidation, asset cleanup or gameplay redesign was undertaken. Marble Run's intentionally inactive IAP and Mage Master's scripted sandbox remain unchanged. Bird and Dog receive native purchase recovery; the full-shell template carries the corresponding integration for future consumers.

The original primary checkout remains at `c5a2d2ffcea3323152d731aadb8894bd2484877c`; its Git status matches the evaluation-start status. No source commit, push, merge, deployment, operator-service restart, paid-provider operation or physical-device operation occurred. Three existing bounded agents were reused (runtime, architecture, verification); no recursive delegation occurred. Temporary fixture servers and browser processes were used for automated tests.

## Completed repairs

### U1 — Rewarded ads settle on native terminal events

`packages/sdk/src/ads/AdMobProvider.ts` now observes reward, dismissal, show failure and native-promise rejection independently. Closing an ad without earning a reward settles the caller even when AdMob 8.1.0 leaves its show promise pending. An earned reward is returned after dismissal. The same fullscreen lock covers interstitials and rewarded preparation/show; disposal releases callers and stale callbacks cannot grant a later show.

Seven behavioral regressions failed before the repair. Final shared-ad coverage: **94 passing tests**. Cases include no-reward dismissal, failed show, reward before dismissal, pending preparation/disposal, listener registration/removal failures, cross-format exclusion and a previous show's late native reward. See [runtime evidence](/tmp/fabrikav2-implementation/20260905-evaluation-repairs/runtime-implementation.md) and [ad test log](/tmp/fabrikav2-implementation/20260905-evaluation-repairs/ads-all-tests.log).

### U2 — Late received purchases reach a durable wallet

`packages/sdk/src/iap/service.ts` and `pending-purchases.ts` add an application-scoped pending store and an acknowledging completion handler. Late successful results retain the original store transaction identity, are saved before delivery and are removed only after a durable grant or durable ledger duplicate. Startup, purchase retry and the existing native/browser resume hooks reconcile pending results. A retry that delivers an old purchase returns that result without issuing another charge.

Bird, Dog and shell-template IAP wrappers/bootstrap now use this handler with their existing `fulfillVerifiedPurchaseOnce`. Their `GameState` implementations atomically checkpoint the balances, entitlements, wallet counters and processed purchase IDs. Failed purchase writes roll back the in-memory grant and propagate the error. Later spending updates the checkpoint; achievement journal recovery remains compatible. Bird refuses native charging when boot selected its volatile storage fallback. Late delivery records fulfillment analytics but does not resume an obsolete level/offer.

Evidence includes **43 shared service/pending/review tests**, **150 focused wallet/achievement tests**, real Bird/Dog wrapper-to-wallet tests, bootstrap/resume wiring, ordinary purchase delivery and volatile-storage refusal. Independent review found and corrected a transient-read retry that could have charged again, and rejected malformed or duplicate stored identities before they could be overwritten. See [wallet evidence](/tmp/fabrikav2-implementation/20260905-evaluation-repairs/u2-wallet-summary.md), [independent review tests](/tmp/fabrikav2-implementation/20260905-evaluation-repairs/iap-independent-review.log), and [final workspace log](/tmp/fabrikav2-implementation/20260905-evaluation-repairs/final-unit.log).

This recovery is deliberately bounded: it covers successful native results received after the UI timeout. It cannot recover a result never delivered to JavaScript before termination, or guarantee persistence when storage cannot write. Ordinary on-time purchases still return to their waiting caller; they are not journaled by this late-result mechanism. Customer-info restore remains non-consumable-only because restored product membership cannot safely identify individual consumable grants. A late continue bundle grants its wallet contents without reopening an obsolete attempt. No server reconciliation was added.

### U3 — iOS impression revenue keeps fractional currency values

`tools/patch-admob-ios-revenue.mjs` corrects all five affected AdMob 8.1.0 iOS formats: banner, interstitial, rewarded, rewarded interstitial and app open. It converts decimal currency to micros before integer serialization; Android remains unchanged. Root postinstall applies the correction. Version and complete-source hashes reject dependency drift; repeated application is idempotent and `--verify` is read-only. The iOS release preflight now checks the correction before building, and its affected runtime pins include the new script.

Four patch guard tests pass. An isolated Swift/Foundation check confirms `0.005 → 5000`, `0.0125 → 12500` and `1.5 → 1500000`. The correction was applied only to this worktree's cloned dependency installation; the original review worktree's dependency source was checked unchanged. Release verification added **35 focused**, **49 adjacent** and **one import-graph** passing checks; runners/filesystems were injected, except an existing temporary-plist fixture's read-only `plutil` call. No release executor or native build was run. See [runtime evidence](/tmp/fabrikav2-implementation/20260905-evaluation-repairs/runtime-implementation.md).

The API basis is Google's [iOS impression-level revenue documentation](https://developers.google.com/admob/ios/impression-level-ad-revenue). Reward-before-dismissal is verified against Google's current rewarded-ad documentation for the configured Google path; arbitrary future mediation ordering is not established by these tests.

### U4 — Generic editor backend and browser checks execute in CI

The explicit `level-editor` CI job runs `npm run editor2:ci -w @fabrikav2/level-editor-tool`. Its six stages install dependencies, apply the bounded dependency correction, run Python tests, typecheck, run all browser smokes and build the UI. Logs, JUnit results and fixture screenshots are uploaded even on failure.

The gate exports versions from the existing lockfile into a dedicated environment and substitutes one pinned public merceka-core revision. A hash-checked correction supplies the exact cost-attribution behavior already used by the local unpublished dependency. **Normal developer `pyproject.toml` and `uv.lock` are unchanged**; the correction cannot modify the editable sibling or shared cache. The installed environment passes a 93-package consistency check.

Tests strip ambient credentials, disable dotenv, use temporary workspaces, block unexpected network/CLI calls and reject unmocked browser API requests or exceptions. The only Python subprocess exception is the exact existing import-security probe. Negative probes demonstrate that swallowed network/CLI errors still fail the overall process. Stale fixtures were updated to current selectors, session autosave/lineup behavior and animation selection; no production editor behavior was changed to make tests pass.

The final combined gate passes **554 Python tests, zero skips, all 15 browser smokes, typecheck and UI build**. Python reports three existing deprecation warnings. See [six-stage results](/tmp/fabrikav2-implementation/20260905-evaluation-repairs/editor2-gate-final/results.json), [combined gate log](/tmp/fabrikav2-implementation/20260905-evaluation-repairs/editor2-gate-final.log), [backend log](/tmp/fabrikav2-implementation/20260905-evaluation-repairs/editor2-gate-final/backend.log), [browser log](/tmp/fabrikav2-implementation/20260905-evaluation-repairs/editor2-gate-final/browser.log), and [editor guidance](../../tools/level-editor/README.md).

### U5 — Full-shell scaffolds carry the new native identity

`tools/create-game/src/create-game.mjs` stamps native manifest game/app/bundle/display identity, game-selecting package scripts and reference package identity alongside Capacitor configuration. Reusable bridge classes and provider recipes remain unchanged. Actual template inputs are checked with the existing native validator, without executing native tooling.

Three real-input regressions failed before the fix. All **14 scaffold tests** now pass, including default/full-shell behavior, slug normalization, source-template preservation and overwrite/archive refusal. See [scaffold evidence](/tmp/fabrikav2-implementation/20260905-evaluation-repairs/u5-summary.md).

## Final checks and remaining boundaries

| Check | Outcome | Evidence |
|---|---|---|
| Workspace unit aggregate | PASS: 24 scripts; 3,630 Vitest + 130 Node tests; 392 Vitest files; 5 skipped | [log](/tmp/fabrikav2-implementation/20260905-evaluation-repairs/final-unit.log), [counts](/tmp/fabrikav2-implementation/20260905-evaluation-repairs/final-check-counts.json) |
| Workspace typecheck | PASS, exit 0 | [log](/tmp/fabrikav2-implementation/20260905-evaluation-repairs/final-typecheck.log) |
| Workspace lint | PASS, exit 0 | [log](/tmp/fabrikav2-implementation/20260905-evaluation-repairs/final-lint.log) |
| Generic editor complete gate | PASS, all six stages | [results](/tmp/fabrikav2-implementation/20260905-evaluation-repairs/editor2-gate-final/results.json) |
| Repository audit | FAIL, unchanged one local error; 40 warnings | [log](/tmp/fabrikav2-implementation/20260905-evaluation-repairs/audit.log) |
| Mirror and whitespace checks | PASS | [mirror](/tmp/fabrikav2-implementation/20260905-evaluation-repairs/final-mirror.log), final integrity record |

The local audit rejects the copied, ignored `games/find_the_bird/.env.ios.local` file; its contents were not printed or changed. It is the same baseline exception as the evaluation, not a new source finding. Existing shell-template AppsFlyer code still produces four native-validator issues; the scaffold test proves identity alignment and no added validator issues, not total native readiness. The release wrapper also retains two pre-existing stale pins (`package-lock.json` and `tools/game-env/src/policies/find-the-dog.mjs`). These were independently identified rather than hidden by refreshing unrelated approval data. Standalone ESLint on `ios-release.mjs` retains two pre-existing empty-catch diagnostics; the repository's required lint gate passes.

The unchanged FTD-specific editor's broader Python/corpus/schema gates were run during the original evaluation, not rerun for these repairs. Root workspace checks do not run the separate release-executor suite; the explicit fixture checks above cover this change. Node 26.7.0 was used locally; hosted CI uses Node 22. Browser evidence is Chromium with scripted transports and synthetic assets. One captured cutout fixture was opened for inspection; no physical gameplay or provider delivery is claimed.

Hosted CI for the original base [passed](https://github.com/batu/fabrikav2/actions/runs/33857610348). The newly advanced main [run](https://github.com/batu/fabrikav2/actions/runs/33965922651) was in progress when refreshed. There is no hosted CI result for these unpublished changes. [Hosted status record](/tmp/fabrikav2-implementation/20260905-evaluation-repairs/hosted-ci-current.json).

## Reviewable handoff

All 74 changed/new files remain in the isolated worktree. The original primary checkout's status is preserved: [comparison](/tmp/fabrikav2-implementation/20260905-evaluation-repairs/primary-state-final.json). The [complete uncommitted patch](/tmp/fabrikav2-implementation/20260905-evaluation-repairs/implementation.patch) includes new files; the [integrity record](/tmp/fabrikav2-implementation/20260905-evaluation-repairs/implementation-state.json) records each file hash and both revisions. Applying the patch against a temporary index of the newer main passes `git apply --cached --check` with no touched-file overlap. That is textual compatibility evidence, not a test of the combined runtime. Review the local diff before deciding on any publication or native acceptance work; neither is included in this execution.
