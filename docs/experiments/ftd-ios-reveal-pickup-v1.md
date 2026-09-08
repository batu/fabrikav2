# FTD iOS reveal / pickup v1

Status: implemented, **not activated or released**. Device rendering and backend receipts are release-owner gates, not unit-test claims.

Final local verification: **419 tests passed (51 files, no skips)**, TypeScript, ESLint, iOS release-environment validation, iOS-mode Vite build, and `git diff --check` passed. Review fixes include a whole-config startup deadline, no added experiment config wait on Android/web, reveal asset readiness before exposure, recoverable setup failure, actual scene lifecycle coverage, torn enrollment writes, and pre-session dimension ordering. These are source/compiled-web checks, not physical-device or provider-ingestion receipts.

## Assignment and wallet

- Experiment ID: `ftd_ios_reveal_pickup_v1`, independent of the CDN experiment. The existing SHA-256 cohort resolver assigns buckets 0–49 to `reveal` (Classic grayscale + forced Voronoi), 50–99 to `pickup` (Restoration). This is 50% allocation probability, not guaranteed equal small-sample counts.
- `bootstrap.ts` captures install evidence before eager GameState imports, awaits config + experiment preparation, then imports the runtime that constructs Phaser. Home prewarming and GameScene share `resolveGameplayMode`; enrolled treatment cannot change on config refresh or saved preference edits.
- Durable record: `ftd_reveal_pickup_v1`. Missing/corrupt records on returning installs, unavailable storage, invalid/unpersisted buckets, interrupted enrollment and unknown install history fail closed. Valid records resume offline without rerolling. Partial storage deletion is not permission to re-enroll.
- Both arms initialize the actual wallet to 10 once, only while its hint key and purchase checkpoint are absent. No broad save/reset or returning-player top-up. A pending record precedes async assignment; the wallet is persisted before the final enrollment record. A torn enrollment may exclude the install rather than replay the grant.
- **Economy decision:** `MAX_HINT_BALANCE=3` remains the existing free-accrual cap for both arms. Starting hints are a one-time above-cap allocation, preserved through save/load/spend. Free grants remain blocked until the balance falls below 3; paid grants remain uncapped. This avoids changing any ongoing economy parameter besides the requested initial balance.

## Remote controls (both default false)

| Remote key | Meaning |
| --- | --- |
| `ftd_ios_reveal_pickup_v1_enabled` | Allow enrollment of genuinely new native iOS installs. Turning this off stops new enrollment; existing assignments continue offline. |
| `ftd_ios_reveal_pickup_v1_killed` | End participation at the next cold launch that observes true, preserving wallets. Locally sticky once observed, including subsequent offline launches. Does not switch a running session. |

The kill is terminal for this experiment ID on an affected install; use a separately reviewed experiment ID for a later experiment. Neither key has been changed remotely. Existing `gameplay_initial_hints` remains untouched/unconsumed for nonparticipants.

### Timeout semantics

The entire Remote Config startup (including Firebase support/initialization checks) is bounded to 5000 ms with timer cleanup on success, rejection or expiry; rejection/expiry forbids new enrollment even with a cached enable, restores only a valid durable assignment using the currently validated config's kill value (default false) plus any durable terminal kill, preserves the wallet, and freezes that launch's participation so late config completion cannot enroll, reroll or kill it during play.

## Telemetry

- Existing canonical `experiment_exposure` / GA `experiment:exposure`, once per cold launch after a visible Phaser post-render frame and removal of the scene-entry cover. Setup failures and mode mismatches cannot count as exposure. Restoration additionally requires every downloaded background texture, alongside existing sprite/geometry validation; no placeholder/fallback is called pickup.
- All composition-owned canonical envelopes carry `experiment_id`, `variant`, `experiment_population`, `enrollment_day` (UTC), `starting_hints=10`, and launch-local `experiment_exposed`. The canonical allowlists preserve these through GameAnalytics and OwnedMirror, including first-session/foreground/outcome events. Exposure also carries actual mode and bucket.
- GA custom dimension **01** is reserved for `rp_v1_reveal`, `rp_v1_pickup`, `rp_v1_not_enrolled`, `rp_v1_qa_reveal`, `rp_v1_qa_pickup`. Configure its bounded values in GA's project UI before activation and verify the query path; event custom fields alone are not a dashboard retention segment.
- Dimension setup occurs before GA `initialize()` creates the native first session, before subsequent `startSession()`, and on dispatched events. The nonempty non-enrolled sentinel matters: GA 4.4.7 restores a saved dimension when its pre-init value is empty. Native version/build remain supplied by the existing GA native identity path; OwnedMirror retains its existing source-build identity (do not treat that as native archive identity).
- QA on the same release binary: set `ftd_reveal_pickup_qa=1` in a **dedicated authorized fresh QA installation before enrollment**. Population is captured in the enrollment record and stays QA if that marker is later removed. This marker never forces eligibility, mode, hints or config activation. Do not reset an existing device's saved data to obtain a QA cohort.

## Analysis and release gates

Primary D1 analysis uses provider user identity and **all eligible enrolled production users per arm** (intention-to-treat), with an explicit provider day/timezone convention and mature denominators. Report an exposed-user view and allocation-to-exposure conversion separately; never remove failed or unexposed enrolled players merely to improve the result. `enrollment_day` is UTC; it is not itself a user identity or exposure proof. Exclude QA dimension values and nonproduction environments. Existing contaminated native playtime/session aggregates remain quarantined.

Before enabling: physically verify both modes, ten hints, hint spend + relaunch, matching exposure, and completion on the exact candidate build; confirm every served level supports both modes; obtain queryable backend receipts for both controlled QA exposures and validate the production-segment exclusion. No live provider configuration, build-number bump, merge, deploy, device reset or release is included in this source change.

## Local verification

Use this worktree's `@fabrikav2/*` workspace links, not the dirty main checkout's package symlinks. The parent tool binaries can be invoked read-only. Node's experimental web-storage global must be disabled when running these happy-dom tests (`NODE_OPTIONS=--no-experimental-webstorage`). The worktree has a private copy of gameanalytics@4.4.7 with the repository's existing persistence postinstall patch; main node_modules is unchanged.

Observed red-first failures covered missing wallet initialization, missing experiment module, corrupt/out-of-range/unpersisted/offline assignment behavior, missing exposure API, first native-session dimension ordering, boot-before-assignment ordering, storage-denied eligibility, missing downloaded restoration backgrounds, and QA segregation. Final unit/typecheck/lint evidence is captured under `.context/reveal-pickup-ab-verification.json`.
