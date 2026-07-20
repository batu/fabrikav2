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
catalog, persists progress atomically, unlocks and grants modest existing-economy
rewards exactly once, returns deterministic immutable deltas for a later UI card,
and emits the canonical analytics contract. This card renders **no** achievement
UI. It owns the contract file `games/find_the_dog/src/achievements/AchievementSystem.ts`;
GameState produces typed facts and the later UI card consumes the returned deltas
with zero adaptation.

The core design constraint is **exactly-once under relaunch/retry**. The card's
known traps are explicit: separate localStorage keys tear; fallback serving mutates
served level IDs while logical identity must stay stable; wrapped content index is
not a unique progression identity; analytics/overlay events are not durable mutation
boundaries. The plan folds the achievement journal into GameState's existing
single-batch `save()` seam (GameState.ts:897-926) so it shares the wallet's torn-write
guarantees rather than layering a new torn key.

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

- `GameState.save()` writes **all** persisted keys inside one `try` block
  (GameState.ts:897-926); `load()` is tolerant of missing/malformed keys via
  `safeParse*` helpers (GameState.ts:928-1007). This is the atomic seam to extend.
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

**KTD2 — Persist the journal inside GameState.save(), as one new key.** Add a single
`ftd_achievements` key (a versioned `AchievementRecord`) written in the same
`save()` batch as coins/transaction. It commits progress, unlock set, processed
occurrence IDs, and a reward-effects log together with the wallet mutation they
justify. This is the "harden the existing seam rather than add a torn key" directive:
because one `save()` writes all keys under one try, an achievement unlock and the
coins it granted cannot tear apart. Rejected: a standalone `AchievementStore` with
its own `localStorage.setItem` — that reintroduces exactly the torn-write class the
card names as a trap.

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
unlock/progress/reward events from the delta **after** the mutation commits, exactly
once per occurrence. The UI card imports the same payload types with zero adaptation
(board lesson: contract-ownership).

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
    State->>State: apply reward coins/hints to wallet
    State->>State: record.processed += txId; record.unlocked += ids
    State->>LS: save() — ONE batch: wallet + record + transaction
    State->>An: emit progress/unlock/reward from delta (once)
    State-->>GS: CompletionResult (+ achievementDelta for later UI)
```

On relaunch mid-completion: `load()` restores both the active completion
transaction and the achievement record from the same storage generation; re-applying
the same `txId` is a no-op (KTD3), so no reward or unlock double-fires.

---

## Output Structure

```
games/find_the_dog/src/achievements/
  AchievementSystem.ts        # contract owner: types, apply(), migration, ordering (U1, U2, U3, U5)
  catalog.ts                  # data-only catalog definitions + reward table (U2)
  AchievementAnalytics.ts     # typed analytics payloads + delta->event mapping (U6)
games/find_the_dog/tests/unit/
  achievement-progress.test.ts        # U1/U2 progress + threshold + ordering
  achievement-persistence.test.ts     # U3 relaunch, dedupe, reward idempotency, interrupted retry
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
- `AchievementRecord` (versioned): `{ version, progress: Record<id, number>, unlocked:
  readonly id[], processedOccurrenceIds: readonly string[], rewardLog: readonly
  {occurrenceId, coins, hints}[] }`.
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

**Goal:** Fold the `AchievementRecord` into GameState: new `ftd_achievements` key
written/read in the existing `save()`/`load()` batch, dedupe on occurrence id, apply
rewards through the wallet, and expose the delta to callers. Wire `GameScene`
completion + dog-found seams to produce facts.

**Requirements:** AC2, AC3, AC6. **Dependencies:** U1, U2.
**Files:** `games/find_the_dog/src/core/GameState.ts`,
`games/find_the_dog/src/scenes/GameScene.ts`,
`games/find_the_dog/tests/unit/achievement-persistence.test.ts`.

**Approach:**
- Add `_achievementRecord` field; serialize in `save()` (GameState.ts:897-926) as one
  key inside the existing try; parse in `load()` with a `parseAchievementRecord`
  tolerant helper mirroring `parseWalletCounters`/`parseCompletionTransaction`.
- New GameState method `applyAchievementFact(fact)`: guard on
  `processedOccurrenceIds` (no-op → empty delta), call `AchievementSystem.apply`,
  add reward coins/hints via the existing wallet fields + `_walletCounters` with a
  `WalletMutationSource` (add `'achievement'` to the union), append to
  `processedOccurrenceIds`/`unlocked`/`rewardLog`, then `save()`. Return the delta.
- Invoke from `beginLevelCompletionTransaction` (after stats/base-coins commit,
  GameState.ts:696) using the transaction `id` as occurrence id; invoke from the
  accepted dog-found path in `GameScene` (GameScene.ts:1320-1386) with a stable
  occurrence id. Emit analytics (U6) from the returned delta.
- **Ordering guarantee:** achievement mutation + its reward + processed-id append all
  land in the same `save()` as the completion transaction, so relaunch cannot see a
  granted reward without its processed id.

**Execution note:** Start with a failing persistence test that drives a completion,
reloads a fresh GameState from the same storage, and re-applies the same transaction
id — asserting no second reward. Harden until green.

**Test scenarios:**
- Covers AC3. Duplicate completion callback with same `transactionId` grants reward
  once; second call returns empty delta.
- Covers AC3. Reload GameState from persisted storage, re-apply same fact → no double
  grant, unlocked set unchanged.
- Covers AC3. Interrupted completion (transaction persisted, app "relaunched"
  mid-flow) then retried → single grant, single unlock.
- Covers AC3. Duplicate dog-found callback with same occurrence id → progress advances
  once.
- Covers AC6. Reward coins/hints land in wallet and `_walletCounters` with the
  `'achievement'` source; wallet reconciliation holds (granted == logged).
- Reward applied only for newly-unlocked entries, never on re-progress.
- `save()` failure path (localStorage throws) does not corrupt in-memory record.

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
  `achievement_page_viewed`, `achievement_viewed` to `canonicalAnalyticsEvents` with
  family/panel/question/dimensions following existing entry shape.
- `AchievementAnalytics.ts` owns `AchievementAnalyticsPayload` types and a pure
  `deltaToEvents(delta)` mapper. Add thin `analytics.achievement*` methods to
  `AnalyticsService` mirroring `dogFound`/`resourceChanged` (AnalyticsService.ts:297-345).
- Emit from GameState **after** the mutating `save()` commits, driven by the delta so
  each unlock/reward emits exactly once. Page-view events are defined but emitted by
  the later UI card — this card only owns the contract.

**Test scenarios:**
- Covers AC7. `deltaToEvents` maps a multi-unlock delta to one event per unlock +
  one reward event per granted reward, in catalog order.
- Covers AC2/AC7. Zero-adaptation round-trip: payload built by the mapper is consumed
  by a consumer stub with no field renaming (contract-ownership proof).
- Covers AC3. Re-applied (already-processed) occurrence produces an empty delta →
  zero analytics events.
- Canonical event definitions typecheck against `CanonicalAnalyticsEventDefinition`.
- Analytics never mutates the record (emit is read-only over the delta).

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

---

## Risks & Mitigations

- **Torn write between reward and unlock.** Mitigated by KTD2 (one `save()` batch).
  Proven by the U3 reload test.
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
   interrupted completion/retry, fallback serving, and wallet reconciliation all have
   passing deterministic tests (AC8).
3. Rewards are coins/hints only, modest and asserted-bounded; no dependency added (AC6).
4. Analytics contract emits progress/unlock/reward once-per-occurrence and never
   mutates state (AC7).
5. All four gate commands pass; the diff stays within the scope fence and preserves
   the unrelated dirty evidence changes on main.
```
