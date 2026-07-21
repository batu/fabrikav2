---
title: "feat: FTD ACH-1 durable achievement domain, rewards, migration + analytics"
date: 2026-07-21
type: feat
origin: Trello card Yno5aUqL (FTD ACH-1) — card description is the product contract
trello: https://trello.com/c/Yno5aUqL
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
depth: deep
---

# feat: FTD ACH-1 — Durable Achievement Domain, Rewards, Migration + Analytics

## Summary

Build the **non-visual** achievement authority for Find the Dog: a narrow domain
module that turns trustworthy existing progression facts into a small curated
catalog, persists progress through a recoverable single-key journal, unlocks and
grants modest existing-economy rewards without ever double-granting, returns
deterministic immutable deltas for a later UI card, and emits the canonical
analytics contract. This card renders **no** achievement
UI. It owns the contract file `games/find_the_dog/src/achievements/AchievementSystem.ts`;
GameState produces typed facts and the later UI card consumes the returned deltas
with zero adaptation.

The core design constraint is **never double-grant under relaunch/retry**. The
card's known traps are explicit: separate localStorage keys tear; fallback serving
mutates served level IDs while logical identity must stay stable; wrapped content
index is not a unique progression identity; analytics/overlay events are not durable
mutation boundaries.

**Honest platform limits.** `localStorage.setItem` is atomic **per key** — one
`setItem` fully replaces the key's value or throws, never a partial value — but a
sequence of `setItem` calls (which is exactly what `save()` is, GameState.ts:897-926)
is **not** atomic across keys: a crash or quota throw mid-`save()` commits the keys
written so far and drops the rest. So we cannot rely on "the achievement record and
the coin balance land together." (The existing base-coin path already exposes this:
COINS is written at GameState.ts:911, *before* the completion transaction at 919, so
a torn write there re-grants base coins on reload — see SURPRISES.) The plan therefore
uses a **recoverable write-ahead settlement journal**: before touching the wallet we
durably record a *pending settlement* that names the occurrence and the absolute
before/after wallet snapshots; we then write the wallet; then we durably finalize
(clear the pending settlement). Because the pending settlement carries the exact
target state, load can always tell whether the wallet write happened and finish the
job either way. The guarantee we make is therefore stronger than the prior draft's:
**exactly-once and recoverable across a crash at any of the three write boundaries**
(the grant is neither lost nor doubled when the wallet is in either the recorded
before- or after-state), degrading to **at-most-once only on genuine corruption**
where the wallet matches neither snapshot — a case we detect and handle by an explicit
mismatch policy rather than a blind reapply.

---

## Problem Frame

Find the Dog already owns durable progression and economy in `GameState`, with a
completion transaction that makes stats registration, base-coin grant, bonus-coin
grant, and reward-progress one-shot and survivable across relaunch (GameState.ts:639-734).
There is no achievement layer. We need one that:

- reuses that trustworthy progression rather than inventing parallel counters,
- never double-grants rewards or double-emits unlock analytics across duplicate
  callbacks, retries, or interrupted/reloaded completion transactions,
- backfills only achievements *derivable* from current durable state, never guessing
  unobservable history (historical dog counts, hintless/clean runs, replays),
- and exposes a typed delta + analytics contract the later UI card imports unchanged.

**Non-goals (product identity fence):** no accounts, cloud, leaderboard, social,
battle pass, daily mission, or new currency. No dependency additions. No achievement
rendering (HomeScene, HUD, LevelCompleteOverlay styling untouched).

---

## Grounded Facts (verified in repo at spawn HEAD dbe90c68)

- `GameState.save()` writes each persisted key with its own `localStorage.setItem`
  inside one `try` block (GameState.ts:897-926). The shared `try` only stops the loop
  on the first throw — it does **not** make the writes atomic across keys; a partial
  set can commit. `load()` is tolerant of missing/malformed keys via `safeParse*`
  helpers (GameState.ts:928-1007). This is the seam to extend with a reconcilable
  single-key journal, not an assumed-atomic batch.
- Completion transaction carries stable identity + provenance: `id`
  (`completion:<seq>:<index>:<levelId>`), `intendedLevelId`, `servedLevelId`,
  `sequenceVersion`, `catalogRevision`, `fallbackReason`, `previousBestSeconds`,
  `newBest`, and one-shot flags (GameState.ts:101-120, 639-704).
- `registerLevelComplete` owns streak, best time, and `_totalLevelsCompleted`
  (GameState.ts:785-810); `currentStreakDays()` is the truthful read-side streak
  (GameState.ts:823-831).
- Dog-found is attempt memory + analytics only (`analytics.dogFound`,
  GameScene.ts:1320-1386); **no** historical dog-count persistence exists — do not
  invent one for backfill.
- Wallet mutation is centralized: `_coinBalance`, `_hintBalance`, `_walletCounters`,
  with typed `WalletMutationSource` (GameState.ts:80-97). Rewards must flow through
  these, not a side ledger.
- Analytics emits through `AnalyticsService` (`analytics.*` → `sdk.track(name, params)`,
  AnalyticsService.ts:199-407); canonical event definitions live in
  `CanonicalAnalyticsEvents.ts` (typed `CanonicalAnalyticsEventDefinition[]`).
  Analytics is a **sink**, never a mutation authority.

---

## Key Technical Decisions

**KTD1 — Domain authority is a pure module invoked synchronously by GameState.**
`AchievementSystem` takes typed facts and a mutable-but-owned progress record, and
returns an immutable `AchievementDelta`. It performs **no** I/O and **no** wallet
mutation itself: it decides *what* changed and *what reward is owed*; GameState
applies wallet effects and persists. This keeps autonomy/authority in GameState's
existing transactional seam and makes the system fully unit-testable with plain data.
Rationale: the card's "narrow domain authority invoked synchronously" + the board
lesson that analytics/overlay events are not mutation boundaries.

**KTD2 — Recoverable write-ahead settlement with before/after snapshots.**
The achievement record is a single versioned `ftd_achievements` key (one `setItem`,
so its *internal* fields — processed occurrence IDs, unlock set, and the single
`pendingSettlement` — are mutually consistent by construction, since a per-key write
is atomic). The record is the **durable authority**; the wallet is settled toward it
through a three-checkpoint write-ahead protocol that carries the exact target wallet
state, so recovery is unambiguous regardless of which write tore.

`pendingSettlement` (present only mid-settlement, `null` otherwise) holds
`{ occurrenceId, before: WalletSnapshot, after: WalletSnapshot }` where a
`WalletSnapshot` is the **absolute** `{ coins, hints, walletCounters }` — not a delta.

Protocol (per accepted occurrence that grants a reward), fully synchronous — **no
player mutation may interleave the three checkpoints**:
1. **Write-ahead (checkpoint 1).** `apply()` returns the delta. In memory, mark the
   occurrence `processed`, add unlocks, and set
   `pendingSettlement = { occurrenceId, before = current wallet snapshot,
   after = before + reward }`. Durably persist the **record key**. The intent to move
   the wallet from `before` to `after` is now recoverable.
2. **Write wallet (checkpoint 2).** Set `_coinBalance`/`_hintBalance`/`_walletCounters`
   to `after` (absolute assignment, under the `'achievement'` `WalletMutationSource`).
   Durably persist the **wallet keys** (COINS/HINTS/counters).
3. **Finalize (checkpoint 3).** Clear `pendingSettlement` to `null` in memory. Durably
   persist the **record key** again. Settlement is complete.

**Recovery on load.** If `pendingSettlement` is absent, nothing to do. If present, read
the current wallet snapshot `w`:
- `w == before` → checkpoint 2 never landed → assign wallet = `after`, then clear
  `pendingSettlement` and persist. Grant **applied exactly once**.
- `w == after` → checkpoint 2 landed but finalize (checkpoint 3) did not → just clear
  `pendingSettlement` and persist. **No reapply.**
- `w` matches **neither** → genuine corruption (nothing else may interleave the
  synchronous protocol, so this cannot happen on a clean tear). **Mismatch policy:**
  do **not** blindly reapply — trust the wallet as-is, clear `pendingSettlement`, keep
  the occurrence marked processed, and emit a reconciliation-anomaly analytics event.
  This deliberately biases the corrupted edge to **at-most-once** (never a double
  grant). Defined and fault-tested in U3.

Because each checkpoint is a single-key atomic `setItem`, a crash *at* or *between* any
checkpoint leaves the wallet in exactly `before` or `after`, both of which recovery
resolves to a single grant. The prior draft's cumulative settlement marker (which lost
a reward when COINS tore) is removed entirely.

Rejected: a standalone `AchievementStore` with its own keys (reintroduces uncontrolled
torn writes); any claim that folding into a single `save()` makes the record and coins
commit atomically together (false — see Problem Frame); and any relative/delta-based
settlement (not idempotent under replay — absolute snapshots are).

**KTD3 — Occurrence identity is the durable dedupe key.** Completion facts dedupe on
the **completion transaction `id`** (already unique per accepted completion, stable
across retry/reload). Dog-found facts dedupe on a per-occurrence id derived from the
accepted find (level transaction/attempt id + dog id), not the wrapped content index.
Processed IDs live in the record; re-applying a processed fact is a no-op returning an
empty delta. Rationale: card traps — wrapped index is not identity; served IDs can
change under fallback.

**KTD4 — Catalog is data, grounded only in provable behaviors.** Small first release:
progression/completion-count milestones, lifetime dog finds **from this release
forward** (new counter, honestly zero-based), personal-best/mastery facts the game
truly observes (`newBest`, per-level best times), and streak milestones
(`currentStreakDays`). Stable string IDs, explicit `order` for deterministic display.
Rewards are modest coins/hints whose **summed** total is bounded well under existing
level/reward economy flows (verified against `baseCoinReward` scale in the plan's
reward-budget check). No historical dog/hintless/clean-run/replay achievements.

**KTD5 — Migration backfills only from durable derivable state.** On first load of a
save lacking an achievement record (or a lower `version`), evaluate progression/
completion-total milestones from `currentLevelIndex` + `_totalLevelsCompleted`,
personal-best/mastery from `_bestTimes`, and streak milestones from
`currentStreakDays()`. Sanitize malformed legacy counters (clamp negatives/NaN to 0).
Lifetime-dog and any non-derivable facts start unearned. Backfill is itself an
idempotent occurrence (`migration:v<N>`) so repeated evaluation never re-grants.

**KTD6 — Analytics is a typed contract the UI card reuses.** Define achievement
event definitions (`achievement_progress`, `achievement_unlocked`,
`achievement_reward_granted`, plus catalog `achievement_page_viewed` /
`achievement_viewed` for the later UI) in `CanonicalAnalyticsEvents.ts` and an
`AchievementAnalyticsPayload` type owned by the achievements module. GameState emits
unlock/progress/reward events from the delta **after** the mutation commits. The UI
card imports the same payload types with zero adaptation (board lesson:
contract-ownership).

**Emission recovery (persistence succeeds, sink interrupted).** Analytics is a sink,
not part of the durable transaction, so emission can fail or be interrupted after the
record has already committed the unlock/reward. The record therefore carries an
`analyticsEmitted: string[]` of occurrence ids whose events have been successfully
handed to the sink. Flow: after a commit, emit the delta's events; on success append
the occurrence id to `analyticsEmitted` and persist (best-effort). On `load()`, any
occurrence present in the ledger/unlocked set but absent from `analyticsEmitted` is
**re-emitted once** and then marked. Every achievement analytics event carries the
occurrence id, so downstream dedupe makes this at-least-once emission safe. This keeps
mutation and emission decoupled: a torn/failed emit never blocks or corrupts the
grant, and a granted-but-unemitted occurrence is always eventually reported.

---

## High-Level Technical Design

Fact flow (one accepted completion), showing the exactly-once boundary:

```mermaid
sequenceDiagram
    participant GS as GameScene
    participant State as GameState
    participant Ach as AchievementSystem (pure)
    participant LS as localStorage
    participant An as AnalyticsService

    GS->>State: beginLevelCompletionTransaction(input)
    Note over State: existing one-shot: stats, base coins
    State->>Ach: apply(CompletionFact{txId, newBest, streak, ...}, record)
    Ach-->>State: AchievementDelta{ progressChanges, newlyUnlocked[], rewards[] }
    Note over State: dedupe: txId already processed? -> empty delta
    State->>State: WRITE-AHEAD: record.processed += txId; record.unlocked += ids;<br/>record.pendingSettlement = {txId, before, after=before+reward}
    State->>LS: persist RECORD key (checkpoint 1)
    State->>State: WALLET: assign coins/hints/counters = after
    State->>LS: persist WALLET keys (checkpoint 2)
    State->>State: FINALIZE: record.pendingSettlement = null
    State->>LS: persist RECORD key (checkpoint 3)
    State->>An: emit from delta; on success record.analyticsEmitted += txId; persist record
    State-->>GS: CompletionResult (+ achievementDelta for later UI)
```

On relaunch at any checkpoint, `load()` inspects `pendingSettlement` (KTD2): if the
wallet equals `before`, the `after` snapshot is applied exactly once (grant
**recovered**); if it equals `after`, the pending marker is cleared with no reapply;
if it matches neither, the mismatch policy trusts the wallet and marks the anomaly
(at-most-once). Re-applying the same `txId` is independently a no-op via
`processedOccurrenceIds` (KTD3). Any unlock not in `analyticsEmitted` is re-emitted
once (KTD6). No path can double-grant, and no clean tear loses a grant.

---

## Output Structure

```
games/find_the_dog/src/achievements/
  AchievementSystem.ts        # contract owner: types, apply(), migration, ordering (U1, U2, U3, U5)
  catalog.ts                  # data-only catalog definitions + reward table (U2)
  AchievementAnalytics.ts     # typed analytics payloads + delta->event mapping (U6)
games/find_the_dog/tests/unit/
  achievement-progress.test.ts        # U1/U2 progress + threshold + ordering
  achievement-persistence.test.ts     # U3 relaunch, dedupe, reconcile, fault-injected torn writes
  achievement-migration.test.ts       # U5 backfill, malformed/legacy, fallback identity
  achievement-analytics.test.ts       # U6 contract round-trip + once-per-occurrence
```

The split between `AchievementSystem.ts` (contract owner) and `catalog.ts`/
`AchievementAnalytics.ts` keeps the single owned contract file focused on types +
authority while data and analytics-mapping live beside it. All are inside the
declared `achievements/**` fence.

---

## Implementation Units

### U1. Typed facts, delta, and record contract

**Goal:** Define the owned type surface in `AchievementSystem.ts`: input facts
(`DogFoundFact`, `LevelCompletionFact`), the immutable `AchievementDelta`, the
versioned `AchievementRecord`, and per-achievement progress semantics. No behavior yet.

**Requirements:** AC1, AC2, AC5. **Dependencies:** none.
**Files:** `games/find_the_dog/src/achievements/AchievementSystem.ts`.

**Approach:**
- `LevelCompletionFact` carries the completion transaction identity/provenance
  (`transactionId`, `intendedLevelId`, `servedLevelId`, `sequenceVersion`,
  `fallbackReason`), timing (`timeSeconds`, `previousBestSeconds`, `newBest`),
  resulting `streakDays`, and logical progression semantics (`progressionIndex`,
  `totalCompletions`). Mirror the shapes already in `CompletionTransaction`
  (GameState.ts:101-120) so GameState builds facts with zero adaptation.
- `DogFoundFact` carries a stable `occurrenceId` and `levelId`; **no** historical count.
- `AchievementDelta` is `readonly`: `{ occurrenceId, progressChanges: readonly
  AchievementProgressChange[], newlyUnlocked: readonly Achievement[] (catalog order),
  rewards: readonly GrantedReward[] }`.
- `AchievementRecord` (versioned, the durable journal — one storage key): `{ version,
  progress: Record<id, number>, unlocked: readonly id[], processedOccurrenceIds:
  readonly string[], pendingSettlement: { occurrenceId, before: WalletSnapshot, after:
  WalletSnapshot } | null (the single in-flight write-ahead settlement), analyticsEmitted:
  readonly string[] (occurrence ids whose analytics reached the sink) }`, where
  `WalletSnapshot = { coins: number, hints: number, walletCounters: Record<string,
  number> }` holds **absolute** wallet values. Invariant: at most one `pendingSettlement`
  exists at a time (the settlement protocol is synchronous and non-interleaving); a
  non-null `pendingSettlement` on `load()` is resolved by KTD2 recovery before any new
  fact is applied.
- AC5: encode `milestoneKind` distinguishing occurrence-count vs logical-progression
  vs intended/canonical vs served/fallback so completion semantics are explicit in types.

**Patterns to follow:** `readonly` immutable-input style in
`AnalyticsEventContract.ts`; `WalletCounters`/`CompletionTransaction` interface style.
**Test scenarios:** none — pure type declarations (no behavior). `Test expectation:
none -- type-only unit; behavior covered by U2/U3.`

---

### U2. Catalog data + progress/threshold/ordering engine

**Goal:** Define the small curated catalog (`catalog.ts`) and implement the pure
`apply(fact, record)` progress calculation, threshold crossing, and deterministic
ordering in `AchievementSystem.ts`.

**Requirements:** AC1, AC2, AC6. **Dependencies:** U1.
**Files:** `games/find_the_dog/src/achievements/catalog.ts`,
`games/find_the_dog/src/achievements/AchievementSystem.ts`,
`games/find_the_dog/tests/unit/achievement-progress.test.ts`.

**Approach:**
- Catalog entries: stable `id`, `name`, `description`, `category`
  (`progression | completion | dogs | mastery | streak`), `threshold`,
  `progressSource` (which fact field advances it), `order`, optional
  `reward: { coins?, hints? }`.
- First-release set (grounded only in provable behavior): completion-count milestones
  (e.g. 1/10/25/50 completions from `_totalLevelsCompleted`), progression milestones
  (reach level N from `currentLevelIndex`), lifetime dog finds from-this-release
  (new record counter, starts 0), personal-best/mastery (first `newBest`; N distinct
  levels with a best time), streak milestones (3/7 day from `currentStreakDays`).
- `apply()` computes new progress per relevant achievement, returns crossings in
  catalog `order`, and attaches rewards for newly-unlocked entries. Pure, deterministic,
  no I/O.
- **Reward-budget check (AC6):** sum of all catalog coin rewards must stay modest vs
  existing flows — document the total in a code comment and assert an upper bound in
  the test so future catalog edits can't silently inflate the economy.

**Test scenarios:**
- Covers AC1. Catalog has unique stable IDs and a total order; `orderedAchievements()`
  is deterministic regardless of unlock order.
- Covers AC2. Applying a completion fact below threshold advances progress, unlocks
  nothing, grants nothing.
- Covers AC2. Applying the fact that crosses a threshold returns the achievement in
  `newlyUnlocked` with its reward in `rewards`.
- Threshold exactly-met vs off-by-one boundary for each category.
- Multiple thresholds crossed by one fact are returned in catalog order.
- Covers AC6. Sum of catalog coin rewards ≤ asserted modest bound; hints similarly bounded.
- Streak milestone uses `streakDays` from the fact, not raw stored streak.

---

### U3. Persist journal in GameState.save() + exactly-once wiring

**Goal:** Fold the `AchievementRecord` journal into GameState: new `ftd_achievements`
key written/read in `save()`/`load()`, dedupe on occurrence id, settle rewards through
the wallet via idempotent reconciliation, and expose the delta to callers. Wire
`GameScene` completion + dog-found seams to produce facts.

**Requirements:** AC2, AC3, AC6. **Dependencies:** U1, U2.
**Files:** `games/find_the_dog/src/core/GameState.ts`,
`games/find_the_dog/src/scenes/GameScene.ts`,
`games/find_the_dog/tests/unit/achievement-persistence.test.ts`.

**Approach (implements KTD2's write-ahead settlement protocol):**
- Add `_achievementRecord` field, parsed in `load()` with a tolerant
  `parseAchievementRecord` helper mirroring `parseWalletCounters`/
  `parseCompletionTransaction`. The record participates in the normal `save()` for the
  no-pending steady state, but the settlement protocol drives its **own three
  durable persist checkpoints** (see below) because finalize must be durable *after*
  the wallet write — a single `save()` pass cannot express that ordering.
- Two targeted persist helpers so each checkpoint is a minimal atomic write:
  `persistAchievementRecord()` (single `setItem` of `ftd_achievements`) and
  `persistWallet()` (the COINS/HINTS/counters keys). Add a code comment stating the
  three-checkpoint invariant so a future refactor can't collapse the ordering.
- New GameState method `applyAchievementFact(fact)`:
  1. Guard on `processedOccurrenceIds` — already processed → return empty delta, no-op.
  2. Call `AchievementSystem.apply(fact, record)`. If the delta grants nothing, mark
     processed + add unlocks and persist the record once (no wallet touch). If it
     grants a reward, run the write-ahead protocol:
     - **Checkpoint 1:** mark processed, add unlocks, set `pendingSettlement =
       { occurrenceId, before = walletSnapshot(), after = before + reward }`;
       `persistAchievementRecord()`.
     - **Checkpoint 2:** assign `_coinBalance`/`_hintBalance`/`_walletCounters` to
       `after` (absolute) under the new `'achievement'` `WalletMutationSource`;
       `persistWallet()`.
     - **Checkpoint 3:** `pendingSettlement = null`; `persistAchievementRecord()`.
  3. Return the delta. The whole method is synchronous with no `await`/callback between
     checkpoints, guaranteeing no player mutation interleaves.
- New `recoverPendingSettlement()` runs in `load()` after all keys parse: implements the
  KTD2 `before`/`after`/mismatch resolution and is the only place load mutates the
  wallet. It is idempotent — a second `load()` sees `pendingSettlement == null` and does
  nothing.
- Invoke `applyAchievementFact` from `beginLevelCompletionTransaction` (after
  stats/base-coins commit, GameState.ts:696) using the transaction `id` as occurrence
  id; invoke from the accepted dog-found path in `GameScene` (GameScene.ts:1320-1386)
  with a stable occurrence id. Emit analytics (U6) from the returned delta.

**Execution note (fault-injection first):** Start with a failing test harness that wraps
`localStorage.setItem` to throw on the Nth call or on a named key, drives a completion
that crosses a reward threshold, reloads a fresh GameState from the (partially written)
storage, and asserts the coin balance equals **exactly** the single-grant value on
every clean-tear boundary (recovered, not lost, not doubled). Inject a throw at each of
the three checkpoints and assert the load-time recovery lands the wallet at `after`
exactly once.

**Test scenarios:**
- Covers AC3. Duplicate completion callback with same `transactionId` grants reward
  once; second call returns empty delta.
- Covers AC3. Reload GameState from persisted storage, re-apply same fact → no double
  grant, unlocked set unchanged.
- Covers AC3. Interrupted completion (transaction persisted, app "relaunched"
  mid-flow) then retried → single grant, single unlock.
- Covers AC3. Duplicate dog-found callback with same occurrence id → progress advances
  once.
- **Fault injection — crash after checkpoint 1 (wallet write never ran).**
  `persistAchievementRecord()` (pending written) succeeds, then `persistWallet()`
  throws. Reload → wallet `== before` → recovery assigns `after` **exactly once**
  (grant recovered); a second load is a no-op.
- **Fault injection — crash after checkpoint 2 (finalize never ran).** Wallet write
  landed but the finalize `persistAchievementRecord()` throws. Reload → wallet
  `== after` → recovery clears `pendingSettlement` with **no reapply** (never doubled).
- **Fault injection — crash before checkpoint 1.** Neither pending nor wallet persist;
  reload re-applies the fact cleanly, exactly once (occurrence not yet marked).
- **Mismatch policy.** Corrupt the wallet so it equals neither `before` nor `after`
  while `pendingSettlement` is present → recovery trusts the wallet as-is, clears the
  pending marker, keeps the occurrence processed, and emits the reconciliation-anomaly
  event; no double grant, no crash.
- Covers AC6. After settlement, reward coins/hints land in wallet and `_walletCounters`
  with the `'achievement'` source; the wallet equals the `after` snapshot and
  `pendingSettlement` is `null`.
- Reward settled only for newly-unlocked entries, never on re-progress; at most one
  `pendingSettlement` exists at any time.
- `save()`/checkpoint failure path (localStorage throws) does not corrupt the in-memory
  record; after any single torn write the record still parses and recovery resolves it.

---

### U5. Migration / retroactive backfill

**Goal:** On first load without a record (or lower version), backfill only
derivable achievements; sanitize malformed legacy counters; leave existing saves
otherwise unchanged.

**Requirements:** AC4, AC5. **Dependencies:** U2, U3.
**Files:** `games/find_the_dog/src/achievements/AchievementSystem.ts`,
`games/find_the_dog/src/core/GameState.ts`,
`games/find_the_dog/tests/unit/achievement-migration.test.ts`.

**Approach:**
- `AchievementSystem.migrate(derivableState, existingRecord?)` builds/upgrades the
  record from `currentLevelIndex`, `_totalLevelsCompleted`, `_bestTimes`,
  `currentStreakDays()`. Runs as a single idempotent occurrence `migration:v<N>`
  recorded in `processedOccurrenceIds`.
- Clamp negative/NaN/absurd legacy counters to safe values before evaluating.
- Lifetime-dog, hintless, clean-run, replay stay unearned (no derivable source).
- Called from `load()` after all other keys parse, only when the record is absent or
  `version` is older.

**Test scenarios:**
- Covers AC4. Existing save with no achievement key loads unchanged; backfill produces
  the completion/progression/streak achievements its counters justify.
- Covers AC4. Malformed legacy counter (negative `_totalLevelsCompleted`, NaN best
  time) is sanitized; no crash, no spurious unlock.
- Covers AC3/AC4. Running migration twice (reload) yields identical record — no
  re-grant of rewards, no duplicate unlock/analytics.
- Covers AC5. Fallback-served completion in history: logical/progression milestones
  count; served-vs-intended identity does not corrupt dedupe.
- Non-derivable achievements (lifetime dogs) remain unearned after backfill.
- Version bump path: older record upgraded without losing existing unlocks.

---

### U6. Analytics contract (progress / unlock / reward / page view)

**Goal:** Define the canonical achievement analytics events and the owned payload
types; emit once-per-occurrence from the delta. UI card reuses payloads with zero
adaptation.

**Requirements:** AC7, AC2. **Dependencies:** U1, U3.
**Files:** `games/find_the_dog/src/achievements/AchievementAnalytics.ts`,
`games/find_the_dog/src/analytics/CanonicalAnalyticsEvents.ts`,
`games/find_the_dog/src/analytics/AnalyticsService.ts`,
`games/find_the_dog/tests/unit/achievement-analytics.test.ts`.

**Approach:**
- Add `achievement_progress`, `achievement_unlocked`, `achievement_reward_granted`,
  `achievement_reconciliation_anomaly` (the KTD2 mismatch-policy signal), and the
  later-UI `achievement_page_viewed` / `achievement_viewed` to `canonicalAnalyticsEvents`
  with family/panel/question/dimensions following existing entry shape. Every payload
  carries the occurrence id for downstream dedupe (analytics is **at-least-once**, never
  promised sink-level exactly-once — dedupe is the consumer's job on the occurrence id).
- `AchievementAnalytics.ts` owns `AchievementAnalyticsPayload` types and a pure
  `deltaToEvents(delta)` mapper. Add thin `analytics.achievement*` methods to
  `AnalyticsService` mirroring `dogFound`/`resourceChanged` (AnalyticsService.ts:297-345).
- Emit from GameState **after** the mutating `save()` commits, driven by the delta.
  On successful emit, add the occurrence id to `record.analyticsEmitted` and persist
  (best-effort). On `load()`, re-emit once for any granted occurrence missing from
  `analyticsEmitted` (KTD6 emission recovery — persistence succeeded but the sink was
  interrupted). Page-view events are defined but emitted by the later UI card — this
  card only owns the contract.

**Test scenarios:**
- Covers AC7. `deltaToEvents` maps a multi-unlock delta to one event per unlock +
  one reward event per granted reward, in catalog order.
- Covers AC2/AC7. Zero-adaptation round-trip: payload built by the mapper is consumed
  by a consumer stub with no field renaming (contract-ownership proof).
- Covers AC3. Re-applied (already-processed) occurrence produces an empty delta →
  zero analytics events.
- **Emission recovery.** Unlock committed to the record but `analyticsEmitted` missing
  the occurrence (sink interrupted before marking) → `load()` re-emits exactly once,
  then marks it; a second `load()` emits nothing. Uses the occurrence id so downstream
  dedupe is safe.
- Canonical event definitions typecheck against `CanonicalAnalyticsEventDefinition`.
- Analytics never mutates progress/ledger/settlement — it only reads the delta and
  appends to `analyticsEmitted`.

---

## Requirements Traceability

| AC | Covered by |
|----|------------|
| AC1 typed catalog, stable IDs, order | U1, U2 |
| AC2 fact → immutable delta | U1, U2, U3, U6 |
| AC3 duplicate/retry/interrupt/migration idempotency | U3, U5 |
| AC4 existing saves load; sanitize; provable-only backfill | U5 |
| AC5 completion semantics distinctions | U1, U5 |
| AC6 modest coins/hints; no deps | U2, U3 |
| AC7 analytics contract, sink not authority | U6 |
| AC8 deterministic test coverage | U2, U3, U5, U6 |
| AC9 typecheck/test:unit/audit pass | Verification Contract |

---

## Scope Boundaries

**In scope:** `achievements/**`, the completion/dog-found seams in `GameState.ts` and
`GameScene.ts`, achievement analytics in `analytics/**`, and unit tests.

**Out of scope (product identity):** accounts, cloud, leaderboard, social, battle
pass, daily missions, new currency, dependency additions, and **all** achievement
rendering.

### Deferred to Follow-Up Work (the dependent UX card)
- Rendering the catalog, progress bars, unlock toasts, and an achievements page.
- Emitting `achievement_page_viewed` / `achievement_viewed` at real view sites.
- Any HomeScene/HUD/LevelCompleteOverlay entry point to achievements.

**SURPRISES for the UX card:** the delta and analytics payload types are owned here;
import them unchanged. If the UX card needs a fact/field this card did not model
(e.g. a per-achievement "just unlocked this session" flag for toasts), request it as
a contract addition here rather than re-declaring the shape downstream.

**SURPRISE (pre-existing, out of this card's scope):** the existing base-coin grant
writes `COINS` (GameState.ts:911) *before* the completion transaction that carries its
`baseCoinsGranted` flag (line 919), so a torn `save()` there can **re-grant base coins**
on reload — an unsafe ordering this card's achievement seam deliberately avoids via the
write-ahead settlement protocol. This card does not rewrite the base-coin/transaction
ordering (outside the achievement seam, risk to other wallet flows), but flags it: a
future card could apply the same write-ahead before/after-snapshot discipline to the
completion transaction to close it.

---

## Risks & Mitigations

- **Torn write between the achievement record and the coin balance.** Not mitigated by
  "one `save()` batch" (that batch is not atomic — see Problem Frame). Mitigated by
  KTD2's write-ahead settlement: a durable `pendingSettlement` records the absolute
  before/after wallet snapshots before the wallet is touched, so load recovery lands
  the wallet at `after` exactly once whether the crash left it at `before` or `after` —
  neither losing nor doubling a grant. A wallet matching neither snapshot is genuine
  corruption, handled by the explicit at-most-once mismatch policy. Proven by the U3
  fault-injection tests at every checkpoint.
- **Fallback serving changes served level IDs.** Dedupe on transaction `id`, not
  served/wrapped identity (KTD3, U5 fallback test).
- **Economy distortion from reward inflation.** Reward-budget assertion in U2 caps the
  catalog total.
- **Silent double-emit of unlock analytics.** Emit strictly from the delta after the
  processed-id guard (U6 empty-delta test).
- **Guessing history during backfill.** Only derivable facts backfilled; migration is
  an idempotent occurrence (U5).

---

## Verification Contract

Gate commands (all must pass):
- `npm run typecheck -w @fabrikav2/find_the_dog`
- `npm run test:unit -w @fabrikav2/find_the_dog`
- `npm run audit`
- `git diff --check`

Per-unit: each feature-bearing unit's enumerated test scenarios pass. Achievement
tests are deterministic (no timers/network) — dates injected where streak logic is
exercised, mirroring existing `registerLevelComplete` test style.

---

## Definition of Done

1. `achievements/AchievementSystem.ts` owns catalog types, facts, delta, record,
   `apply`, and `migrate`; the later UI card can import the delta + analytics payloads
   with zero adaptation.
2. Progress, threshold crossing, ordering, persistence/relaunch, retroactive
   evaluation, malformed/legacy data, duplicate occurrences, reward idempotency,
   fault-injected torn writes at every settlement checkpoint (grant recovered, never
   lost on a clean tear, never double-granted; corruption mismatch handled), interrupted
   completion/retry, fallback serving, analytics emission recovery, and write-ahead
   settlement recovery all have passing deterministic tests (AC8).
3. Rewards are coins/hints only, modest and asserted-bounded; no dependency added (AC6).
4. Analytics contract emits progress/unlock/reward once-per-occurrence and never
   mutates state (AC7).
5. All four gate commands pass; the diff stays within the scope fence and preserves
   the unrelated dirty evidence changes on main.
```
