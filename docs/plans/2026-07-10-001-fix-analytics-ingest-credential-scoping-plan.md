---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: trello-card:csYLD5PK
title: Bind Analytics Ingest Credentials to Game and Environment - Plan
type: fix
date: 2026-07-10
origin: trello-card:csYLD5PK
trello: https://trello.com/c/csYLD5PK
execution: code
---

# Bind Analytics Ingest Credentials to Game and Environment - Plan

## Goal Capsule

- **Objective:** Make each owned-analytics ingest credential carry explicit, least-privilege game and environment claims, and validate the batch envelope's `game_id`/`env` against those claims — before any rate/replay/storage work — so a key issued for one game/env can never submit for another.
- **Authority:** Ratified Trello card `csYLD5PK` (AUDIT #10). The card names `packages/services/src/analytics-worker/auth.ts` as this card's owned contract file and forbids re-declaring the envelope shape: claims are validated against the canonical SDK wire envelope without adaptation.
- **Execution profile:** Headless services change in `packages/services/src/analytics-worker/**` plus its Vitest suite, a doc-only touch in `packages/sdk/src/analytics`, a new operational runbook under `docs/`, and the `wrangler.template.toml` config surface. Code + tests only — no deploy, no live credential rotation.
- **Scope fence:** Do not rotate or mint production credentials, do not deploy the worker, do not change the wire schema tag `fabrika-owned-analytics-v1`, do not re-declare the envelope shape in `auth.ts`, and do not touch query-path auth (`query.ts` operator token) beyond what credential parsing shares.
- **Stop conditions:** Stop and consult the conductor if the fix appears to require changing the SDK wire contract, adding a runtime dependency, introducing a game/env wildcard in the *scoped* (non-legacy) credential format, or weakening the fail-closed rule to make a test pass.

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
- R4. Envelope-scope authorization runs after batch parse (so `game_id`/`env` are known) and **before** in-batch dedupe, rate limiting, replay, and storage.

**Deterministic Denial (fail closed)**

- R5. A submission whose `game_id` is not in the presenting credential's `games` claim is denied deterministically with HTTP 403 and error code `forbidden_game`.
- R6. A submission whose `env` is not in the presenting credential's `envs` claim is denied deterministically with HTTP 403 and error code `forbidden_env`. Game is checked before env so the outcome is stable.
- R7. Unknown or malformed credential configuration fails closed: a credential entry that is not well-formed is dropped (never silently widened), and top-level unparseable credential config yields zero credentials (deny all) rather than an exception or a 500. Duplicate keys in the scoped config are rejected (ambiguous grants are never resolved by silent precedence).
- R8. Denial responses never echo the presented key, the credential's claim lists, or any other secret material; messages are generic.

**Denial Logging / Observability**

- R9. Scope denials increment a dedicated counter distinct from `unauthorized` (bad/missing token), so denial logging is observable and testable. The counter participates in `totalAbuse` and the state snapshot.

**Configuration & Migration**

- R10. The scoped credential config is a secret env var (`ANALYTICS_INGEST_CREDENTIALS`) whose value is a JSON array of `{ key, games, envs }` objects. Keys keep the existing `length >= 16` guard; `games` entries must match the existing `game_id` pattern; `envs` entries must be valid `AnalyticsEnvironment` values.
- R11. When `ANALYTICS_INGEST_CREDENTIALS` is absent/empty, the worker falls back to the legacy flat config (`ANALYTICS_PUBLIC_CLIENT_KEYS` × `ANALYTICS_ALLOWED_GAME_IDS`, all envs) with byte-for-byte the current behavior, and marks those credentials `legacy` so the permissive grant is visible. Scoped config, when present, fully replaces legacy config (clean cutover).
- R12. `docs/` gains an operational issuance/rotation runbook (the JSON format, how to mint a scoped key, the add-new → deploy → migrate clients → remove-old rotation sequence, migration from legacy flat keys, and the public-browser-key containment note). The runbook states that actual issuance/rotation is a human release follow-up, not a worker action.

**Compatibility & Tests**

- R13. A correctly provisioned scoped submission (credential whose claims include the batch's `game_id` and `env`) still succeeds and stays compatible with the SDK owned-mirror-sink envelope — no SDK wire change; at most a doc/comment note in `packages/sdk/src/analytics/wire.ts` clarifying that `game_id`/`env` are auth-scoped server-side.
- R14. Tests cover: multi-game scoping (key for game A denied for game B), multi-environment scoping across `production`/`development`/`test`, legacy-migration fallback behavior, fail-closed handling of malformed/duplicate claims, and denial-counter logging — all without leaking secret material in responses.

### Acceptance Examples

- AE1. Given a scoped credential `{ key: K, games: ['marble_run'], envs: ['production'] }`, when a batch with `game_id: 'find_the_dog'`, `env: 'production'` is posted with `Bearer K`, the worker responds 403 `forbidden_game` and performs no storage write.
- AE2. Given the same credential K, when a batch with `game_id: 'marble_run'`, `env: 'development'` is posted with `Bearer K`, the worker responds 403 `forbidden_env` and performs no storage write.
- AE3. Given the same credential K, when a batch with `game_id: 'marble_run'`, `env: 'production'` is posted with `Bearer K`, the worker responds 202 and writes the batch (scoped happy path, SDK-envelope compatible).
- AE4. Given two scoped credentials — `{ key: Kp, games: ['marble_run'], envs: ['production'] }` and `{ key: Kd, games: ['marble_run'], envs: ['development','test'] }` — Kp is denied for `development` and Kd is denied for `production`, deterministically on every attempt.
- AE5. Given `ANALYTICS_INGEST_CREDENTIALS` unset and legacy `ANALYTICS_PUBLIC_CLIENT_KEYS=K`, `ANALYTICS_ALLOWED_GAME_IDS='marble_run,find_the_dog'`, a `Bearer K` batch for either allowed game and any env is accepted exactly as today, and the credential is marked `legacy`.
- AE6. Given `ANALYTICS_INGEST_CREDENTIALS` containing a malformed entry (missing `games`, empty `envs`, an invalid env value, or a too-short key) alongside a valid entry, the malformed entry is dropped and only the valid credential authenticates; a totally unparseable value authenticates nothing (all `Bearer` requests 403) and never 500s.
- AE7. Given a scope denial, the JSON response body contains neither the presented key nor the credential's `games`/`envs` lists, and a dedicated scope-denial counter increments while `unauthorized` does not.
- AE8. Given `ANALYTICS_INGEST_CREDENTIALS` with two entries sharing the same `key`, both are rejected (that key authenticates nothing) rather than one grant silently winning.

### Scope Boundaries

**In scope**

- New `packages/services/src/analytics-worker/auth.ts` (owned contract: claim type, parsing, `authenticate`, `authorizeEnvelope`).
- `packages/services/src/analytics-worker/ingest.ts` — remove local `authenticate`, import from `auth.ts`, thread the credential through the fetch flow, insert the scope check before dedupe/rate/replay/storage, add scope config to `readAnalyticsWorkerConfig` and `AnalyticsWorkerConfig`.
- `packages/services/src/analytics-worker/contracts.ts` — add the scope-denial counter to `AnalyticsWorkerAbuseCounters`; add the `ANALYTICS_INGEST_CREDENTIALS` field to `AnalyticsWorkerEnv`.
- `packages/services/src/analytics-worker/index.ts` — re-export the new `auth.ts` public surface alongside the existing exports.
- New `packages/services/src/analytics-worker/auth.test.ts` plus additions to `ingest.test.ts` for the fetch-level denial/logging paths.
- `packages/services/src/analytics-worker/wrangler.template.toml` — document `ANALYTICS_INGEST_CREDENTIALS` as a secret and mark the legacy flat vars as the migration source.
- `docs/` — new operational issuance/rotation/migration runbook.
- `packages/sdk/src/analytics/wire.ts` — doc/comment-only clarification (no shape change).

**Out of scope**

- No wire schema tag change; no new SDK payload fields; no `owned-mirror-sink.ts` behavior change.
- No rotation or minting of real/production credentials; no `wrangler deploy`; no account ids or secret values committed.
- No change to query-path operator auth semantics in `query.ts` beyond reusing shared credential-parsing helpers if genuinely shared.
- No wildcard game/env in the scoped credential format.
- No change to rate-limit, replay, clock-skew, or storage logic other than the *ordering* insertion of the scope check ahead of them.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **`auth.ts` owns the credential seam end-to-end.** Moving `authenticate` there and adding `parseIngestCredentials` + `authorizeEnvelope` gives one file that owns credential → claims → envelope authorization, matching the card's contract-ownership mandate and keeping `ingest.ts` a thin orchestrator.
- KTD2. **`authorizeEnvelope` takes the canonical `OwnedAnalyticsWorkerBatch` (= SDK `OwnedAnalyticsWireBatch`) directly.** It reads `batch.game_id`/`batch.env` with no intermediate DTO, satisfying "validate against the canonical envelope without adaptation" and the zero-adaptation round-trip lesson.
- KTD3. **Scope check is a new step between parse and dedupe.** `authenticate` still runs first (it needs only the bearer token), but scope authorization needs the parsed envelope, so it is inserted right after `parseOwnedAnalyticsBatch` succeeds and before `firstDuplicate`/rate/replay/store — exactly "before rate/replay/storage work."
- KTD4. **`parseOwnedAnalyticsBatch` and `allowedGameIds` stay as the coarse deployment allow-list.** Parse keeps validating shape + deployment enablement (`unknown_game_id` 400); credential scope is a *separate, per-key* layer (`forbidden_game`/`forbidden_env` 403). Two concerns, two checks — this avoids reworking the parser and its existing tests, and keeps a served-but-not-entitled game returning 403 (the core vuln case) rather than a misleading 400.
- KTD5. **Scoped config is JSON in a secret env var; legacy flat config is the fallback.** JSON expresses explicit per-key claims cleanly and is set via `wrangler secret put`. Scoped config, when present, fully replaces legacy so operators get a clean, testable cutover; legacy fallback preserves today's behavior (marked `legacy`) during migration.
- KTD6. **Fail closed at every malformed boundary.** A bad entry is dropped and counted, not widened; an unparseable blob yields zero credentials; duplicate keys are rejected. No denial response echoes secrets.
- KTD7. **Dedicated scope-denial counter.** Adding a `forbidden` field to `AnalyticsWorkerAbuseCounters` makes denial logging a first-class, asserted signal distinct from token failures; the ripple (snapshot, `totalAbuse`, 429-body counters) is small and additive.
- KTD8. **"Legacy any-game" is the only place a broad grant exists.** When legacy `ANALYTICS_ALLOWED_GAME_IDS` is empty (today = accept any game), the derived legacy credential carries an `anyGame` marker; scoped credentials never set it. This preserves back-compat precisely while denying by default on the new path.

### High-Level Technical Design

```mermaid
flowchart TB
  E[env: ANALYTICS_INGEST_CREDENTIALS JSON] --> P[auth.parseIngestCredentials]
  L[legacy: PUBLIC_CLIENT_KEYS x ALLOWED_GAME_IDS] -->|fallback when scoped empty| P
  P --> CS[IngestCredentialSet: key -> {games,envs,legacy,anyGame}]
  R[POST /ingest + Bearer key] --> A[auth.authenticate]
  CS --> A
  A -->|credential| B[parseOwnedAnalyticsBatch: shape + deployment allow-list]
  B -->|OwnedAnalyticsWorkerBatch| Z[auth.authorizeEnvelope credential x batch.game_id/env]
  Z -->|forbidden_game / forbidden_env 403 + counter++| X[deny, no storage]
  Z -->|ok| D[dedupe -> rate -> replay -> store]
```

### Assumptions

- A1. There is no upstream brainstorm artifact; the ratified Trello card `csYLD5PK` is the product contract (`needs-plan` classification).
- A2. The card's phrase "dev/staging/prod" is loose language for "multiple environments." The canonical `AnalyticsEnvironment` enum is `production | development | test` (see `packages/sdk/src/analytics/contract.ts:33`); there is no `staging` wire env, and the existing suite already treats `env: 'staging'` as `invalid_env`. The multi-environment tests use the real three. (Flagged as a card-vs-code wording gap.)
- A3. A secret env var holding a JSON string is an acceptable Cloudflare Worker pattern (set via `wrangler secret put`); the template already sets `ANALYTICS_PUBLIC_CLIENT_KEYS` as a comma-separated secret, so a JSON secret is a small extension of the same mechanism.
- A4. The SDK owned-mirror-sink is already configured per game/env when it builds batches, so a correctly provisioned scoped key matches its emitted envelope with zero client change — SDK edits are doc-only.
- A5. Adding a field to `AnalyticsWorkerAbuseCounters` is safe because response-body counter assertions in the suite use `toMatchObject` (partial) and `buildSourceHealthRow` consumes only `totalAbuse`.

### Risks and Dependencies

- **Ordering regression risk:** The scope check must sit before dedupe/rate/replay/store; placing it after would let a cross-game batch consume another game's rate budget or pollute replay state. A test must assert no storage write and no rate/replay mutation on a scope denial.
- **Silent-widening risk:** A malformed scoped entry must never fall back to "any game/any env." Tests must include malformed entries mixed with valid ones and assert the malformed ones grant nothing.
- **Legacy-precedence risk:** If both scoped and legacy vars are set, behavior must be deterministic (scoped fully replaces legacy). A test pins this so a half-migrated deployment can't accidentally union the two into a broader grant.
- **Counter-shape ripple:** Adding `forbidden` touches the abuse-counter object literal, `totalAbuse`, and the state snapshot; a missed site would under-count. Grep for `abuseCounters`/`totalAbuse` sites during implementation.
- **Secret-leak risk:** Error messages for `forbidden_game`/`forbidden_env` must be generic. A test asserts the response body contains neither the key nor the claim lists.
- **Contract-drift risk:** `authorizeEnvelope` must import the batch type from the SDK-owned contract (via `contracts.ts` re-export), not re-declare `{ game_id, env }`, or it reintroduces the exact drift the contract-ownership lesson forbids.

### Sources and Research

- `packages/services/src/analytics-worker/ingest.ts:31-32,205-219` — flat `publicClientKeys`/`allowedGameIds` config; `:236-256` parser deployment allow-list; `:304-314` `authenticate` returning only the raw key.
- `packages/services/src/analytics-worker/contracts.ts:77-99` — `AnalyticsWorkerEnv` binding shape (where `ANALYTICS_INGEST_CREDENTIALS` is added); `:142-155` — `AnalyticsWorkerAbuseCounters` and snapshot.
- `packages/sdk/src/analytics/wire.ts:41-48` — canonical `OwnedAnalyticsWireBatch`; comment already states `game_id` is "never trusted for auth," which this card operationalizes server-side.
- `packages/sdk/src/analytics/contract.ts:33` — `AnalyticsEnvironment = 'production' | 'development' | 'test'`.
- `packages/services/src/analytics-worker/contracts.ts:39` — worker schema aliases the SDK `OWNED_ANALYTICS_WIRE_SCHEMA`; the zero-adaptation round-trip is already established (`wire-roundtrip.test.ts`), and MEMORY `analytics-wire-contract-gap` records the producer-owns-the-contract resolution.
- `packages/services/src/analytics-worker/ingest.test.ts` — existing fetch-level test harness (`enabledEnv`, `batch`, `request`) the new denial/logging tests extend; `:99` and `query.test.ts:61` confirm `staging` is not a valid env.
- `packages/services/src/analytics-worker/wrangler.template.toml` — where the credential secret and legacy migration source are documented.
- Board lesson `contract-ownership`; MEMORY `trace-pipeline-seams-end-to-end` (write the seam map first; vocabularies are per-game data).

---

## Implementation Units

### U1. Create `auth.ts` — the owned credential contract

- **Goal:** One file owning the ingest-credential claim type, config parsing, bearer authentication, and envelope-scope authorization.
- **Requirements:** R1, R2, R3, R7, R8, R10, R11, KTD1, KTD2, KTD6, KTD8.
- **Dependencies:** None.
- **Files:** new `packages/services/src/analytics-worker/auth.ts`.
- **Approach:**
  - Define `IngestCredential = { readonly key: string; readonly games: ReadonlySet<string>; readonly anyGame: boolean; readonly envs: ReadonlySet<AnalyticsEnvironment>; readonly legacy: boolean }`.
  - `parseIngestCredentials(env: AnalyticsWorkerEnv): { credentials: Map<string, IngestCredential>; malformed: number }`. If `ANALYTICS_INGEST_CREDENTIALS` is non-empty, `JSON.parse` inside try/catch (catch → empty map, deny all); validate each entry (key string `length >= 16`, `games` non-empty array each matching the `game_id` pattern, `envs` non-empty array each a valid `AnalyticsEnvironment`); drop + count malformed entries; reject duplicate keys (remove the key, count malformed). Else fall back to legacy: for each key in `ANALYTICS_PUBLIC_CLIENT_KEYS` (existing `>=16` filter), build a `legacy: true` credential with `games` = `ANALYTICS_ALLOWED_GAME_IDS` set (or `anyGame: true` when that list is empty) and all three envs.
  - `authenticate(request, credentials): { ok: true; credential } | { ok: false; status: 401|403; error }` — moved from `ingest.ts`; bearer parsing unchanged, membership check now against the credential map.
  - `authorizeEnvelope(credential, batch: OwnedAnalyticsWorkerBatch): { ok: true } | { ok: false; error: WorkerError }` — reads `batch.game_id`/`batch.env` directly; game check first (`anyGame ||`), then env; generic messages, no secret echo.
  - Share the `game_id` pattern and env validator with `ingest.ts` (export from one place; reuse `isAnalyticsEnvironment`/`GAME_ID_PATTERN`) rather than re-declaring.
- **Patterns to follow:** the existing `authenticate` return-union style and the `envList`/`envFlag` helpers in `ingest.ts`; the SDK-import discipline in `contracts.ts`.
- **Test scenarios:** covered in U4 (`auth.test.ts`).
- **Verification:** `auth.ts` imports the batch type from `contracts.ts` (SDK-owned); no local `{ game_id, env }` re-declaration; typecheck clean.

### U2. Wire the scope check into the ingest flow

- **Goal:** Thread the authenticated credential through `fetch`, validate the envelope against its claims before dedupe/rate/replay/storage, and add the scoped config to worker config.
- **Requirements:** R4, R5, R6, R9, KTD3, KTD4, KTD7.
- **Dependencies:** U1.
- **Files:** `packages/services/src/analytics-worker/ingest.ts`, `packages/services/src/analytics-worker/contracts.ts`, `packages/services/src/analytics-worker/index.ts`.
- **Approach:**
  - Remove the local `authenticate` from `ingest.ts`; import `authenticate`, `authorizeEnvelope`, `parseIngestCredentials`, and `IngestCredential` from `auth.ts`.
  - Replace `publicClientKeys`/`allowedGameIds` usage for auth: `readAnalyticsWorkerConfig` builds `credentials` via `parseIngestCredentials(env)` and keeps `allowedGameIds` for the parser's coarse deployment check. Update `AnalyticsWorkerConfig` accordingly.
  - In `fetch`: `authenticate(request, config.credentials)` → on failure keep the current `unauthorized++` + `jsonError`. After `parseOwnedAnalyticsBatch` succeeds, call `authorizeEnvelope(auth.credential, parsed.batch)`; on failure increment the new `forbidden` counter and return the 403 error.
  - Add `forbidden: 0` to the `abuseCounters` initializer; add `forbidden` to `AnalyticsWorkerAbuseCounters` in `contracts.ts` and include it in `totalAbuse`.
  - Add `ANALYTICS_INGEST_CREDENTIALS?: string` to `AnalyticsWorkerEnv`.
  - Re-export the `auth.ts` public surface from `index.ts`.
- **Patterns to follow:** existing counter-increment + `jsonError` idiom in `fetch`; existing `readAnalyticsWorkerConfig` structure.
- **Test scenarios:** fetch-level denial/logging cases in U4 (`ingest.test.ts` additions).
- **Verification:** the scope check provably runs before dedupe/rate/replay/store (test asserts no storage write and unchanged rate/replay state on denial); `totalAbuse` includes `forbidden`.

### U3. Config template + operational runbook + SDK doc note

- **Goal:** Document the scoped credential format, the migration from legacy flat keys, and the issuance/rotation runbook; clarify the SDK envelope's server-side auth scoping.
- **Requirements:** R12, R13.
- **Dependencies:** U1 (format is finalized there).
- **Files:** `packages/services/src/analytics-worker/wrangler.template.toml`, new `docs/architecture/analytics-ingest-credentials.md` (or `docs/reports/` — implementer picks the closest existing convention; `docs/architecture` preferred), `packages/sdk/src/analytics/wire.ts` (comment only).
- **Approach:**
  - Template: add a commented `# wrangler secret put ANALYTICS_INGEST_CREDENTIALS` line with the JSON shape example, mark `ANALYTICS_PUBLIC_CLIENT_KEYS` + `ANALYTICS_ALLOWED_GAME_IDS` as the legacy migration source, and note scoped config replaces legacy.
  - Runbook: JSON format; how to mint a scoped key per game/env; the add-new → deploy → migrate clients → remove-old rotation sequence; migration from legacy flat keys; the public-browser-key containment note (scope tightly, rely on rate limits + rotation, never treat as a secret); and an explicit statement that real issuance/rotation is a human release follow-up, not a worker action.
  - `wire.ts`: one-line comment clarifying `game_id`/`env` are authorization-scoped server-side against the presenting credential.
- **Patterns to follow:** existing template comment style; existing `docs/architecture` doc format.
- **Test scenarios:** none (docs); referenced by the Definition of Done.
- **Verification:** runbook exists and names format, rotation, migration, containment, and the release-follow-up caveat; no secret values committed.

### U4. Tests — scoping, environments, legacy migration, fail-closed, denial logging

- **Goal:** Prove deterministic cross-game/cross-env denial, scoped happy path, legacy fallback, fail-closed handling, and secret-safe denial logging.
- **Requirements:** R14, all acceptance examples AE1–AE8.
- **Dependencies:** U1, U2.
- **Files:** new `packages/services/src/analytics-worker/auth.test.ts`; additions to `packages/services/src/analytics-worker/ingest.test.ts`.
- **Approach:** unit-test `parseIngestCredentials`/`authorizeEnvelope` directly in `auth.test.ts`; extend `ingest.test.ts` with fetch-level cases using the existing `enabledEnv`/`batch`/`request` harness (add an `ANALYTICS_INGEST_CREDENTIALS` override helper).
- **Test scenarios:**
  - Covers AE1. Scoped key for `marble_run/production`, batch `find_the_dog/production` → 403 `forbidden_game`, `writeDataPoint` not called.
  - Covers AE2. Same key, batch `marble_run/development` → 403 `forbidden_env`, no write.
  - Covers AE3. Same key, batch `marble_run/production` → 202 with the existing accepted-body shape.
  - Covers AE4. `Kp` (prod) and `Kd` (dev+test): Kp denied for development, Kd denied for production, repeated attempts identical.
  - Covers AE5. Legacy env (no `ANALYTICS_INGEST_CREDENTIALS`) reproduces today's accept-any-allowed-game behavior; credential marked `legacy` (asserted at the `parseIngestCredentials` unit level).
  - Covers AE6. Malformed entry (missing `games` / empty `envs` / invalid env value / short key) mixed with a valid one → only the valid key authenticates; fully unparseable value → all `Bearer` requests 403 and no 500.
  - Covers AE7. Scope-denial response body excludes the key and the `games`/`envs` lists; the `forbidden` counter increments while `unauthorized` does not.
  - Covers AE8. Duplicate-key scoped config → that key authenticates nothing.
  - Ordering: a scope denial leaves rate-limit and replay state unmutated (a subsequent authorized request for the same game is not rate-limited/replayed by the denied attempt).
- **Verification:** the analytics-worker Vitest suite passes including the new files.

---

## Verification Contract

| Gate | Command | Done Signal |
|---|---|---|
| Analytics worker tests | `npm run test:unit --workspace=@fabrikav2/services` (or the repo's services test script; fall back to `npx vitest run packages/services/src/analytics-worker`) | New `auth.test.ts` + extended `ingest.test.ts` pass; existing analytics-worker suite stays green. |
| SDK + services typecheck | `npm run typecheck` | Workspace TypeScript compiles after the config/counter/env-binding changes and the `auth.ts` addition. |
| Root unit + audit | `npm run test:unit` and `npm run audit` (repo root scripts) | Card's required root gates pass. |
| Lint | `npx eslint packages/services/src/analytics-worker packages/sdk/src/analytics` | No new lint errors in touched files. |
| No-adaptation audit | `rg -n "game_id|env" packages/services/src/analytics-worker/auth.ts` | `authorizeEnvelope` reads the imported canonical batch type; no locally re-declared `{ game_id, env }` interface. |
| Secret-leak audit | inspect `forbidden_game`/`forbidden_env` message construction | Messages are static strings; no interpolation of the key or claim lists. |

This is a headless services/auth-logic change (request/response and config parsing), not a rendered game UI change, so device verification does not apply.

---

## Definition of Done

- `packages/services/src/analytics-worker/auth.ts` exists and owns the credential claim type, `parseIngestCredentials`, the moved `authenticate`, and `authorizeEnvelope`, which reads the canonical SDK-owned envelope with no adaptation.
- Cross-game and cross-environment submissions are denied deterministically (403 `forbidden_game` / `forbidden_env`) before any dedupe/rate/replay/storage work, with no storage write and no rate/replay state mutation on denial.
- Valid scoped submissions still succeed and remain compatible with the SDK owned-mirror-sink envelope; no wire schema change.
- Unknown/malformed/duplicate credential config fails closed (dropped or deny-all), never 500s, and never widens a grant; denial responses leak no key or claim material.
- A dedicated scope-denial counter records denials, participates in `totalAbuse` and the state snapshot, and is asserted in tests.
- Legacy flat config (`ANALYTICS_PUBLIC_CLIENT_KEYS` × `ANALYTICS_ALLOWED_GAME_IDS`) still works during migration, marked `legacy`, and is fully replaced when scoped config is present.
- Tests cover multi-game, `production`/`development`/`test`, legacy migration, malformed/duplicate fail-closed, and denial logging.
- The operational issuance/rotation/migration runbook exists under `docs/`, names the public-browser-key containment posture, and states that real issuance/rotation is a human release follow-up.
- All Verification Contract gates have been run or honestly reported with blockers. Commit only — no deploy, no credential rotation.
