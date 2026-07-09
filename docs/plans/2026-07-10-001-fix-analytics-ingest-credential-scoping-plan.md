---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: trello-card:csYLD5PK
canonical_contract: true
supersedes: docs/plans/2026-07-10-001-fix-analytics-ingest-credential-binding-plan.md
title: Bind Analytics Ingest Credentials to Game and Environment - Plan
type: fix
date: 2026-07-10
origin: trello-card:csYLD5PK
trello: https://trello.com/c/csYLD5PK
execution: code
---

# Bind Analytics Ingest Credentials to Game and Environment - Plan

> **Canonical contract for Trello card `csYLD5PK`.** This plan supersedes
> `2026-07-10-001-fix-analytics-ingest-credential-binding-plan.md`. Implement
> only this document; the superseded file is retained as a historical pointer.

## Goal Capsule

- **Objective:** Make each owned-analytics ingest credential carry explicit, least-privilege game and environment claims, and validate the batch envelope's `game_id`/`env` against those claims — before duplicate/rate/replay/skew/storage work — so a key issued for one game/env can never submit for another.
- **Authority:** Ratified Trello card `csYLD5PK` (AUDIT #10). The card names `packages/services/src/analytics-worker/auth.ts` as this card's owned contract file and forbids re-declaring the envelope shape: claims are validated against the canonical SDK wire envelope without adaptation.
- **Execution profile:** Headless services change in `packages/services/src/analytics-worker/**` plus its Vitest suite, a doc-only touch in `packages/sdk/src/analytics`, a new operational runbook under `docs/`, and the `wrangler.template.toml` config surface. Code + tests only — no deploy, no live credential rotation.
- **Scope fence:** Do not rotate or mint production credentials, do not deploy the worker, do not change the wire schema tag `fabrika-owned-analytics-v1`, do not re-declare the envelope shape in `auth.ts`, and do not touch query-path auth (`query.ts` operator token) beyond what credential parsing shares.
- **Stop conditions:** Stop and consult the conductor if the fix appears to require changing the SDK wire contract, adding a runtime dependency, introducing a game/env wildcard or runtime legacy-auth fallback, or weakening the fail-closed rule to make a test pass.

---

## Product Contract

### Summary

Today the ingest worker treats public client keys as a flat allowed set (`ANALYTICS_PUBLIC_CLIENT_KEYS`) while the caller independently chooses `game_id` and `env` on the batch envelope. Authentication proves only that *some* enabled key was presented; it never proves the key is entitled to the game or environment the batch claims. A key copied out of one game's client can therefore submit production events for a different game, or dev/test traffic can be posted as production. This plan binds every credential to an explicit set of allowed `game_id`s and `env`s and rejects any envelope whose identity falls outside the presenting credential's claims.

### Problem Frame

In `packages/services/src/analytics-worker/ingest.ts`:

- `readAnalyticsWorkerConfig` (lines 205–219) builds `publicClientKeys` as a flat `ReadonlySet<string>` and `allowedGameIds` as a separate flat set. There is no relation between the two.
- `authenticate` (lines 304–314) accepts any bearer token present in `publicClientKeys` and returns only the raw key string.
- `parseOwnedAnalyticsBatch` (lines 236–256) validates `game_id` against the *deployment-wide* `allowedGameIds` and `env` against the enum, but neither check is scoped to the presenting credential.

The result: `{ presented key } × { any served game_id } × { any env }` is fully permitted. The audit calls for representing each credential as explicit game/environment claims with least privilege, validating envelope identity against those claims before rate/replay/storage, and documenting a rotation/migration path. Browser keys are public by nature, so the design is containment (tight per-key scope, rate limits, rotation) rather than pretend secrecy.

### Requirements

**Credential Claims Contract (owned by `auth.ts`)**

- R1. `packages/services/src/analytics-worker/auth.ts` is created and is the single owner of the ingest-credential claim type, credential parsing, bearer authentication, and envelope-scope authorization. `ingest.ts` imports these; the existing `authenticate` helper is moved out of `ingest.ts` into `auth.ts`.
- R2. A credential is represented as explicit claims: `{ key, games, envs }`, where `games` is a non-empty set of `game_id`s the key may submit for and `envs` is a non-empty set of `AnalyticsEnvironment` values (`production` | `development` | `test`) the key may submit for. Scoped credentials never carry a game or env wildcard (least privilege).
- R3. Scope authorization consumes the canonical SDK envelope (`OwnedAnalyticsWireBatch` / `OwnedAnalyticsWorkerBatch`) directly and reads `batch.game_id` and `batch.env` off it — no adapter type, no reshaped copy (contract-ownership / zero-adaptation lesson).
- R4. Envelope-scope authorization runs after batch parse (so `game_id`/`env` are known) and **before** in-batch duplicate detection, rate limiting, replay lookup, clock-skew rejection, and storage. For any structurally valid out-of-scope batch, scope denial has precedence over every one of those downstream outcomes.

**Deterministic Denial (fail closed)**

- R5. A submission whose `game_id` or `env` is outside the presenting credential's claims is denied deterministically with HTTP 403 and the single external error code `forbidden_scope`. The response is identical for game and environment mismatch; the worker may classify the reason internally only after authentication.
- R6. Authorization always performs both set-membership checks before branching, then chooses `game` before `env` solely as the stable internal reason when both mismatch. That reason is available to counters/logging but never changes the public status, code, message, response shape, number of claim lookups, or downstream control path.
- R7. Unknown or malformed credential configuration fails closed. A non-array or unparseable top-level value yields zero credentials rather than an exception or 500; a malformed entry is dropped and never widened. Canonical keys are computed with `rawKey.trim()` for collision detection, while entries whose raw key differs from that canonical value are invalid. A first pass counts every string key before validating the rest of its entry; any canonical key seen more than once is permanently poisoned for that entire parse and can never be inserted, including with three or more occurrences, whitespace variants, or valid/malformed-entry permutations.
- R8. Denial responses never echo the presented key, the credential's claim lists, or any other secret material; messages are generic.

**Denial Logging / Observability**

- R9. Scope denials increment exactly one internal reason counter (`forbiddenScopeGame` or `forbiddenScopeEnv`) distinct from `unauthorized`. `totalAbuse` sums both reason counters once, the state snapshot exposes both, and a structured log records `{ game_id, env, scope_reason }` without key or claim material.

**Configuration & Migration**

- R10. The scoped credential config is a secret env var (`ANALYTICS_INGEST_CREDENTIALS`) whose value is a JSON array of `{ key, games, envs }` objects. Keys keep the existing `length >= 16` guard; `games` entries must match the existing `game_id` pattern; `envs` entries must be valid `AnalyticsEnvironment` values.
- R11. The scoped secret is the only runtime source of ingest credentials. Presence is tested as `env.ANALYTICS_INGEST_CREDENTIALS !== undefined`, not by truthiness: **unset**, **present-but-empty/whitespace**, **unparseable/non-array**, and **valid array** are distinct sanitized config states. The first three all produce zero credentials (deny all); a valid array may contain valid entries. Legacy `ANALYTICS_PUBLIC_CLIENT_KEYS` is an offline migration input only. `ANALYTICS_ALLOWED_GAME_IDS` remains the independent coarse deployment parser allow-list, but neither variable is read as a credential fallback, unioned with scoped claims, or converted to `anyGame`/all-env grants.
- R12. `docs/` gains an operational issuance/rotation runbook covering JSON format, per-Wrangler-environment secret setup, migration from flat variables before deploy, and mobile-safe rotation. Rotation is: add a new narrowly scoped key alongside the old narrowly scoped key in each target environment; deploy and verify both; release clients with the new key; overlap for at least 30 days (or the longer published client-support window) and until at least 99% of 14-day active supported clients are on app versions configured with the new key, with no supported old-key-only version remaining; remove the old key; deploy and verify; retain a rollback payload that restores the old narrow grant. The runbook names the release/telemetry owner, requires separate development/test/production changes, forbids widening claims during rollback, and states that actual issuance/rotation is a human release follow-up.

**Compatibility & Tests**

- R13. A correctly provisioned scoped submission (credential whose claims include the batch's `game_id` and `env`) still succeeds and stays compatible with the SDK owned-mirror-sink envelope — no SDK wire change; at most a doc/comment note in `packages/sdk/src/analytics/wire.ts` clarifying that `game_id`/`env` are auth-scoped server-side.
- R14. Tests cover multi-game and all canonical environments, distinct unset/empty/malformed secret states, no legacy runtime fallback, permanent duplicate poisoning across canonical collisions and malformed permutations, denial precedence over every downstream gate, reason metrics, mobile-safe overlap configuration, and secret-safe responses.

### Acceptance Examples

- AE1. Given a scoped credential `{ key: K, games: ['marble_run'], envs: ['production'] }`, when a batch with `game_id: 'find_the_dog'`, `env: 'production'` is posted with `Bearer K`, the worker responds 403 `forbidden_scope`, increments `forbiddenScopeGame`, and performs no storage write.
- AE2. Given the same credential K, when a batch with `game_id: 'marble_run'`, `env: 'development'` is posted with `Bearer K`, the worker returns the same public 403 `forbidden_scope` body as AE1, increments `forbiddenScopeEnv`, and performs no storage write.
- AE3. Given the same credential K, when a batch with `game_id: 'marble_run'`, `env: 'production'` is posted with `Bearer K`, the worker responds 202 and writes the batch (scoped happy path, SDK-envelope compatible).
- AE4. Given two scoped credentials — `{ key: Kp, games: ['marble_run'], envs: ['production'] }` and `{ key: Kd, games: ['marble_run'], envs: ['development','test'] }` — Kp is denied for `development` and Kd is denied for `production`; every denial has the same external status/code/message while internal reason counters remain accurate.
- AE5. Given `ANALYTICS_INGEST_CREDENTIALS` is (a) unset, (b) present as `''`/whitespace, or (c) malformed/non-array, each case yields a distinct sanitized parser status and an empty credential registry. Even if legacy `ANALYTICS_PUBLIC_CLIENT_KEYS=K` and `ANALYTICS_ALLOWED_GAME_IDS='marble_run,find_the_dog'` are set, `Bearer K` is denied; there is no runtime bridge.
- AE6. Given a valid top-level credentials array containing a malformed entry (missing `games`, empty `envs`, an invalid env value, or a too-short key) alongside a uniquely keyed valid entry, the malformed entry is dropped and only the valid credential authenticates; raw config and key material are never logged or returned.
- AE7. Given a scope denial, the JSON response contains neither the presented key, claim lists, nor whether game or env failed. Exactly one internal reason counter increments, `unauthorized` and all downstream counters/state do not, and `totalAbuse` increases once.
- AE8. Given the scoped config contains the same canonical key two, three, or more times — including `K`, ` K `, and entries whose other claims are malformed — that canonical key is permanently poisoned and authenticates nothing. A different uniquely keyed valid entry still authenticates.
- AE9. Given a structurally valid out-of-scope batch that also has duplicate event IDs, would exceed its rate cost, contains a replayed ID, and has clock-skewed timestamps, the worker still returns 403 `forbidden_scope`; duplicate/rate/replay/skew counters and state remain unchanged, storage is not called, and only the matching internal scope-reason counter increments.
- AE10. Given a mobile rotation registry containing old key `Ko` and new key `Kn` with identical narrow claims, both work during overlap. Removing `Ko` is permitted only after the runbook's environment-specific adoption/support gate; restoring the saved narrow `Ko` entry is the rollback and never widens claims.

### Scope Boundaries

**In scope**

- New `packages/services/src/analytics-worker/auth.ts` (owned contract: claim type, parsing, `authenticate`, `authorizeEnvelope`).
- `packages/services/src/analytics-worker/ingest.ts` — remove local `authenticate`, import from `auth.ts`, thread the credential through the fetch flow, insert the scope check before duplicate/rate/skew/replay/storage, add scope config to `readAnalyticsWorkerConfig` and `AnalyticsWorkerConfig`.
- `packages/services/src/analytics-worker/contracts.ts` — add the two internal scope-reason counters to `AnalyticsWorkerAbuseCounters`; add the `ANALYTICS_INGEST_CREDENTIALS` field to `AnalyticsWorkerEnv`.
- `packages/services/src/analytics-worker/index.ts` — re-export the new `auth.ts` public surface alongside the existing exports.
- New `packages/services/src/analytics-worker/auth.test.ts` plus additions to `ingest.test.ts` for the fetch-level denial/logging paths.
- `packages/services/src/analytics-worker/wrangler.template.toml` — document `ANALYTICS_INGEST_CREDENTIALS` as mandatory secret auth config, retire `ANALYTICS_PUBLIC_CLIENT_KEYS`, and preserve `ANALYTICS_ALLOWED_GAME_IDS` only as the coarse parser allow-list.
- `docs/` — new operational issuance/rotation/migration runbook.
- `packages/sdk/src/analytics/wire.ts` — doc/comment-only clarification (no shape change).

**Out of scope**

- No wire schema tag change; no new SDK payload fields; no `owned-mirror-sink.ts` behavior change.
- No rotation or minting of real/production credentials; no `wrangler deploy`; no account ids or secret values committed.
- No runtime authentication bridge from `ANALYTICS_PUBLIC_CLIENT_KEYS` or wildcard/all-environment legacy grant. A human may read the retired public-key value while preparing the scoped secret; worker authorization code never does.
- No change to query-path operator auth semantics in `query.ts` beyond reusing shared credential-parsing helpers if genuinely shared.
- No wildcard game/env in the scoped credential format.
- No change to duplicate, rate-limit, replay, clock-skew, or storage logic other than inserting the scope check ahead of them and proving those paths stay unmutated on denial.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **`auth.ts` owns the credential seam end-to-end.** Moving `authenticate` there and adding `parseIngestCredentials` + `authorizeEnvelope` gives one file that owns credential → claims → envelope authorization, matching the card's contract-ownership mandate and keeping `ingest.ts` a thin orchestrator.
- KTD2. **`authorizeEnvelope` takes the canonical `OwnedAnalyticsWorkerBatch` (= SDK `OwnedAnalyticsWireBatch`) directly.** It reads `batch.game_id`/`batch.env` with no intermediate DTO, satisfying "validate against the canonical envelope without adaptation" and the zero-adaptation round-trip lesson.
- KTD3. **Scope check is a new step between parse and all downstream gates.** `authenticate` still runs first, but scope authorization needs the parsed envelope, so it is inserted immediately after `parseOwnedAnalyticsBatch` and before `firstDuplicate`, rate mutation, skew inspection, replay lookup, or store creation/write. A composite precedence test makes a 403 scope denial win even when every later gate would reject.
- KTD4. **`parseOwnedAnalyticsBatch` and `allowedGameIds` stay as the coarse deployment allow-list.** Parse keeps validating shape + deployment enablement (`unknown_game_id` 400); credential scope is a separate per-key layer whose only public denial is `forbidden_scope` 403. Served-but-not-entitled games reach scope authorization; malformed or deployment-disabled identities retain their existing 400 behavior.
- KTD5. **Scoped JSON is the sole runtime credential authority.** `ANALYTICS_INGEST_CREDENTIALS` is set with `wrangler secret put`. Missing, empty/whitespace, malformed, and non-array values have distinct sanitized parser statuses but all produce an empty registry. The retired flat public-key variable is documented only so an operator can translate its current values into explicit claims before deploy; the existing allowed-game variable remains a coarse parser guard, never an authorization fallback.
- KTD6. **Two-pass canonical duplicate poisoning.** First pass: for every array element whose `key` is a string, compute `canonicalKey = key.trim()` and count it before examining key length, `games`, or `envs`. Second pass: an entry is eligible only when its raw key equals its canonical key, the canonical count is exactly one, and all claims validate. A canonical count above one permanently excludes that key for the parse, so deletion/reinsertion ordering and malformed duplicates cannot resurrect it. Non-array top-level config denies all; bad entries never widen another grant.
- KTD7. **One public denial, internal reason metrics.** `authorizeEnvelope` computes both game and env membership booleans on every call, then selects an internal reason (`game` before `env` only when both fail). `fetch` maps every scope failure to the same static 403 `forbidden_scope` response. Flat counters `forbiddenScopeGame` and `forbiddenScopeEnv` retain operational detail; `totalAbuse` sums both once and logs never include a key or claim list.
- KTD8. **Mobile-safe rotation is overlap, not instant replacement.** An existing key is first represented with narrow claims in the scoped registry. A new key is added with the same or narrower claims per Wrangler environment; both remain valid through deployment verification and the declared minimum support/adoption window. Revocation is a second deploy only after the release owner records the threshold evidence; rollback restores the saved old narrow entry, never a wildcard.

### High-Level Technical Design

```mermaid
flowchart TB
  E[env: ANALYTICS_INGEST_CREDENTIALS JSON] --> P[auth.parseIngestCredentials]
  L[legacy public-key var] -->|offline operator migration only| M[explicit scoped JSON]
  M --> E
  P -->|missing / empty / invalid| Q[empty registry: deny all]
  P -->|loaded array| CS[IngestCredentialSet: key -> {games,envs}]
  R[POST /ingest + Bearer key] --> A[auth.authenticate]
  CS --> A
  A -->|credential| B[parseOwnedAnalyticsBatch: shape + deployment allow-list]
  B -->|OwnedAnalyticsWorkerBatch| Z[auth.authorizeEnvelope credential x batch.game_id/env]
  Z -->|forbidden_scope 403 + internal reason counter| X[deny, no downstream mutation]
  Z -->|ok| D[duplicate -> rate -> skew -> replay -> store]
```

### Assumptions

- A1. There is no upstream brainstorm artifact; the ratified Trello card `csYLD5PK` is the product contract (`needs-plan` classification).
- A2. The card's phrase "dev/staging/prod" is loose language for "multiple environments." The canonical `AnalyticsEnvironment` enum is `production | development | test` (see `packages/sdk/src/analytics/contract.ts:33`); there is no `staging` wire env, and the existing suite already treats `env: 'staging'` as `invalid_env`. The multi-environment tests use the real three. (Flagged as a card-vs-code wording gap.)
- A3. A secret env var holding a JSON string is an acceptable Cloudflare Worker pattern (set via `wrangler secret put`); the template already sets `ANALYTICS_PUBLIC_CLIENT_KEYS` as a comma-separated secret, so a JSON secret is a small extension of the same mechanism.
- A4. The SDK owned-mirror-sink is already configured per game/env when it builds batches, so a correctly provisioned scoped key matches its emitted envelope with zero client change — SDK edits are doc-only.
- A5. Adding the two internal reason counters to `AnalyticsWorkerAbuseCounters` is safe because response-body counter assertions in the suite use `toMatchObject` (partial) and `buildSourceHealthRow` consumes only `totalAbuse`.

### Risks and Dependencies

- **Ordering regression risk:** The scope check must sit before duplicate/rate/skew/replay/store. A composite test gives an out-of-scope batch duplicate IDs whose event count would exceed its rate cost, skewed timestamps, and an existing replay key, then asserts the 403 scope response, unchanged downstream counters/state, and no storage call.
- **Silent-widening risk:** A malformed scoped entry must never fall back to "any game/any env." Tests must include malformed entries mixed with valid ones and assert the malformed ones grant nothing.
- **Duplicate-resurrection risk:** A single-pass set/delete implementation can accept occurrence three after occurrence two deletes the key, or preserve a valid entry when a malformed duplicate is dropped first. Two-pass canonical counting plus tests for 2/3/4 occurrences, whitespace variants, and valid/malformed order permutations closes that path.
- **Migration cutover risk:** Deploying the new worker before setting a valid scoped secret denies all ingest; retaining a runtime legacy bridge would preserve the vulnerability. The runbook therefore requires per-environment secret preflight and rollback payload capture before code deploy, with no authorization fallback.
- **Counter-shape ripple:** Adding `forbiddenScopeGame` and `forbiddenScopeEnv` touches the abuse-counter object literal, `totalAbuse`, and state snapshot; a missed site would under-count or double-count. Grep all `abuseCounters`/`totalAbuse` sites during implementation.
- **Secret/oracle risk:** Every scope failure must map to a byte-identical external `forbidden_scope` response. Tests compare status and serialized body for game-only, env-only, and both-mismatch requests and assert no key, claims, or internal reason escapes.
- **Mobile revocation risk:** Removing an embedded browser key before supported app versions adopt the replacement strands installed clients. The runbook requires named release ownership, environment-specific evidence, a minimum support window, an adoption threshold, and a saved narrow rollback payload before removal.
- **Contract-drift risk:** `authorizeEnvelope` must import the batch type from the SDK-owned contract (via `contracts.ts` re-export), not re-declare `{ game_id, env }`, or it reintroduces the exact drift the contract-ownership lesson forbids.

### Sources and Research

- `packages/services/src/analytics-worker/ingest.ts:31-32,205-219` — flat `publicClientKeys`/`allowedGameIds` config; `:236-256` parser deployment allow-list; `:304-314` `authenticate` returning only the raw key.
- `packages/services/src/analytics-worker/contracts.ts:77-99` — `AnalyticsWorkerEnv` binding shape (where `ANALYTICS_INGEST_CREDENTIALS` is added); `:142-155` — `AnalyticsWorkerAbuseCounters` and snapshot.
- `packages/sdk/src/analytics/wire.ts:41-48` — canonical `OwnedAnalyticsWireBatch`; comment already states `game_id` is "never trusted for auth," which this card operationalizes server-side.
- `packages/sdk/src/analytics/contract.ts:33` — `AnalyticsEnvironment = 'production' | 'development' | 'test'`.
- `packages/services/src/analytics-worker/contracts.ts:39` — worker schema aliases the SDK `OWNED_ANALYTICS_WIRE_SCHEMA`; the zero-adaptation round-trip is already established (`wire-roundtrip.test.ts`), and MEMORY `analytics-wire-contract-gap` records the producer-owns-the-contract resolution.
- `packages/services/src/analytics-worker/ingest.test.ts` — existing fetch-level test harness (`enabledEnv`, `batch`, `request`) the new denial/logging tests extend; `:99` and `query.test.ts:61` confirm `staging` is not a valid env.
- `packages/services/src/analytics-worker/wrangler.template.toml` — where the mandatory scoped secret, retired flat public-key var, and independent deployment game allow-list are documented.
- Board lesson `contract-ownership`; MEMORY `trace-pipeline-seams-end-to-end` (write the seam map first; vocabularies are per-game data).

---

## Implementation Units

### U1. Create `auth.ts` — the owned credential contract

- **Goal:** One file owning the ingest-credential claim type, config parsing, bearer authentication, and envelope-scope authorization.
- **Requirements:** R1, R2, R3, R7, R8, R10, R11, KTD1, KTD2, KTD5, KTD6.
- **Dependencies:** None.
- **Files:** new `packages/services/src/analytics-worker/auth.ts`.
- **Approach:**
  - Define `IngestCredential = { readonly key: string; readonly games: ReadonlySet<string>; readonly envs: ReadonlySet<AnalyticsEnvironment> }`; there is no wildcard, `legacy`, or `anyGame` field.
  - `parseIngestCredentials(env: AnalyticsWorkerEnv)` returns `{ credentials, configState, malformedEntries, duplicateCanonicalKeys }`, where `configState` is exactly `'missing' | 'empty' | 'invalid' | 'loaded'`. `undefined` → `missing`; present but trim-empty → `empty`; JSON failure or non-array top level → `invalid`; an array (including `[]`) → `loaded`. Every state except a loaded array with valid unique entries has zero corresponding credentials; none consults legacy vars.
  - For a loaded array, perform two passes. Pass 1 counts `rawKey.trim()` for every entry with a string key, before validating key length or claims, and records canonical keys whose count exceeds one. Pass 2 accepts only entries whose raw key equals the canonical key, canonical count is exactly one, key length is at least 16, `games` is a non-empty array of valid game IDs, and `envs` is a non-empty array of canonical environments. Never delete a duplicate marker; never let later entries reinsert it. Count each rejected entry as malformed and each poisoned canonical value once in `duplicateCanonicalKeys`.
  - `authenticate(request, credentials): { ok: true; credential } | { ok: false; status: 401|403; error }` — moved from `ingest.ts`; bearer parsing unchanged, membership check now against the credential map.
  - `authorizeEnvelope(credential, batch: OwnedAnalyticsWorkerBatch): { ok: true } | { ok: false; reason: 'game'|'env' }` — reads `batch.game_id`/`batch.env` directly and always computes both membership booleans before selecting game-over-env precedence for internal classification. It does not construct a public error or include claims/key material.
  - Share the `game_id` pattern and env validator with `ingest.ts` (export from one place; reuse `isAnalyticsEnvironment`/`GAME_ID_PATTERN`) rather than re-declaring.
- **Patterns to follow:** the existing `authenticate` return-union style and the `envList`/`envFlag` helpers in `ingest.ts`; the SDK-import discipline in `contracts.ts`.
- **Test scenarios:** covered in U4 (`auth.test.ts`).
- **Verification:** `auth.ts` imports the batch type from `contracts.ts` (SDK-owned); no local `{ game_id, env }` re-declaration; no read of legacy authorization variables; no wildcard field; typecheck clean.

### U2. Wire the scope check into the ingest flow

- **Goal:** Thread the authenticated credential through `fetch`, validate the envelope before every downstream rejection/mutation, and expose internal reason metrics behind one public denial.
- **Requirements:** R4, R5, R6, R9, KTD3, KTD4, KTD7.
- **Dependencies:** U1.
- **Files:** `packages/services/src/analytics-worker/ingest.ts`, `packages/services/src/analytics-worker/contracts.ts`, `packages/services/src/analytics-worker/index.ts`.
- **Approach:**
  - Remove the local `authenticate` from `ingest.ts`; import `authenticate`, `authorizeEnvelope`, `parseIngestCredentials`, and `IngestCredential` from `auth.ts`.
  - Replace `publicClientKeys`/`allowedGameIds` usage for auth: `readAnalyticsWorkerConfig` builds `credentials` via `parseIngestCredentials(env)` and keeps `allowedGameIds` for the parser's coarse deployment check. Update `AnalyticsWorkerConfig` accordingly.
  - In `fetch`: `authenticate(request, config.credentials)` → on failure keep the current `unauthorized++` + `jsonError`. Immediately after `parseOwnedAnalyticsBatch` succeeds, call `authorizeEnvelope(auth.credential, parsed.batch)`. On failure, increment exactly one of `forbiddenScopeGame`/`forbiddenScopeEnv`, log a sanitized structured reason, and return the same static `jsonError(403, { code: 'forbidden_scope', message: 'Credential is not authorized for this analytics scope.' })` for both reasons.
  - Add both reason counters at zero to the `abuseCounters` initializer and `AnalyticsWorkerAbuseCounters`; include their sum once in `totalAbuse` and expose both unchanged in `stateSnapshot`/existing 429 counter bodies.
  - Add `ANALYTICS_INGEST_CREDENTIALS?: string` to `AnalyticsWorkerEnv`.
  - Re-export the `auth.ts` public surface from `index.ts`.
- **Patterns to follow:** existing counter-increment + `jsonError` idiom in `fetch`; existing `readAnalyticsWorkerConfig` structure.
- **Test scenarios:** fetch-level denial/logging cases in U4 (`ingest.test.ts` additions).
- **Verification:** the composite precedence test proves scope runs before duplicate/rate/skew/replay/store and mutates only its reason counter; game/env/both mismatch responses serialize identically; `totalAbuse` increases once per denial.

### U3. Config template + operational runbook + SDK doc note

- **Goal:** Document fail-closed scoped-secret provisioning, pre-deploy migration, and mobile-safe per-environment rotation; clarify the SDK envelope's server-side auth scoping.
- **Requirements:** R12, R13.
- **Dependencies:** U1 (format is finalized there).
- **Files:** `packages/services/src/analytics-worker/wrangler.template.toml`, new `docs/architecture/analytics-ingest-credentials.md` (or `docs/reports/` — implementer picks the closest existing convention; `docs/architecture` preferred), `packages/sdk/src/analytics/wire.ts` (comment only).
- **Approach:**
  - Template: add `# wrangler secret put ANALYTICS_INGEST_CREDENTIALS` with a redacted JSON shape, state the secret is mandatory before enabling/deploying this worker, and label `ANALYTICS_PUBLIC_CLIENT_KEYS` as a removed runtime auth source. Keep `ANALYTICS_ALLOWED_GAME_IDS` documented only as the independent deployment-wide parser allow-list, not a credential fallback. Do not commit example key material.
  - Runbook migration preflight, repeated separately for Wrangler development, test, and production environments: inventory each existing public key and its actual game/env use; translate it into a narrow structured entry; save an encrypted/approved rollback payload; set the scoped secret in the target environment; validate its sanitized state with a preflight/dry-run or staging deployment; only then deploy/enable the new worker. Unset/empty/malformed secret means deny all, never legacy fallback.
  - Runbook rotation: name a release owner and use app-version telemetry/release-dashboard data (never raw key logging) to measure active supported clients. Add `Kn` beside narrow `Ko`, deploy and canary both, release clients with `Kn`, then keep overlap for at least 30 days or the longer published client-support window and until at least 99% of 14-day active supported clients run versions configured with `Kn`, with no supported `Ko`-only version remaining. Revoke `Ko` in a second deploy only after those gates and normal ingest/denial metrics are recorded. Rollback restores the saved *narrow* `Ko` entry and redeploys; it never restores flat config or widens claims. Repeat and verify independently per Wrangler environment.
  - Include the public-browser-key containment note (scope tightly, rely on rate limits + measured rotation, never treat the embedded key as confidential) and state that actual secret issuance/rotation/deploy remains a human release follow-up.
  - `wire.ts`: one-line comment clarifying `game_id`/`env` are authorization-scoped server-side against the presenting credential.
- **Patterns to follow:** existing template comment style; existing `docs/architecture` doc format.
- **Test scenarios:** none (docs); referenced by the Definition of Done.
- **Verification:** runbook names the mandatory preflight, environment isolation, release owner, 99%-of-14-day-active adoption gate, 30-day-or-longer support window, overlap verification, rollback payload, containment posture, and release-follow-up caveat; no secret values are committed.

### U4. Tests — scope, config states, duplicate poisoning, precedence, metrics

- **Goal:** Prove cross-game/cross-env denial behind one public response, strict config-state behavior, permanent canonical duplicate poisoning, downstream precedence, and secret-safe reason metrics.
- **Requirements:** R14, all acceptance examples AE1–AE10.
- **Dependencies:** U1, U2.
- **Files:** new `packages/services/src/analytics-worker/auth.test.ts`; additions to `packages/services/src/analytics-worker/ingest.test.ts`.
- **Approach:** unit-test `parseIngestCredentials`/`authorizeEnvelope` directly in `auth.test.ts`; extend `ingest.test.ts` with fetch-level cases using the existing `enabledEnv`/`batch`/`request` harness (add an `ANALYTICS_INGEST_CREDENTIALS` override helper).
- **Test scenarios:**
  - Covers AE1. Scoped key for `marble_run/production`, batch `find_the_dog/production` → 403 `forbidden_scope`, `forbiddenScopeGame + 1`, `writeDataPoint` not called.
  - Covers AE2. Same key, batch `marble_run/development` → byte-identical 403 `forbidden_scope`, `forbiddenScopeEnv + 1`, no write.
  - Covers AE3. Same key, batch `marble_run/production` → 202 with the existing accepted-body shape.
  - Covers AE4. `Kp` (prod) and `Kd` (dev+test): all game-only, env-only, and both-mismatch denials have the same serialized response across repeated attempts while the correct internal reason counter changes.
  - Covers AE5. Table-test `undefined`, `''`, whitespace, malformed JSON, object/null/scalar top levels, `[]`, and a valid array. Assert exact `configState`, empty registry for every non-valid-entry case, no throw/500, and that populated legacy flat vars never authenticate or alter the result.
  - Covers AE6. Missing `games`, empty `envs`, invalid env, short key, and raw key with outer whitespace mixed with a uniquely keyed valid entry → only the unique valid key authenticates; no response/log contains raw config or keys.
  - Covers AE7. Scope denial increments exactly one reason counter and `totalAbuse` once; `unauthorized`, `malformed`, `replayed`, `rateLimited`, `clockSkew`, replay keys, and rate buckets are unchanged.
  - Covers AE8. Table-test duplicate canonical keys at 2, 3, and 4 occurrences; permutations where the first/middle/last entry has malformed claims; `K` plus ` K `; and a unique control credential. The duplicated canonical key always authenticates nothing and the control still works.
  - Covers AE9. With a one-event rate limit, use a different in-scope credential to seed a replay key for game B, then use the game-A-only credential for a game-B batch containing two duplicate copies of that replayed ID with skewed timestamps. The batch would fail duplicate, rate cost, skew, and replay checks if reached; assert 403 `forbidden_scope` wins, only its reason counter changes, downstream snapshots remain byte-equal, and the store is untouched.
  - Covers AE10. Parse an overlap registry with `Ko` and `Kn` carrying identical narrow claims and prove both authorize; parse the post-revocation registry and prove only `Kn` authorizes; parse the saved rollback registry and prove `Ko` returns with the same narrow claims. No wildcard or all-env shortcut exists.
- **Verification:** the analytics-worker Vitest suite passes including the new files.

---

## Verification Contract

| Gate | Command | Done Signal |
|---|---|---|
| Analytics worker tests | `npm run test:unit --workspace=@fabrikav2/services` (or the repo's services test script; fall back to `npx vitest run packages/services/src/analytics-worker`) | New `auth.test.ts` + extended `ingest.test.ts` pass, including config-state, 2/3/4 duplicate, public-response-equality, composite-precedence, reason-counter, overlap/revocation/rollback, and existing analytics-worker cases. |
| SDK + services typecheck | `npm run typecheck` | Workspace TypeScript compiles after the config/counter/env-binding changes and the `auth.ts` addition. |
| Root unit + audit | `npm run test:unit` and `npm run audit` (repo root scripts) | Card's required root gates pass. |
| Lint | `npx eslint packages/services/src/analytics-worker packages/sdk/src/analytics` | No new lint errors in touched files. |
| No-adaptation audit | `rg -n "game_id|env" packages/services/src/analytics-worker/auth.ts` | `authorizeEnvelope` reads the imported canonical batch type; no locally re-declared `{ game_id, env }` interface. |
| Runtime-fallback audit | `rg -n "ANALYTICS_PUBLIC_CLIENT_KEYS|anyGame|legacy" packages/services/src/analytics-worker/auth.ts packages/services/src/analytics-worker/ingest.ts` | No legacy variable or wildcard participates in authentication; any remaining mention is documentation/test assertion only. |
| Secret/oracle audit | inspect `forbidden_scope` construction and compare serialized responses in tests | Game-only, env-only, and both-mismatch responses are byte-identical and static; no key, claim list, or internal reason is returned. |
| Plan authority audit | inspect both `2026-07-10-001-fix-analytics-ingest-credential-*.md` files | This scoping plan declares itself canonical; the binding plan is a superseded pointer with no competing executable contract. |

This is a headless services/auth-logic change (request/response and config parsing), not a rendered game UI change, so device verification does not apply.

---

## Definition of Done

- `packages/services/src/analytics-worker/auth.ts` exists and owns the credential claim type, `parseIngestCredentials`, the moved `authenticate`, and `authorizeEnvelope`, which reads the canonical SDK-owned envelope with no adaptation.
- Cross-game and cross-environment submissions receive the same deterministic 403 `forbidden_scope` response before duplicate/rate/skew/replay/storage work, with only one internal reason counter changing.
- Valid scoped submissions still succeed and remain compatible with the SDK owned-mirror-sink envelope; no wire schema change.
- Missing, empty, malformed/non-array, malformed-entry, and duplicate credential config fails closed, never 500s, and never widens a grant; duplicate canonical keys remain poisoned across 3+ occurrences and malformed permutations.
- `forbiddenScopeGame`/`forbiddenScopeEnv` record one internal reason per denial, their sum participates once in `totalAbuse`, and both appear in the state snapshot without changing the external response.
- The scoped secret is the only runtime credential authority. The retired flat public-key value is a migration documentation input only; unset/empty scoped config never activates fallback, wildcard, or all-env access.
- Tests cover multi-game, `production`/`development`/`test`, all config states, no-fallback behavior, permanent duplicate poisoning, public response equality, composite denial precedence, reason metrics, and overlap/revocation/rollback registries.
- The operational runbook covers per-environment preflight, narrow migration, 30-day-or-longer overlap, 99%-of-14-day-active adoption, supported-version compatibility, monitored removal, narrow rollback, public-key containment, and human release ownership.
- The sibling binding plan is explicitly superseded and points here; this file is the only implementation contract for `csYLD5PK`.
- All Verification Contract gates have been run or honestly reported with blockers. Commit only — no deploy, no credential rotation.
