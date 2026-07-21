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
  with typed `WalletMutationSource` (GameState.ts:80-88). The union is **closed** and does
  **not** currently include `'achievement'` — every wallet method (`grantCoins`,
  `grantHints`, …) takes a `WalletMutationSource`, so an achievement grant will not
  type-check until `'achievement'` is added to the union (U3). Rewards must flow through
  these methods, not a side ledger.
- `applyHintGrant` (GameState.ts:485-493) caps free-hint grants at
  `GAMEPLAY.MAX_HINT_BALANCE` and **returns the actually applied amount** (may be < request
  or 0 at a full wallet). `grantHints` (496-501) returns that applied amount. Achievement
  hint rewards inherit this cap — the settlement target and reported grant must use the
  post-cap amount, not the requested amount.
- `currentLevelIndex` is a **selectable pointer**, not completion proof: `selectLevel`
  assigns it on mere navigation (GameScene.ts:1191), and HomeScene selection routes through
  the same path. Migration must derive progression from `_totalLevelsCompleted` /
  `_bestTimes` / `currentStreakDays()` only — never treat `currentLevelIndex` as evidence a
  level was completed.
- `onDogFound` has `dog.id` (stable per level) and `this.level.id` (the served level id),
  and dedupes finds within a level via `gameState.foundDogIds` (a Set of `dog.id`,
  GameScene.ts:1374). There is **no** persisted attempt/transaction id at the dog-found
  seam — a stable, non-farmable dog occurrence identity is `dog:<servedLevelId>:<dogId>`.
- Analytics emits through `AnalyticsService` (`analytics.*` → `sdk.track(name, params)`,
  AnalyticsService.ts:199-407); canonical event definitions live in
  `CanonicalAnalyticsEvents.ts` (typed `CanonicalAnalyticsEventDefinition[]`).
  Analytics is a **sink**, never a mutation authority. `sdk.track` returns `void` and the
  sink (`GameAnalyticsSink`) initializes lazily and **swallows** init/dispatch errors
  (GameAnalyticsSink.ts:72-76) — there is **no** provider-success ack, so durability claims
  are scoped to the local dispatch-call boundary only (KTD6).
- `beginLevelCompletionTransaction` returns `CompletionTransactionResult`
  (`{ transaction, previousBest, newBest, baseCoinsGrantedNow, completionStatsRegisteredNow }`,
  GameState.ts:134-140), consumed field-by-field at GameScene.ts:1645-1658 — this result must
  be preserved and only additively extended (KTD1). Its reuse guard requires
  `transaction.levelIndex === input.levelIndex` (GameState.ts:646-650), but the caller passes
  the **selectable** `currentLevelIndex` (GameScene.ts:1632), so index drift forks a new
  transaction id and breaks occurrence dedupe unless the guard is narrowed to `levelId` +
  unadvanced (KTD3).

---

## Key Technical Decisions

**KTD1 — Domain authority is a pure module invoked synchronously by GameState.**
`AchievementSystem` takes typed facts and a mutable-but-owned progress record, and
returns an immutable `AchievementDelta`. It performs **no** I/O and **no** wallet
mutation itself: it decides *what* changed and *what reward is entitled*; GameState
applies (post-cap) wallet effects and persists. This keeps autonomy/authority in GameState's
existing transactional seam and makes the system fully unit-testable with plain data.
Rationale: the card's "narrow domain authority invoked synchronously" + the board
lesson that analytics/overlay events are not mutation boundaries.

**Two reward shapes — entitlement vs applied — to close the pure/post-cap drift.**
Because `apply()` is pure and holds no wallet state, its reward output is necessarily the
catalog *entitlement* (requested amount). It is a red-team break to let the same field also
mean the post-cap applied amount (at a full hint wallet the producer would report `3` while
the wallet/UI/analytics must report `0`). So the two are distinct types:
- `apply()` returns `AchievementDelta` whose `newlyUnlocked` entries carry an
  `entitledReward?: { coins?: number; hints?: number }` (the catalog request) — pure, no cap.
- GameState computes the post-cap applied amounts and returns a **committed**
  `CommittedAchievementDelta` whose `rewards: readonly GrantedReward[]` each carry
  `{ achievementId, coins, hints }` — the **actually applied** amounts (hints post-cap,
  possibly 0), each explicitly associated to the unlock that earned it via `achievementId`.
  This is the only shape the caller, UI card, and analytics consume; `deltaToEvents` reads
  `achievementId` to associate each reward event with its unlock, and it is well-defined for
  multi-unlock deltas and for unlocks that carry no reward (no `GrantedReward` emitted).

**The committed delta is surfaced additively — the existing completion result is NOT
replaced (fixes red-team break #1).** The real consumer `GameScene.triggerLevelFinale`
(GameScene.ts:1629-1674) reads `beginLevelCompletionTransaction()`'s
`CompletionTransactionResult` via `completion.transaction`, `completion.previousBest`,
`completion.newBest`, and `completion.baseCoinsGrantedNow`. Changing that return type to
`CommittedAchievementDelta` would break every one of those accesses. So U3 **adds one
optional field** to the existing `CompletionTransactionResult`:
`achievementCommit?: CommittedAchievementDelta` (undefined when the completion produced no
achievement change). All existing fields keep their names, types, and meaning; the new
field composes alongside them. A U3 test asserts the real consumer shape still exposes
`transaction`/`previousBest`/`newBest`/`baseCoinsGrantedNow` **and** can read the new
`achievementCommit`. The dog-found seam (no completion result) returns its
`CommittedAchievementDelta` directly from `applyAchievementFact`, which is the same owned
type the UI card consumes with zero adaptation.

**KTD2 — Recoverable write-ahead settlement with before/after snapshots.**
The achievement record is a single versioned `ftd_achievements` key (one `setItem`,
so its *internal* fields — processed occurrence IDs, unlock set, and the single
`pendingSettlement` — are mutually consistent by construction, since a per-key write
is atomic). The record is the **durable authority**; the wallet is settled toward it
through a three-checkpoint write-ahead protocol that carries the exact target wallet
state, so recovery is unambiguous regardless of which write tore.

`pendingSettlement` (present only mid-settlement, `null` otherwise) holds
`{ occurrenceId, before: SettlementSnapshot, after: SettlementSnapshot }` where a
`SettlementSnapshot` is the **absolute** `{ coins: number, hints: number, counters:
WalletCounters }` — not a delta. It **reuses the existing `WalletCounters` interface**
(GameState.ts:90-97) exactly rather than inventing a `walletCounters: Record<string, number>`
field (the prior draft's invented shape did not compose with the source and is removed);
`before.counters` is `{ ...this._walletCounters }` and `after.counters` is that value with
**only** `coinsGranted` advanced by the applied coin amount and `hintsGranted` advanced by
the applied (post-cap) hint amount. **`levelCompleteCoinGrants` and `rewardedHintGrants` are
NOT touched (fixes red-team break #2)** — they are *occurrence counts* owned by the
level-complete and reward-hint sources (incremented by exactly `1` per grant at
GameState.ts:691, 771), not coin/hint totals; advancing them by a 3-coin achievement reward
would corrupt their meaning (recording `+3` grants). No speculative achievement-specific
counter is added: achievement rewards contribute to the lifetime `coinsGranted`/`hintsGranted`
totals by their applied amount and nothing else. `SettlementSnapshot` is a **narrow
settlement-only** type (only the three
wallet dimensions the settlement touches), deliberately *not* the game's rich
`WalletSnapshot` (GameState.ts:142-151, which also carries entitlements/purchase ids that
settlement never mutates).

**The wallet is three independent keys, so recovery is component-by-component.**
`save()` writes `HINTS`, `COINS`, and `WALLET_COUNTERS` as *separate* `setItem` calls
(GameState.ts:899, 911, 922). A tear can therefore land any subset of them — e.g. COINS
advances to `after.coins` while HINTS/counters stay at `before` — producing a wallet that
matches **neither** whole snapshot. The prior draft treated the wallet as one atomic
snapshot and would have mis-classified this common mixed tear as "genuine corruption".
Recovery instead resolves **each component independently**: for `coins`, `hints`, and
each numeric field of `counters` (`coinsGranted`/`hintsGranted` are the only ones a
settlement advances; `levelCompleteCoinGrants`/`rewardedHintGrants`/`coinsSpent`/`hintsSpent`
have `before == after` and resolve trivially), if the stored value equals that component's
`before` it is
assigned that component's `after`; if it already equals `after` it is left as-is; only a
component matching neither is a true anomaly. Because each `setItem` is atomic per key,
every individual component is always exactly its own `before` or `after` on a clean tear,
so component-wise resolution lands the whole wallet at `after` exactly once regardless of
which subset of the three keys committed.

**Hint caps are resolved into the target before it is recorded.** `applyHintGrant` caps
free-hint grants at `GAMEPLAY.MAX_HINT_BALANCE` and returns the **actually applied** amount
(GameState.ts:485-493) — a reward of +N hints to a near-full wallet may apply fewer than N,
or zero. The settlement target `after.hints` must therefore be the **post-cap** balance
(`min(before.hints + rewardHints, MAX_HINT_BALANCE)`), computed *before* checkpoint 1
persists the pending settlement, and the delta's `GrantedReward.hints` must report the
**actual applied** amount, not the requested amount. This keeps `after` a value the wallet
can truly reach (no overfill, no disagreement) and keeps analytics/UI honest about what was
granted. Coins have no cap.

Protocol (per accepted occurrence that grants a reward), fully synchronous — **no
player mutation may interleave the three checkpoints**:
1. **Write-ahead (checkpoint 1).** `apply()` returns the delta. Compute the post-cap
   reward (coins uncapped; hints capped to room) and build the committed delta + its full
   analytics event list (`deltaToEvents`). In memory, mark the occurrence `processed`, add
   unlocks, advance persisted mastery identity (masteredLevelIds, KTD4/U1), **append the
   complete analytics event list to `analyticsOutbox`**, and set `pendingSettlement =
   { occurrenceId, before = current settlement snapshot, after = before + post-cap reward }`.
   Durably persist the **record key** — this single write commits the occurrence-processed
   mark, the unlocks, the reconstructable analytics events, and the settlement intent
   **together**, so no later crash can leave a committed occurrence without its recoverable
   events (closing the prior draft's gap where the outbox was appended only after finalize).
2. **Write wallet (checkpoint 2).** Set `_coinBalance`/`_hintBalance`/`_walletCounters`
   to `after` (absolute assignment, under the new `'achievement'` `WalletMutationSource`).
   Durably persist the **wallet keys** — HINTS, COINS, and WALLET_COUNTERS, three separate
   `setItem` calls that can each land or tear independently.
3. **Finalize (checkpoint 3).** Clear `pendingSettlement` to `null` in memory. Durably
   persist the **record key** again. Settlement is complete.

**Recovery on load.** If `pendingSettlement` is absent, nothing to do. If present, resolve
each wallet component (`coins`, `hints`, every `counters` field) independently against
its own `before`/`after`:
- component `== before` → its checkpoint-2 write never landed → assign the component to
  `after`.
- component `== after` → its write landed → leave as-is.
- component matches **neither** → true anomaly for that component (only possible on genuine
  storage corruption, since per-key writes are atomic). **Mismatch policy:** do **not**
  reapply — trust the stored component as-is, and emit a reconciliation-anomaly analytics
  event naming the occurrence. This biases the corrupted edge to **at-most-once** (never a
  double grant).
After resolving all components, clear `pendingSettlement`, keep the occurrence marked
processed, and persist the record. Recovery is idempotent: a second `load()` sees
`pendingSettlement == null`.

Because each checkpoint is a set of single-key atomic `setItem`s, a crash *at* or *between*
any checkpoint leaves every wallet component in exactly its own `before` or `after`, all of
which component-wise recovery resolves to a single grant. The prior draft's whole-snapshot
comparison (which mis-read a mixed per-key tear as corruption) and its cumulative settlement
marker (which lost a reward when COINS tore) are both removed.

Rejected: a standalone `AchievementStore` with its own keys (reintroduces uncontrolled
torn writes); any claim that folding into a single `save()` makes the record and coins
commit atomically together (false — see Problem Frame); and any relative/delta-based
settlement (not idempotent under replay — absolute snapshots are).

**KTD3 — Occurrence identity is the durable dedupe key.** Completion facts dedupe on
the **completion transaction `id`** (already unique per accepted completion, stable
across retry/reload). Dog-found facts dedupe on the stable
occurrence id `dog:<servedLevelId>:<dogId>` — the identity actually available at
`onDogFound` (GameScene.ts:1371) — **not** an unpersisted/farmable attempt id and not the
wrapped content index. Because `dogId` is stable per level and `foundDogIds` already dedupes
a dog within a level, this identity counts each distinct dog once for lifetime totals and
cannot be farmed by replaying the same level. Processed IDs live in the record; re-applying
a processed fact is a no-op returning an empty delta. Rationale: card traps — wrapped index
is not identity; served IDs can change under fallback, but the (servedLevelId, dogId) pair
is the observable, persistable occurrence.

**Active-completion reuse must survive `levelIndex` drift (fixes red-team break #4).**
`beginLevelCompletionTransaction`'s current reuse guard (GameState.ts:646-650) requires
`transaction.levelIndex === input.levelIndex`. But the caller passes
`levelIndex: gameState.currentLevelIndex` (GameScene.ts:1632), and `currentLevelIndex` is a
selectable pointer that level-order reconciliation or navigation can move between an
interrupted completion and its retry. When it drifts, the guard fails, a **new** transaction
id is minted, and the achievement occurrence dedupe (keyed on transaction `id`) is defeated —
the same completion double-grants. U3 therefore **narrows the reuse guard to the stable
completion identity**: an unadvanced (`!advanced`) active transaction for the same `levelId`
is reused even when `input.levelIndex` differs from the stored `levelIndex` (the stored
transaction keeps its original id; the drifted index does not fork identity). `levelIndex` is
provenance, not identity — only `levelId` + unadvanced state gate reuse. A U3
serialize/reload/cursor-drift/retry test proves the retried completion reuses the same
transaction id and produces no duplicate achievement progress or reward.

**KTD4 — Catalog is data, grounded only in provable behaviors.** Small first release:
progression/completion-count milestones, lifetime dog finds **from this release
forward** (new counter, honestly zero-based), personal-best/mastery facts the game
truly observes (`newBest`, per-level best times), and streak milestones
(`currentStreakDays`). Stable string IDs, explicit `order` for deterministic display.
Rewards are modest coins/hints whose **summed** total is bounded well under existing
level/reward economy flows (verified against `baseCoinReward` scale in the plan's
reward-budget check). No historical dog/hintless/clean-run/replay achievements.

**KTD5 — Migration backfills only from durable derivable state.** On first load of a
save lacking an achievement record (or a lower `version`), evaluate progression and
completion-total milestones from `_totalLevelsCompleted` (the durable completion count),
mastery from `_bestTimes` (distinct levels with a best time), and streak milestones from
`currentStreakDays()`. **`currentLevelIndex` is deliberately excluded** — it is a
selectable navigation pointer (GameScene.ts:1191), not completion proof, so a "reached
level N" milestone is defined against completion count, never the level cursor. Sanitize
malformed legacy counters (clamp negatives/NaN to 0).
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
record has already committed the unlock/reward. Storing only occurrence ids is
insufficient: one occurrence maps to **multiple** distinct events (a progress event, one
`achievement_unlocked` per unlock, and a reward event), so after a crash `load()` cannot
reconstruct the exact payloads from an occurrence id alone. The record therefore carries a
durable **analytics outbox** — `analyticsOutbox: PendingAnalyticsEvent[]`, where each entry
is a fully-formed `{ eventId, name, payload }` with a **stable `eventId`** (derived
deterministically, e.g. `<occurrenceId>:<eventKind>:<achievementId>`) and the complete
payload the sink needs. **Ordering (durability-first, fixes the prior gap):** the full event
list is appended to `analyticsOutbox` and persisted **in the same checkpoint-1 record write
that first marks the occurrence processed/unlocked** — *before* the wallet write and *before*
finalize — so there is never an instant where a committed occurrence exists without its
reconstructable events. This holds for reward paths, progress-only/no-wallet paths, and
migration alike (each first commits its outbox with its occurrence mark).

**Honest dispatch boundary — there is no sink-success ack (fixes red-team break #5).**
The only observable boundary is the **synchronous return of the local dispatch call**:
`analytics.achievement*` → `AnalyticsService` → `sdk.track(...)`, which enqueues/hands off
locally and **returns `void`**; the underlying sink (`GameAnalyticsSink`) initializes lazily,
**swallows** initialization and dispatch errors (GameAnalyticsSink.ts:72-76), and never
reports provider delivery. So "emitted successfully to the provider" is **unobservable** and
this plan does not claim it. The durable guarantee is scoped to what we can observe: after
the settlement finalizes, GameState drains the outbox by handing each event to the local
dispatch call; an `eventId` is removed from the outbox **only after that local `track` handoff
returns without throwing** — proving the event reached the local dispatch boundary, **not**
that a provider received it. On `load()`, any event still in `analyticsOutbox` (handoff never
completed before a crash) is **re-dispatched from its stored payload** and removed once the
local handoff returns. Because each event carries a stable `eventId`, re-dispatch is
at-least-once **at the dispatch boundary** and downstream dedupes on `eventId`; we **do not**
promise sink-level or provider-level exactly-once (nor even guaranteed delivery). Tests assert
only observable dispatch-boundary behavior (which payloads were handed to a fake sink; that a
crash before handoff leaves the event in the outbox for re-dispatch) — never provider receipt.
This keeps mutation and emission decoupled: a torn/failed dispatch never blocks or corrupts
the grant, and every committed event stays durably reconstructable until its local handoff
returns.

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
    State->>Ach: apply(LevelCompletionFact{txId, levelId, progressionIndex, totalCompletions, streakDays, newBest, ...}, record)
    Ach-->>State: AchievementDelta{ progressChanges, newlyUnlocked[] (entitledReward) }
    Note over State: dedupe: txId already processed? -> empty delta
    State->>State: build CommittedDelta: post-cap GrantedReward[]{achievementId,coins,hints};<br/>deltaToEvents -> full event list
    State->>State: WRITE-AHEAD (all in one record write): processed += txId; unlocked += ids;<br/>masteredLevelIds += levelId (if newBest & absent);<br/>analyticsOutbox += full events;<br/>pendingSettlement = {txId, before, after=before+post-cap reward}
    State->>LS: persist RECORD key (checkpoint 1 — commits occurrence + events + intent together)
    State->>State: WALLET: assign coins/hints/counters = after
    State->>LS: persist HINTS, COINS, WALLET_COUNTERS (3 keys, checkpoint 2)
    State->>State: FINALIZE: record.pendingSettlement = null
    State->>LS: persist RECORD key (checkpoint 3)
    State->>An: dispatch each outbox event; remove eventId after local handoff returns (not provider ack)
    State-->>GS: CompletionTransactionResult + achievementCommit: CommittedAchievementDelta (existing fields intact)
```

On relaunch at any checkpoint, `load()` inspects `pendingSettlement` (KTD2) and resolves
each wallet component (`coins`, `hints`, each `counters` field) **independently**
against its own `before`/`after`: a component still at `before` is assigned `after`, a
component already at `after` is left, a component matching neither is a per-component anomaly
handled by the mismatch policy. Because the wallet is three separate keys, a mixed tear
(e.g. COINS advanced, HINTS not) is resolved correctly rather than mis-read as corruption.
Re-applying the same `txId` is independently a no-op via `processedOccurrenceIds` (KTD3).
Any event still in `analyticsOutbox` is re-dispatched from its stored payload and removed once
the local dispatch handoff returns (KTD6 — at the dispatch boundary, not provider receipt).
No path can double-grant, and no clean tear loses a grant.

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
  (`transactionId`, `levelId`, `intendedLevelId`, `servedLevelId`, `sequenceVersion`,
  `fallbackReason`), timing (`timeSeconds`, `previousBestSeconds`, `newBest`),
  resulting `streakDays`, and logical progression semantics (`progressionIndex`,
  `totalCompletions`). **Honest composition (fixes the red-team break):** the source
  `CompletionTransaction` (GameState.ts:101-120) exposes `id`, `levelId`, `levelIndex`,
  `newBest`, `previousBestSeconds`, provenance — but **not** `transactionId`,
  `progressionIndex`, `totalCompletions`, or `streakDays`, so the fact is **not** a
  drop-in copy of the transaction and any "zero adaptation" claim for *fact construction*
  was false and is removed. Instead U3 owns an explicit, tested **builder mapping** inside
  GameState's completion seam (which is the only site with the missing fields in scope):
  `transactionId ← transaction.id`, `levelId ← transaction.levelId`,
  `progressionIndex ← transaction.levelIndex`, `totalCompletions ← this._totalLevelsCompleted`
  (freshly incremented by `registerLevelComplete`, GameState.ts:806),
  `streakDays ← this.currentStreakDays()` (GameState.ts:823), timing/provenance copied from
  the transaction. `levelId` is retained on the fact so mastery ("N distinct levels with a
  best time") can identify the contributing level. The **zero-adaptation guarantee applies
  only to the UI card consuming the returned `CommittedAchievementDelta`**, not to GameState
  producing the fact — GameState is the producer and owns this documented builder + a U3 test
  asserting it type-checks against the real `CompletionTransaction`.
- `DogFoundFact` carries the stable `occurrenceId = dog:<servedLevelId>:<dogId>`, plus
  `levelId` and `dogId`; **no** historical count.
- Reward types are **split** (fixes the requested-vs-applied red-team break): the pure
  `apply()` output attaches an `entitledReward?: { coins?: number; hints?: number }` (catalog
  request) to each `newlyUnlocked` entry, while `GrantedReward = { achievementId: string;
  coins: number; hints: number }` reports the **actually applied** amounts (hints post-cap
  per KTD2, possibly 0) and lives **only** on the committed delta GameState returns. The
  `achievementId` makes each reward's association to its unlock explicit for multi-unlock
  deltas and lets unlocks without a reward carry no `GrantedReward`.
- `AchievementDelta` (pure, from `apply()`) is `readonly`: `{ occurrenceId, progressChanges:
  readonly AchievementProgressChange[], newlyUnlocked: readonly Achievement[] (catalog order,
  each with optional `entitledReward`) }`. `CommittedAchievementDelta` (returned by GameState,
  consumed by UI/analytics) extends it with `rewards: readonly GrantedReward[]` (applied
  amounts, `achievementId`-tagged). This is the single owned consumer shape.
- `AchievementRecord` (versioned, the durable journal — one storage key): `{ version,
  progress: Record<id, number>, masteredLevelIds: readonly string[] (persisted distinct-level
  identity set — see below), unlocked: readonly id[], processedOccurrenceIds:
  readonly string[], pendingSettlement: { occurrenceId, before: SettlementSnapshot, after:
  SettlementSnapshot } | null (the single in-flight write-ahead settlement), analyticsOutbox:
  readonly PendingAnalyticsEvent[] (fully-formed events awaiting sink confirmation, each
  `{ eventId, name, payload }` with a stable deterministic `eventId`, appended in checkpoint 1
  — KTD6) }`, where `SettlementSnapshot = { coins: number, hints: number, counters:
  WalletCounters }` (reuses the existing `WalletCounters` interface exactly, GameState.ts:90-97)
  holds **absolute** wallet values whose components are resolved **independently** on recovery
  (the wallet persists as three separate keys — KTD2).
- **`masteredLevelIds` persists mastery identity (fixes the reload-double-count break):**
  distinct-level mastery progress is the size of this persisted set, not a raw numeric counter.
  A `newBest` completion adds `fact.levelId` to the set only if absent, so a *repeat* best time
  for an already-mastered level does **not** re-increment mastery after a serialize/reload —
  the prior draft stored only `progress: number` and could not distinguish a repeat best from a
  new level after deserialize.
  Invariant: at most one `pendingSettlement` exists at a time (the settlement protocol is
  synchronous and non-interleaving); a non-null `pendingSettlement` on `load()` is resolved
  component-by-component by KTD2 recovery before any new fact is applied.
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
  (reach level N **defined by completion count**, never `currentLevelIndex`, which is a
  selectable navigation pointer — GameScene.ts:1191), lifetime dog finds from-this-release
  (new record counter, starts 0, keyed on `dog:<servedLevelId>:<dogId>` occurrences),
  personal-best/mastery (first `newBest`; N distinct `levelId`s with a best time — the
  distinct set is the persisted `record.masteredLevelIds`, updated from the fact's `levelId`
  only when `newBest` and not already present, so a repeat best for a mastered level never
  re-increments after reload — KTD4/U1), streak milestones (3/7 day from `currentStreakDays`).
- `apply()` computes new progress per relevant achievement, returns crossings in
  catalog `order`, and attaches each newly-unlocked entry's catalog `entitledReward`
  (requested amount only — the post-cap applied `GrantedReward` is GameState's job, KTD1).
  Pure, deterministic, no I/O; mastery progress is derived from the record's persisted
  `masteredLevelIds` set passed in, never a bare counter.
- **Reward-budget check (AC6):** sum of all catalog coin rewards must stay modest vs
  existing flows — document the total in a code comment and assert an upper bound in
  the test so future catalog edits can't silently inflate the economy.

**Test scenarios:**
- Covers AC1. Catalog has unique stable IDs and a total order; `orderedAchievements()`
  is deterministic regardless of unlock order.
- Covers AC2. Applying a completion fact below threshold advances progress, unlocks
  nothing, grants nothing.
- Covers AC2. Applying the fact that crosses a threshold returns the achievement in
  `newlyUnlocked` with its catalog reward in `entitledReward` (fixes red-team break #3 —
  the **pure** `apply()` delta has no `rewards[]`; that post-cap applied shape exists only
  on the `CommittedAchievementDelta` GameState builds, asserted in U3, never in U2).
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
- **Add `'achievement'` to the `WalletMutationSource` union** (GameState.ts:80-88) so the
  reward calls type-check — the union is closed and rejects an unknown source today. Prove
  the real consumer composes: the achievement settlement calls the *existing* wallet
  methods (`grantCoins(amount, 'achievement')` / `grantHints(amount, 'achievement')` or the
  absolute-assignment equivalent) with no adaptation, and a U3 test asserts a completed
  achievement reward moves `_coinBalance`/`_hintBalance` under that source with zero type
  errors.
- Two targeted persist helpers so each checkpoint is a minimal atomic write:
  `persistAchievementRecord()` (single `setItem` of `ftd_achievements`) and
  `persistWallet()` (the HINTS/COINS/WALLET_COUNTERS keys — three separate `setItem`s that
  can each land or tear independently). Add a code comment stating the three-checkpoint
  invariant so a future refactor can't collapse the ordering.
- New GameState method `applyAchievementFact(fact)`:
  1. Guard on `processedOccurrenceIds` — already processed → return empty delta, no-op.
  2. Call `AchievementSystem.apply(fact, record)`. If the delta grants no reward
     (progress-only / no-wallet path, including a `newBest` that only updates
     `masteredLevelIds`), mark processed, add unlocks, update `masteredLevelIds`,
     **append its `deltaToEvents` output to `analyticsOutbox`**, and persist the record once
     (no `pendingSettlement`, no wallet touch) — the events are still journaled durably. If it
     grants a reward, run the write-ahead protocol:
     - **Compute the post-cap reward first.** Coins are uncapped; hints are capped to
       `MAX_HINT_BALANCE - _hintBalance` room (mirroring `applyHintGrant`, GameState.ts:485-493).
       Set the delta's `GrantedReward.hints` to the **actually applied** amount (may be < the
       catalog reward or 0 at a full wallet) so the delta the caller/analytics sees is honest.
     - **Build the committed delta + events first.** Wrap the pure delta into a
       `CommittedAchievementDelta` whose `rewards` carry `{ achievementId, coins, hints }`
       with the post-cap applied amounts; run `deltaToEvents` to get the full event list.
     - **Checkpoint 1 (single record write commits everything recoverable):** mark
       processed, add unlocks, add `fact.levelId` to `masteredLevelIds` when the fact is a
       `newBest` and the level is absent, **append the full event list to `analyticsOutbox`**,
       and set `pendingSettlement = { occurrenceId, before = settlementSnapshot(), after =
       before + post-cap reward }`; `persistAchievementRecord()`. (`settlementSnapshot()` is a
       narrow helper returning `{ coins: _coinBalance, hints: _hintBalance, counters:
       { ..._walletCounters } }` — reusing `WalletCounters`, not the rich `WalletSnapshot`.)
     - **Checkpoint 2:** assign `_coinBalance`/`_hintBalance`/`_walletCounters` to
       `after` (absolute) under the new `'achievement'` `WalletMutationSource`;
       `persistWallet()`.
     - **Checkpoint 3:** `pendingSettlement = null`; `persistAchievementRecord()`.
  3. Return the `CommittedAchievementDelta`. `applyAchievementFact` returns it directly (the
     dog-found seam consumes it as-is); the completion seam attaches it to the existing
     `CompletionTransactionResult` as the new optional `achievementCommit` field (break #1 —
     never replacing the result). The whole method is synchronous with no `await`/callback
     between checkpoints, guaranteeing no player mutation interleaves.
- New `recoverPendingSettlement()` runs in `load()` after all keys parse: implements the
  KTD2 **component-by-component** `before`/`after`/mismatch resolution (each of `coins`,
  `hints`, and every `counters` field resolved against its own snapshot values) and is
  the only place load mutates the wallet. It is idempotent — a second `load()` sees
  `pendingSettlement == null` and does nothing.
- **Narrow the completion-reuse guard to stable identity (break #4).** In
  `beginLevelCompletionTransaction` (GameState.ts:646-650) drop `transaction.levelIndex ===
  levelIndex` from the `canReuse` predicate so an unadvanced active transaction for the same
  `levelId` is reused even after `currentLevelIndex` drifts. Keep `!transaction.advanced` and
  `transaction.levelId === input.levelId`. The reused transaction retains its original `id`
  (identity source for both the existing bonus/reward-progress dedupe and the new achievement
  occurrence dedupe). Guard this with a test that a same-`levelId` retry at a drifted
  `levelIndex` reuses the id, and that existing non-achievement completion behavior
  (stats/base-coins one-shot) is unchanged.
- **Fact builder (the documented mapping — break #1).** Invoke `applyAchievementFact` from
  `beginLevelCompletionTransaction` after stats/base-coins commit (GameState.ts:696), building
  the `LevelCompletionFact` with the explicit mapping (see U1): `transactionId ←
  transaction.id`, `levelId ← transaction.levelId`, `progressionIndex ← transaction.levelIndex`,
  `totalCompletions ← this._totalLevelsCompleted`, `streakDays ← this.currentStreakDays()`,
  timing/provenance copied from the transaction. The occurrence id is the transaction `id`.
  Invoke from the accepted dog-found path in `GameScene` (GameScene.ts:1371) with occurrence id
  `dog:<servedLevelId>:<dogId>`. Emit analytics (U6) by draining the outbox after commit.

**Execution note (fault-injection first):** Start with a failing test harness that wraps
`localStorage.setItem` to throw on the Nth call or on a named key, drives a completion
that crosses a reward threshold, reloads a fresh GameState from the (partially written)
storage, and asserts the wallet equals **exactly** the single-grant value on every
clean-tear boundary (recovered, not lost, not doubled). Inject a throw at each of the three
checkpoints **and after each individual wallet key** (HINTS, COINS, WALLET_COUNTERS) within
checkpoint 2, so mixed per-key tears (e.g. COINS advanced but HINTS not) are exercised;
assert component-wise load-time recovery lands every wallet component at `after` exactly
once.

**Test scenarios:**
- Covers AC3. Duplicate completion callback with same `transactionId` grants reward
  once; second call returns empty delta.
- Covers AC3. Reload GameState from persisted storage, re-apply same fact → no double
  grant, unlocked set unchanged.
- Covers AC3. Interrupted completion (transaction persisted, app "relaunched"
  mid-flow) then retried → single grant, single unlock.
- **Cursor-drift retry (break #4).** Persist an unadvanced active transaction, reload,
  move `currentLevelIndex` (simulating level-order reconciliation/navigation), then retry the
  same `levelId` completion → the reuse guard reuses the **same transaction id**, achievement
  occurrence dedupe holds, and there is no duplicate progress/unlock/reward. Assert the
  existing stats/base-coin one-shot flags are also unchanged by the guard narrowing.
- Covers AC3. Duplicate dog-found callback with same occurrence id → progress advances
  once.
- **Fault injection — crash after checkpoint 1 (wallet write never ran).**
  `persistAchievementRecord()` (pending written) succeeds, then `persistWallet()`
  throws. Reload → wallet `== before` → recovery assigns `after` **exactly once**
  (grant recovered); a second load is a no-op.
- **Fault injection — crash after checkpoint 2 (finalize never ran).** Wallet write
  landed but the finalize `persistAchievementRecord()` throws. Reload → wallet
  `== after` → recovery clears `pendingSettlement` with **no reapply** (never doubled).
- **Fault injection — mixed per-key wallet tear.** Within checkpoint 2, COINS persists
  but `persistWallet()` throws before HINTS/WALLET_COUNTERS. Reload → coins `== after`,
  hints/counters `== before` → **component-wise** recovery assigns hints/counters to `after`,
  leaves coins, and the whole wallet lands at `after` exactly once (not mis-read as
  corruption). Repeat with each key as the tear point.
- **Fault injection — crash before checkpoint 1.** Neither pending nor wallet persist;
  reload re-applies the fact cleanly, exactly once (occurrence not yet marked).
- **Mismatch policy.** Corrupt one wallet component so it equals neither its `before` nor
  its `after` while `pendingSettlement` is present → recovery trusts that component as-is,
  clears the pending marker, keeps the occurrence processed, and emits the
  reconciliation-anomaly event; no double grant, no crash.
- **Hint cap at settlement.** A +N-hint reward applied at a near-full/full wallet: `after.hints`
  is `min(before.hints + N, MAX_HINT_BALANCE)`, the delta's `GrantedReward.hints` is the
  actual applied amount (possibly 0), and no reload overfills or disagrees with the wallet.
- Covers AC6. After settlement, reward coins/hints land in wallet and `_walletCounters`
  with the `'achievement'` source; the wallet equals the `after` snapshot and
  `pendingSettlement` is `null`.
- Reward settled only for newly-unlocked entries, never on re-progress; at most one
  `pendingSettlement` exists at any time.
- **Fact-builder composition (break #1).** A completion drives the documented builder; the
  constructed `LevelCompletionFact` type-checks against the real `CompletionTransaction` + the
  post-register `_totalLevelsCompleted`/`currentStreakDays()`, and its `progressionIndex`/
  `totalCompletions`/`streakDays` equal the transaction index / fresh total / fresh streak.
- **Committed reward association (breaks #2/#4).** A multi-unlock completion returns a
  `CommittedAchievementDelta` whose `rewards` each carry the earning `achievementId` and the
  **applied** (post-cap) amounts; an unlock with no catalog reward yields no `GrantedReward`.
- **Mastery survives reload (break #5).** Complete distinct levels A and B as `newBest`
  (mastery=2), persist, reload, then a **repeat** `newBest` for A → mastery stays 2 (A already
  in `masteredLevelIds`), no re-unlock, no re-grant.
- **Analytics journaled before wallet (break #6).** Inject a `persistWallet()` throw at
  checkpoint 2; reload → the occurrence is processed **and** its full event list is still in
  `analyticsOutbox` (committed at checkpoint 1), so recovery both lands the wallet at `after`
  and re-emits every event — no committed occurrence ever lacks its events.
- **Settlement snapshot shape (break #3).** `settlementSnapshot()` returns
  `{ coins, hints, counters: WalletCounters }` and `before.counters`/`after.counters`
  type-check as the real `WalletCounters`; recovery resolves each counter field independently.
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
  record from `_totalLevelsCompleted`, `_bestTimes`, and `currentStreakDays()` only.
  **`currentLevelIndex` is deliberately excluded** — it is a selectable navigation pointer
  (GameScene.ts:1191), not completion proof, so progression milestones backfill from the
  durable completion count, never the level cursor. Runs as a single idempotent occurrence
  `migration:v<N>` recorded in `processedOccurrenceIds`.
- Clamp negative/NaN/absurd legacy counters to safe values before evaluating.
- Lifetime-dog, hintless, clean-run, replay stay unearned (no derivable source).
- Called from `load()` after all other keys parse, only when the record is absent or
  `version` is older.

**Test scenarios:**
- Covers AC4. Existing save with no achievement key loads unchanged; backfill produces
  the completion/progression/streak achievements its counters justify.
- Covers AC4. Malformed legacy counter (negative `_totalLevelsCompleted`, NaN best
  time) is sanitized; no crash, no spurious unlock.
- Covers AC4. A save whose `currentLevelIndex` is far ahead of `_totalLevelsCompleted`
  (player navigated but did not complete) backfills only what the completion count justifies
  — no progression milestone is granted from the level cursor.
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
  carries a stable `eventId` for downstream dedupe (analytics is **at-least-once at the local
  dispatch boundary**, never promised sink-level or provider-level delivery — the sink swallows
  errors and returns `void`, GameAnalyticsSink.ts:72-76 — dedupe is the consumer's job on the
  `eventId`).
- `AchievementAnalytics.ts` owns `AchievementAnalyticsPayload` types, the
  `PendingAnalyticsEvent = { eventId, name, payload }` outbox entry type, and a pure
  `deltaToEvents(committedDelta)` mapper that reads each `GrantedReward.achievementId` to
  associate reward events with their unlock and assigns each event a deterministic `eventId`
  (`<occurrenceId>:<eventKind>:<achievementId>`); it is well-defined for multi-unlock deltas
  and unlocks without rewards. Add thin `analytics.achievement*` methods to `AnalyticsService`
  mirroring `dogFound`/`resourceChanged` (AnalyticsService.ts:297-345).
- The full event list is appended to `record.analyticsOutbox` and persisted **in checkpoint 1**
  (U3 / KTD6), i.e. in the same record write that first marks the occurrence processed — never
  after finalize. Emit from GameState **after** the mutating commit by draining the outbox:
  hand each event to the local dispatch call; remove that `eventId` from the outbox **only
  after the `track` handoff returns without throwing** (the observable dispatch boundary — not
  a provider ack, which the sink cannot give) and persist (best-effort).
  On `load()`, re-dispatch **from the stored payloads** any events still in `analyticsOutbox`
  (KTD6 emission recovery — persistence succeeded, dispatch handoff interrupted; one
  occurrence's multiple events are fully reconstructable because the payloads, not just the
  occurrence id, are durable), removing each once its handoff returns. Page-view events are
  defined but emitted by the later UI card — this card only owns the contract.

**Test scenarios:**
- Covers AC7. `deltaToEvents` maps a multi-unlock delta to one event per unlock +
  one reward event per granted reward, in catalog order.
- Covers AC2/AC7. Zero-adaptation round-trip: payload built by the mapper is consumed
  by a consumer stub with no field renaming (contract-ownership proof).
- Covers AC3. Re-applied (already-processed) occurrence produces an empty delta →
  zero analytics events.
- **Emission recovery (multi-event reconstruction, dispatch-boundary only).** An occurrence
  committed with a progress + two unlock + one reward event, with those events still in
  `analyticsOutbox` (dispatch handoff interrupted before removal) → `load()` re-dispatches
  **all four** from their stored payloads to a **fake sink** exactly once, then removes them;
  a second `load()` dispatches nothing. Asserts each carries its stable `eventId` so downstream
  dedupe is safe — proving occurrence-id-only storage would have been insufficient. The test
  observes only which payloads reached the fake sink's dispatch boundary — **never** provider
  receipt (the real sink swallows errors and cannot ack).
- **No false delivery claim.** A dispatch that throws at the `track` handoff leaves the
  `eventId` in `analyticsOutbox` for re-dispatch; the test asserts the event is retained, not
  that any provider received it.
- Canonical event definitions typecheck against `CanonicalAnalyticsEventDefinition`.
- Analytics never mutates progress/unlocked/settlement — it only reads the delta and
  drains `analyticsOutbox`.

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
  the wallet at `after` exactly once. Because the wallet is **three separate keys**,
  recovery resolves each component (`coins`, `hints`, each `counters` field)
  independently, so a mixed per-key tear is repaired, not mis-read as corruption. Only a
  component matching neither its `before` nor `after` is genuine corruption, handled by the
  explicit at-most-once mismatch policy. Proven by the U3 fault-injection tests at every
  checkpoint and after every individual wallet key.
- **Hint reward exceeding the free-hint cap.** `after.hints` is computed post-cap before
  checkpoint 1 and `GrantedReward.hints` reports the actual applied amount, so the settlement
  target is always reachable (KTD2, U3 hint-cap test).
- **Fallback serving changes served level IDs.** Dedupe on transaction `id`, not
  served/wrapped identity (KTD3, U5 fallback test).
- **Economy distortion from reward inflation.** Reward-budget assertion in U2 caps the
  catalog total.
- **Silent double-emit of unlock analytics.** Emit strictly from the delta after the
  processed-id guard (U6 empty-delta test).
- **Guessing history during backfill.** Only derivable facts backfilled; migration is
  an idempotent occurrence (U5).
- **Breaking the existing completion consumer.** `CompletionTransactionResult` is preserved
  and only additively extended with `achievementCommit?`; a U3 test asserts the real GameScene
  consumer still reads `transaction`/`previousBest`/`newBest`/`baseCoinsGrantedNow` (break #1).
- **Wallet-counter semantic drift.** Achievement settlement advances only
  `coinsGranted`/`hintsGranted` by applied amount; `levelCompleteCoinGrants`/`rewardedHintGrants`
  (occurrence counts) are untouched, asserted in U3 (break #2).
- **Cursor-drift forking a new transaction id.** The reuse guard is narrowed to `levelId` +
  unadvanced so a retried completion at a drifted `currentLevelIndex` keeps the same id and
  dedupe holds; U3 cursor-drift retry test (break #4).
- **False analytics-delivery claim.** Durability is scoped to the local dispatch-call boundary
  (the sink swallows errors, gives no ack); tests assert only which payloads reached a fake
  sink, never provider receipt (break #5).

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
   fault-injected torn writes at every settlement checkpoint **and after every individual
   wallet key** (grant recovered component-by-component, never lost on a clean tear, never
   double-granted; corruption mismatch handled per component), hint-cap settlement,
   interrupted completion/retry, fallback serving, multi-event analytics emission recovery
   from a durable outbox (journaled in checkpoint 1, before the wallet write), persisted
   distinct-level mastery that does not re-increment on reload, the documented
   `LevelCompletionFact` builder mapping, committed `achievementId`-tagged post-cap rewards,
   the additive `CompletionTransactionResult.achievementCommit` field (existing consumer
   fields intact), the `levelId`-only completion-reuse guard surviving `currentLevelIndex`
   drift, and write-ahead settlement recovery all have passing deterministic tests (AC8).
3. Rewards are coins/hints only, modest and asserted-bounded; hint grants respect
   `MAX_HINT_BALANCE` with the applied amount recorded; achievement settlement advances only
   `coinsGranted`/`hintsGranted` (never the `levelCompleteCoinGrants`/`rewardedHintGrants`
   occurrence counts); `'achievement'` is added to `WalletMutationSource` and the real wallet
   methods compose; no dependency added (AC6).
4. Analytics contract emits progress/unlock/reward once-per-occurrence (stable per-event
   ids, durable outbox for recovery), scopes its guarantee to the local dispatch-call boundary
   (no false provider-delivery claim; sink swallows errors), and never mutates state (AC7).
5. All four gate commands pass; the diff stays within the scope fence and preserves
   the unrelated dirty evidence changes on main.
