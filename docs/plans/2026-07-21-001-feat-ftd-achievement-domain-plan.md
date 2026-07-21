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
uses a **recoverable write-ahead settlement journal**: we first durably flush a *baseline*
of the current wallet (so the recorded "before" equals persisted storage even if an earlier
`save()` had torn); then, before touching the wallet, we durably record a *pending settlement*
that names the occurrence and the absolute before/after wallet snapshots; we then write the
wallet; then we durably finalize (clear the pending settlement). Because the pending settlement
carries the exact target state, load can always tell whether the wallet write happened and
finish the job either way. The guarantee we make is therefore stronger than the prior draft's:
**exactly-once and recoverable across a crash at any write boundary (baseline or the three
settlement writes)**
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
  `!transaction.advanced` **and** `transaction.levelIndex === input.levelIndex`
  (GameState.ts:646-650); this guard is **preserved unchanged** (KTD3). Achievement dedupe is
  keyed on the completion transaction `id`, which is **per accepted completion, not per level
  lifetime** — a later intentional same-level completion correctly mints a new transaction id
  and is a distinct achievement occurrence, so it advances progress normally.

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

**A pure `applyDeltaToRecord` closes the progressChanges → persisted-progress gap (correction
3).** `apply()` returns a delta whose `progressChanges: AchievementProgressChange[]` carry the
new per-achievement progress values, but the durable record persists `progress: Record<id,
number>` — nothing mapped the changes into that map, so a red-team break was that processed
occurrences persisted while cumulative progress did **not**, and after reload the next fact
recomputed from a stale (or zero) base. So `AchievementSystem` owns an explicit **pure**
`applyDeltaToRecord(record, delta): AchievementRecord` that produces the next record by folding
**every** `progressChanges` entry into `progress[id]`, adding `newlyUnlocked` ids to `unlocked`,
adding **`delta.masteredLevelIdsAdded`** to `masteredLevelIds`, and appending the
occurrence to `processedOccurrenceIds` — all **together**, as one derived next-record value.

**The delta is self-sufficient for mastery folding — no hidden fact dependency (fixes the
latest red-team break #1).** The prior draft had `applyDeltaToRecord` read `fact.levelId`/
`fact.newBest` to update `masteredLevelIds`, but the `AchievementDelta`/`CommittedAchievementDelta`
it consumes carry **only** `{ occurrenceId, progressChanges, newlyUnlocked }` — no `levelId`, no
`newBest` — so the promised consumer could not compose. Fix: `apply()` **derives** the mastery
additions itself and puts them **on the delta** as `masteredLevelIdsAdded: readonly string[]`
(computed from `fact.levelId`/`fact.newBest` against the record's existing `masteredLevelIds` —
non-empty only for a `newBest` completion of a level not already mastered; always `[]` for
dog-found/progress-only facts). `applyDeltaToRecord(record, delta)` then folds `masteredLevelIdsAdded`
with progress/unlocks/processed and never touches the fact. A U2 round-trip repeat-best test proves
a second `newBest` for an already-mastered level yields `masteredLevelIdsAdded: []` (mastery does
not re-increment after reload).
GameState's checkpoint-1 mutation (and the progress-only/no-wallet path, and migration) applies
its record change **through this one function** so cumulative progress, unlocks, mastery, and
processed-set always advance consistently. A U3 serialize/reload test proves cumulative progress
survives a round-trip and the next fact continues from the persisted value, not a stale base.

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
through a write-ahead protocol (a strict transaction-identity+progression-snapshot checkpoint 0a
FIRST plus a strict completion-progression checkpoint 0pre — both for every completion fact — plus a wallet
baseline checkpoint 0b plus checkpoints 1–3) that carries the
exact target wallet state, so recovery is unambiguous regardless of which write tore.

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

**Baseline checkpoint establishes a trustworthy `before` (fixes red-team break #4).** The
`before` snapshot must equal the *persisted* wallet, not just in-memory state. But the existing
base-coin path writes `COINS` (GameState.ts:911) and can throw before `WALLET_COUNTERS`
(GameState.ts:922) earlier in the same completion, so at the moment settlement begins the
**stored** wallet may already be torn relative to memory. If we captured `before` from
post-grant memory and a prior tear left storage at a mixed state, recovery could later find a
component matching **neither** `before` nor `after` and misclassify a clean earlier tear as
corruption. So the protocol opens with a **strict synchronous baseline checkpoint (checkpoint
0)**: durably persist `HINTS`, `COINS`, `WALLET_COUNTERS` from current in-memory values with an
**error-propagating** helper, *then* capture that exact just-persisted state as `before`. This
guarantees stored-wallet == `before` regardless of any earlier broad `save()` tear. **If
baseline persistence throws at or after any key, abort immediately** — before marking the
occurrence processed, before appending the outbox, before writing `pendingSettlement`: no
achievement reward/unlock/analytics commit occurs, the fact stays unprocessed, and the next
attempt/reload re-derives it cleanly. (The abort is safe because nothing durable about the
achievement has been written yet.)

**Strict completion-transaction identity is durable BEFORE any achievement checkpoint
(fixes red-team break #1).** The occurrence id for a completion fact is the completion
transaction `id`, and `processedOccurrenceIds` dedupe depends on that id being **durably
recoverable**. But the existing broad `save()` writes `COINS` (GameState.ts:911) *before*
the `ACTIVE_COMPLETION_TRANSACTION` key (GameState.ts:919) and can throw in between — so at
the moment settlement begins, the accepted transaction may exist only in memory, not in
storage. If checkpoints 1–3 then committed an achievement under that **non-durable**
transaction id, a crash before another successful transaction write would reload without the
id, mint a *new* completion id on retry, and bypass achievement dedupe → a **second grant**.
So the protocol opens with two strict synchronous identity checkpoints, **transaction+snapshot
first, then progression** (fixes the latest red-team break #1 — see below why transaction-first,
not progression-first):

**Checkpoint 0a — strict transaction-identity persist, carrying a recoverable progression snapshot
(fixes the latest red-team break #1).** `registerLevelComplete` sets `completionStatsRegistered`
`true` (GameState.ts:115,683) on the transaction, but the **progression state that flag guards**
(`_bestTimes`, `_streakDays`, `_streakLastDate`, `_totalLevelsCompleted`) is persisted only by the
broad `save()`, whose separate keys (STREAK_DAYS 905, STREAK_LAST_DATE 906, BEST_TIMES 907,
TOTAL_LEVELS_COMPLETED 908, COINS 911, ACTIVE_COMPLETION_TRANSACTION 919) can tear in any order.
The **prior draft's progression-first order was itself a break**: it could durably persist an
advanced `TOTAL_LEVELS_COMPLETED` **before** the transaction flag landed, so a crash between them
reloaded advanced progression with a *false/absent* guard and re-registered the same completion — a
double advance. The fix is to make the transaction the **single durable carrier of both the flag and
the exact post-register progression target**: extend `CompletionTransaction` with an optional
absolute `completionProgressAfter?: { bestTimes, streakDays, streakLastDate, totalLevelsCompleted }`
(U1). When registration succeeds, set `completionStatsRegistered = true` **and**
`completionProgressAfter = <exact absolute post-register state>` in memory, then **strict-persist
`ACTIVE_COMPLETION_TRANSACTION` FIRST** via a new **error-propagating**
`persistActiveCompletionTransaction()` helper (single `setItem`, confirming `transaction.id` and the
embedded snapshot are stored). Rely on `load()`'s existing `sequenceFromCompletionId(...)` max logic
(GameState.ts:965-968) for sequence recovery. **If this strict write throws, abort before any
progression/record/outbox/reward/wallet-baseline state is touched** — the fact stays unprocessed, a
same-process retry may reuse the in-memory transaction, but **no achievement can durably commit under
a non-durable id and no progression is left advanced without its guard**.

**Checkpoint 0pre — strict completion-progression persist (after 0a).** After the transaction
(flag + snapshot) is durable, a new **error-propagating** `persistCompletionProgress()` helper
strictly persists `BEST_TIMES`, `STREAK_DAYS`, `STREAK_LAST_DATE`, and `TOTAL_LEVELS_COMPLETED` from
current memory. Ordering for **every** `LevelCompletionFact`: **0a strict transaction+snapshot →
0pre strict progression → achievement record (checkpoint 1)**; if either 0a or 0pre throws,
**abort** the achievement commit. Because 0a lands first, a tear *between* 0a and 0pre leaves a
durable transaction whose `completionProgressAfter` snapshot names the exact target — and
**load recovery reconciles progression to that snapshot** before any new fact:

**Load-time progression reconciliation (break #1).** On `load()`, before
`beginLevelCompletionTransaction`/`applyAchievementFact`, if an active transaction has
`completionStatsRegistered === true` **and** a `completionProgressAfter` snapshot, reconcile
`_bestTimes`/`_streakDays`/`_streakLastDate`/`_totalLevelsCompleted` to that snapshot and
**strict-persist** them, then continue. Thus a transaction-first tear (0a landed, 0pre torn) repairs
stats from the snapshot; a stats-after-flag write can never leave a false guard because the flag and
its exact target are always durable together on the transaction. Transactions **without** a snapshot
(legacy/pre-migration) retain existing `beginLevelCompletionTransaction` behavior unchanged.
Fault-inject after the transaction write and after each progression key; a fresh load converges to
the snapshot exactly once.

Protocol (per accepted occurrence), fully synchronous — **no
player mutation may interleave the checkpoints**. **Checkpoints 0a + 0pre run for EVERY
`LevelCompletionFact`, including progress-only/no-reward deltas** (occurrence-durability is
independent of whether a reward is granted — latest break #3); the wallet baseline 0b and
checkpoints 1–3's wallet write are reward-only. Dog-found facts skip 0a + 0pre (no completion
transaction; their occurrence id derives from already-durable level/dog state):
0a. **Transaction identity + progression snapshot (checkpoint 0a) — completion facts only
   (break #1).** In memory set `completionStatsRegistered = true` and `completionProgressAfter`
   (absolute post-register bestTimes/streakDays/streakLastDate/totalLevelsCompleted), then durably
   persist the accepted `ACTIVE_COMPLETION_TRANSACTION` via the error-propagating
   `persistActiveCompletionTransaction()`, confirming `transaction.id` and the snapshot are stored;
   if it throws, **abort** (no progression/achievement/wallet state written). (Dog-found facts have
   no completion transaction and skip this checkpoint — their occurrence id
   `dog:<servedLevelId>:<dogId>` is derived from already-durable level/dog state.)
0pre. **Completion progression (checkpoint 0pre) — completion facts only.** Durably
   persist `BEST_TIMES`/`STREAK_DAYS`/`STREAK_LAST_DATE`/`TOTAL_LEVELS_COMPLETED` from current
   memory via the error-propagating `persistCompletionProgress()`; if it throws, **abort** (no
   achievement/wallet state written). A tear here is repaired on load from the transaction's
   durable `completionProgressAfter` snapshot (above).
0b. **Baseline (checkpoint 0b).** Persist `HINTS`/`COINS`/`WALLET_COUNTERS` from current memory
   via the error-propagating `persistWallet()`; if it throws, **abort** (no achievement state
   written). On success, capture `before = settlementSnapshot()` from that just-persisted state.
1. **Write-ahead (checkpoint 1).** `apply()` returns the delta. Compute the post-cap
   reward (coins uncapped; hints capped to room) and build the committed delta + its full
   analytics event list (`deltaToEvents`). In memory, mark the occurrence `processed`, add
   unlocks, advance persisted mastery identity (masteredLevelIds, KTD4/U1), **append the
   complete analytics event list to `analyticsOutbox`**, and set `pendingSettlement =
   { occurrenceId, before = the checkpoint-0 baseline snapshot, after = before + post-cap
   reward }` (`before` is the just-persisted baseline from checkpoint 0, so stored-wallet ==
   `before` holds by construction). Durably persist the **record key** — this single write
   commits the occurrence-processed
   mark, the unlocks, the reconstructable analytics events, and the settlement intent
   **together**, so no later crash can leave a committed occurrence without its recoverable
   events (closing the prior draft's gap where the outbox was appended only after finalize).
2. **Write wallet (checkpoint 2).** Apply the reward through the **shared non-persisting
   economy primitives** — `applyCoinGrant(coins, 'achievement')` and the existing
   `applyHintGrant(hints, …)` (GameState.ts:485-493) — **not** the public `grantCoins`/
   `grantHints`, which call the broad, exception-swallowing `save()` (GameState.ts:471, 499)
   and would re-tear the wallet outside the checkpoint discipline. `applyHintGrant` already
   validates, caps, mutates `_hintBalance`, and increments `_walletCounters.hintsGranted`
   without persisting; U3 extracts the symmetric `applyCoinGrant(amount, source)` primitive
   that `grantCoins` now calls before its `save()`, so both the public path and the
   achievement path share one validate/increment-counters mutation semantics (correction 2).
   Because the primitives are applied to the checkpoint-0 baseline wallet, the resulting
   balances equal the `after` snapshot by construction. Then durably persist the **wallet
   keys** via the strict, throwing `persistWallet()` — HINTS, COINS, and WALLET_COUNTERS,
   three separate `setItem` calls that can each land or tear independently. (Recovery, by
   contrast, may assign the `after` snapshot **absolutely**, since it is repairing toward a
   known target rather than making a fresh grant.)
3. **Finalize (checkpoint 3).** Clear `pendingSettlement` to `null` in memory. Durably
   persist the **record key** again. Settlement is complete.

**In-memory rollback restores the ACTUAL last durable record — not always pre-checkpoint-1
(corrections 4 + 8).** `applyAchievementFact` tracks a `lastDurableRecord` snapshot that always
equals what storage last committed:
- **Before checkpoint 1** it is the pre-transaction record (the record as loaded/last persisted,
  occurrence still unprocessed).
- **After checkpoint 1's `persistAchievementRecord()` returns** it is updated to the just-committed
  record (occurrence processed, progress folded, unlocks, `masteredLevelIds`, `analyticsOutbox`,
  and the non-null `pendingSettlement`) — because that state is now durable.

On a **record-write throw**, roll the in-memory record back to `lastDurableRecord`, matched to
which checkpoint failed:
- **Checkpoint 1 throws** (nothing about this occurrence is durable yet): rollback lands on the
  **pre-transaction** snapshot, occurrence **unprocessed**. A same-process retry re-derives the
  fact cleanly and grants exactly once — closing the original correction-8 false-dedupe (a
  committed-in-memory-but-not-durable occurrence). U3 injects a checkpoint-1 throw, retries the
  same fact **in-process** (no reload), asserts a single grant/unlock.
- **Checkpoint 3 throws** (checkpoint 1 **and** the checkpoint-2 wallet write **are durable**):
  rollback must land on the **post-checkpoint-1 pending snapshot** (occurrence **processed**,
  `pendingSettlement` still present) — **never** the pre-checkpoint-1 record (correction 4). If it
  rolled back to pre-checkpoint-1, a same-process retry would see the occurrence unprocessed,
  re-baseline the **already-rewarded** wallet, and grant a **second** time. Instead, the occurrence
  stays processed and `pendingSettlement` remains, so the wallet is already at `after` with a live
  pending marker; the next fact/retry must run `recoverPendingSettlement()` first, which finds every
  component `== after`, finalizes (clears pending) without reapplying, and only then applies the new
  fact — no double grant, no lost grant. A U3 test injects a checkpoint-3 throw, then **retries the
  same fact in the same process** and asserts the reward is **not** doubled and pending finalizes.

(Checkpoint 2 is a wallet write, not a record write; a throw there leaves the durable
`pendingSettlement` from checkpoint 1 intact and is resolved by `recoverPendingSettlement()` — the
in-memory record already matches `lastDurableRecord`, so no record rollback is needed.)

**Recovery on load.** If `pendingSettlement` is absent, nothing to do. If present, resolve
each wallet component (`coins`, `hints`, every `counters` field) independently against
its own `before`/`after`:
- component `== before` → its checkpoint-2 write never landed → assign the component to
  `after`.
- component `== after` → its write landed → leave as-is.
- component matches **neither** → true anomaly for that component (only possible on genuine
  storage corruption, since per-key writes are atomic). **Mismatch policy:** do **not**
  reapply — trust the stored component as-is, and **append a fully-formed
  `achievement_reconciliation_anomaly` event (stable `event_id`, complete payload whose
  concrete `wallet_component` dimension names the mismatched wallet component — break #3 — plus
  the occurrence id) to `analyticsOutbox`** so the post-composition drain
  dispatches it (correction 6 — recovery **may and must** update the outbox; the prior rule
  forbidding it left the anomaly undispatchable because drain is the only dispatcher). This biases
  the corrupted edge to **at-most-once** (never a double grant).
**Recovery must durably persist the repaired wallet before clearing the intent
(correction 6).** The prior draft resolved components *in memory*, then cleared
`pendingSettlement` and persisted only the record — so a second fresh `load()` would read
the still-torn stored wallet at `before` with no pending intent and **permanently lose the
grant**. The corrected ordering, executed while `pendingSettlement` remains durable:
1. Resolve each wallet component in memory (component-wise `before`/`after`/mismatch above); on
   any component mismatch, **append the `achievement_reconciliation_anomaly` event to the
   in-memory `analyticsOutbox`** (correction 6) so it is carried into the record persist at step 3.
2. **Strict-persist** the repaired wallet — `persistWallet()` writing HINTS/COINS/
   WALLET_COUNTERS — with the throwing helper. If this tears, `pendingSettlement` is still
   durable (not yet cleared), so the next `load()` simply re-resolves and re-persists: safe.
3. Only after the wallet persist returns, clear `pendingSettlement` to `null`, keep the
   occurrence marked processed, and `persistAchievementRecord()` — which durably commits the
   cleared pending **and any appended anomaly event in `analyticsOutbox`**, so the post-composition
   `drainAnalyticsOutbox()` will dispatch it. If **this** final record
   write fails, the next `load()` sees wallet `== after` **and** a still-present pending —
   component-wise recovery finds every component already at `after` (leaves them) and
   finalizes without reapplying: no double grant, no lost grant.
Recovery is idempotent: once both writes land, a second `load()` sees
`pendingSettlement == null` and does nothing. A U3 test drives recovery, then a **second
fresh `load()` from the persisted storage**, and asserts the reward is present exactly once
(never lost on the second load).

Because checkpoint 0b forces stored-wallet == `before` before any achievement state is written
(and checkpoint 0a has made the completion transaction id + its `completionProgressAfter` snapshot
durable and checkpoint 0pre has made the guarded completion progression durable, so dedupe and
stats-consistency both survive a crash — the transaction-first order plus load-time snapshot
reconciliation closes break #1), and each later checkpoint is a set of single-key atomic `setItem`s,
a crash *at* or *between* any checkpoint (0a–3) leaves every wallet component in exactly its own
`before` or `after`, all of which component-wise recovery resolves to a single grant. A crash
*during* checkpoint 0a, 0pre, or 0b itself writes no `pendingSettlement`, so recovery has nothing to reconcile
and the fact is
re-derived cleanly on the next attempt. The prior draft (which captured `before` from post-grant
memory over a possibly-torn stored wallet, and whose whole-snapshot comparison mis-read a mixed
per-key tear as corruption) is removed.

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

**Active-completion reuse guard is preserved unchanged (reverts the prior narrowing per
contract red-team).** An earlier draft narrowed `beginLevelCompletionTransaction`'s reuse
guard (GameState.ts:646-650) to `levelId` + unadvanced, dropping the
`transaction.levelIndex === input.levelIndex` check, to make an interrupted completion's retry
reuse the same transaction id even if `currentLevelIndex` had drifted. The cross-provider red
team showed this **over-reuses**: with the `levelIndex` check gone, one transaction id would
represent *multiple intentional same-level completions*, and achievement occurrence dedupe
(keyed on transaction `id`) would then **suppress a legitimate later same-level completion's
progress/reward**. That is worse than the drift it tried to fix. So this plan **reverts to the
existing guard exactly** (`!transaction.advanced && transaction.levelId === input.levelId &&
transaction.levelIndex === input.levelIndex`, whatever the shipped predicate is — U3 changes
**nothing** here). The correct model: **achievement dedupe is per accepted completion
transaction, not per level lifetime.** An interrupted completion's retry that reuses the *same
unadvanced* transaction (same `levelIndex`) is one occurrence and grants once; a later
*intentional* same-level completion is a *new* accepted transaction with a *new* id, a distinct
occurrence that correctly advances achievement progress. The rare cursor-drift case (level-order
reconciliation moves `currentLevelIndex` between an interrupted completion and its retry) mints a
new transaction id — but since the interrupted transaction never `advanced`/committed its
achievement occurrence, the retry grants exactly once, so no double grant results from
preserving the guard. U3 tests both directions: a duplicate callback on **one** transaction is
suppressed (empty delta), **and** a later **distinct** transaction for the same level advances
achievement progress normally.

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

**Migration grants NO retroactive rewards — conservative backfill (correction 7).** A
derivable historical achievement is marked **unlocked** and its progress set, but it is also
recorded as **reward-settled with no reward**: `migrate()` writes NO `pendingSettlement`, NO
wallet mutation, and NO reward entitlement or reward/`achievement_reward:granted` analytics
event for backfilled unlocks (it may emit an `achievement_unlocked` event so the UI can reflect
the state, but never a reward event). The achievement's id is added to `unlocked` and to a
persisted **reward-settled** set (or the occurrence is otherwise marked reward-ineligible) so
that a **later** in-game fact touching that already-unlocked achievement cannot re-cross its
threshold and mint its catalog reward — a migrated unlock is terminal for reward purposes. Only
achievements first unlocked by a **post-migration** live fact settle a reward normally through
the write-ahead protocol. A U5 test proves: (a) migration awards a derivable unlock with **zero**
wallet change and no reward event; (b) a subsequent live fact for that same migrated achievement
does **not** grant its reward (already unlocked/settled); (c) a genuinely new post-migration
achievement rewards normally. Rationale: the card forbids guessing history, and paying out a
lump of retroactive rewards on first upgraded load would distort the existing economy and
double-reward players who later replay.

**KTD6 — Analytics must compose through the whole typed stack, not just the FTD
registry (fixes red-team breaks #1 and #3).** Emitting achievement events requires
changes at **four** real seams, each proven by test — adding only canonical registry rows
does **not** make the call type-check or preserve fields:
- **`FtdEvent` union (AnalyticsService.ts:13-32).** `AnalyticsService.sdk` is
  `Analytics<FtdEvent>`, so `sdk.track(name, params)` only type-checks for names in the
  `FtdEvent` union. Add `'achievement_progress'`, `'achievement_unlocked'`,
  `'achievement_reward_granted'`, `'achievement_reconciliation_anomaly'` (and the later-UI
  `'achievement_page_viewed'` / `'achievement_viewed'`) to `FtdEvent`, plus a typed params
  interface per event and a thin `analytics.achievement*` method for each (mirroring
  `dogFound`/`resourceChanged`, AnalyticsService.ts:297-345). Without this the planned
  `sdk.track('achievement_progress', payload)` does not compile.
- **Canonical registry (`CanonicalAnalyticsEvents.ts`).** Add a
  `CanonicalAnalyticsEventDefinition` row per achievement event. The interface
  (CanonicalAnalyticsEvents.ts:8-19) requires **every** of `id`, `firebaseName`,
  `gameAnalyticsName` (`achievement:progress`, `achievement:unlocked`,
  `achievement:reward:granted`, `achievement:reconciliation:anomaly`), `family: 'design'`,
  `panel` (a `CanonicalDashboardPanel`, e.g. `'retention'`), `question`, `primaryDimensions`,
  **`instrumentationStatus`** (a `CanonicalInstrumentationStatus` — `'runtime'` for the
  progress/unlock/reward events this card emits, `'contract'` for the page-view events the
  later UI card will emit), and **`successBoundary`** (a one-line string describing when the
  event fires, e.g. `'GameState finalizes an achievement settlement and drains its outbox.'`)
  — the prior draft omitted `instrumentationStatus`/`successBoundary`, so the `satisfies`
  check on the registry array would fail to typecheck (correction 5). Plus — critically — the
  optional **`allowedGameAnalyticsCustomFields`** list naming every dimension the wire path
  must carry (`achievement_id`, `occurrence_id`, `event_id`, `category`, `progress`,
  `threshold`, `reward_coins`, `reward_hints`, and — on the
  `achievement:reconciliation:anomaly` row — **`wallet_component`**, break #3).
  `compactCustomFields` (GameAnalyticsEvents.ts:150-177)
  drops any key not on this allow-list, so an omission here silently strips the field —
  in particular the anomaly's diagnostic `wallet_component` (which names the torn wallet
  component: `coins` | `hints` | `coinsGranted` | `hintsGranted` | …) would be lost without it.
- **`dashboardImportDimensionKeys` superset (fixes the latest red-team break #4).** Any dimension
  a canonical row lists in `primaryDimensions` must **also** appear in the exported
  `dashboardImportDimensionKeys` allowlist (CanonicalAnalyticsEvents.ts:601) — the
  `purchase-funnel-analytics.test.ts` superset gate (lines 35-38) fails if a `primaryDimension` is
  missing from it, and the live-feed/import paths silently drop or reject the unknown key. The
  anomaly row puts `wallet_component` in `primaryDimensions`, so `wallet_component` must be **added
  to `dashboardImportDimensionKeys`** in **find_the_dog's own** `CanonicalAnalyticsEvents.ts`
  (line 601 — this is the copy the `purchase-funnel-analytics.test.ts` imports and the only one
  inside the `analytics/**` fence; the separate shell_template copy is **out of scope and left
  untouched**). The existing superset test is updated/extended to cover the achievement rows so the
  invariant is enforced.
- **GameAnalytics design mapping (`GameAnalyticsEvents.ts`).** The sink's `dispatch`
  (GameAnalyticsSink.ts:106-128) routes any **unrecognized** event name to
  `trackDesign(designEvent(gameAnalyticsDesignEventId(name, params), params, …))`, and
  `designEvent` (GameAnalyticsEvents.ts:73-84) sets `customFields` to **`{}`** when
  `canonicalEventIdForDesignEvent(eventId)` returns `null`. Today `achievement:*` returns
  `null` there (GameAnalyticsEvents.ts:190-200), so **every achievement payload field would be
  dropped on the GameAnalytics wire**. Fix: add `achievement:progress` → `achievement_progress`,
  `achievement:unlocked` → `achievement_unlocked`, `achievement:reward:granted` →
  `achievement_reward_granted`, `achievement:reconciliation:anomaly` →
  `achievement_reconciliation_anomaly` to `canonicalEventIdForDesignEvent` so the canonical id
  resolves and `compactCustomFields` runs against the allow-list above. **Note the exact
  colon forms (correction 4):** `gameAnalyticsDesignEventId` (GameAnalyticsEvents.ts:125-140)
  ends in `eventName.replace(/_/g, ':')`, which converts **every** underscore — so the FtdEvent
  name `achievement_reward_granted` (two underscores) becomes `achievement:reward:granted`
  (two colons), and `achievement_reconciliation_anomaly` becomes
  `achievement:reconciliation:anomaly`. The canonical `gameAnalyticsName` and the
  `canonicalEventIdForDesignEvent` key must use these exact multi-colon forms; the prior draft's
  single-colon `achievement:reward_granted` would never match, leaving `customFields` zeroed.
  The default `_`→`:` mapping already yields these ids, so no explicit `gameAnalyticsDesignEventId`
  case is needed — only the `canonicalEventIdForDesignEvent` reverse entries above.)
  **Also map the later-UI page-view ids now (correction 5).** Even though this card does **not**
  emit them (ACH-2 does), the reverse mapping and canonical rows/allow-lists must already carry
  `achievement:viewed` → `achievement_viewed` and `achievement:page:viewed` →
  `achievement_page_viewed` (from `achievement_viewed`/`achievement_page_viewed` under the
  `_`→`:` rule). Otherwise, when ACH-2 emits them, the sink's fall-through hits
  `canonicalEventIdForDesignEvent === null` and zeroes their `customFields` — the same drop
  this card fixes for its own events. Owning the full reverse mapping here keeps the contract
  whole for the consuming card.
- **Sink test (`achievement-analytics.test.ts` + the GameAnalytics sink path).** Assert that
  dispatching a real `achievement_unlocked`/`achievement_progress`/`achievement_reward_granted`
  event through the GameAnalytics sink produces a `designEvent` whose `customFields` **contains**
  `achievement_id`, `event_id`, `progress`/`threshold`, and applied `reward_coins`/`reward_hints`
  (not `{}`), proving the fields survive end-to-end and are not stripped.

`GameState` emits unlock/progress/reward events from the delta **after** the mutation commits,
and an `AchievementAnalyticsPayload` type owned by the achievements module is the shape the UI
card imports with **zero adaptation** (board lesson: contract-ownership). The canonical
`firebaseName`/`gameAnalyticsName` and allowed-field list are the wire contract those payloads
map onto.

**Emission recovery (persistence succeeds, sink interrupted).** Analytics is a sink,
not part of the durable transaction, so emission can fail or be interrupted after the
record has already committed the unlock/reward. Storing only occurrence ids is
insufficient: one occurrence maps to **multiple** distinct events (a progress event, one
`achievement_unlocked` per unlock, and a reward event), so after a crash `load()` cannot
reconstruct the exact payloads from an occurrence id alone. The record therefore carries a
durable **analytics outbox** — `analyticsOutbox: PendingAnalyticsEvent[]`, where
`PendingAnalyticsEvent` is a **discriminated union on `name`** (break #2) whose each member is
a fully-formed `{ eventId, name, payload }` pairing the literal event name with its exact
payload type, with a **stable, bounded `eventId`** and the complete payload the sink needs.

**The stable `event_id` is a durable monotonic sequence id — no hashing (fixes the latest
red-team break #3).** `compactCustomFields` truncates every string custom-field **value** to 96
chars (`trimmed.slice(0, 96)`, GameAnalyticsEvents.ts:159). A naïve
`<occurrenceId>:<eventKind>:<achievementId>` id is unbounded and would silently truncate on the
wire; the prior draft's bounded hash `<eventKind>:<achievementId>:<shortHash(occurrenceId)>` fixed
the length but reintroduced a **collision** hazard — `shortHash` is a 32-bit FNV digest, so two
distinct occurrences (e.g. `completion:2155:0:synthetic-level-2155` and
`completion:11853:0:synthetic-level-11853`) can hash to the same value and alias downstream for the
same kind+achievement. So the id is **not derived from the occurrence id at all**. Instead the
record carries a durable monotonic `nextAnalyticsEventSequence: number`, and `deltaToEvents`
allocates **one sequence-backed id per event** — `ach:<sequence>:<eventKind>:<achievementId>` — and
advances `nextAnalyticsEventSequence` by the number of events minted, **in the same checkpoint-1
record write** that journals the outbox (so the counter's advance is durable and atomic with the
events it stamped; a rollback restores the counter with the record). Every id is unique across the
game's lifetime by construction (the counter never repeats), and catalog achievement `id` length is
**asserted ≤ a fixed bound** so `ach:<sequence>:<eventKind>:<achievementId>` is provably ≤96 chars
and never hits the slice — with **no** hash, hence **no** collision. Migration and
load-time sanitization **initialize/repair** `nextAnalyticsEventSequence` (absent/NaN/negative →
`0`, or → one past the max sequence already present in `analyticsOutbox`, so a recovered outbox
never re-mints a live id). This **same sequence-backed id** is stored in **both**
`PendingAnalyticsEvent.eventId` **and**
`payload.event_id`, so what is journaled equals what travels the wire — the id never changes or
truncates between the outbox and the sink. **Wire field is `event_id` (snake_case) — correction 2.** The outbox
entry's structural `eventId` is an internal convenience only; the value that travels **on every
analytics payload and every GameAnalytics wire row is `event_id`** (snake_case), because
`compactParams`/`compactCustomFields` filter on the **exact** snake_case allow-list key
(GameAnalyticsEvents.ts:150-177). So each `analytics.achievement*` params type carries
`event_id: string` (set from the outbox entry's `eventId`), `event_id` is on every canonical
row's `allowedGameAnalyticsCustomFields`, and a U6 test asserts `event_id` **survives both
`compactParams` and `compactCustomFields`** (i.e. is present in the emitted design-event, not
stripped). No automatic OwnedMirror top-level-id dedupe is claimed on this id (correction 3).
**Ordering (durability-first, fixes the prior gap):** the full event
list is appended to `analyticsOutbox` and persisted **in the same checkpoint-1 record write
that first marks the occurrence processed/unlocked** — *before* the wallet write and *before*
finalize — so there is never an instant where a committed occurrence exists without its
reconstructable events. This holds for reward paths, progress-only/no-wallet paths, and
migration alike (each first commits its outbox with its occurrence mark).

**Public typed dispatcher — no dynamic private-sdk access (correction 1).** `AnalyticsService.sdk`
is **private** and only the per-event camelCase methods are public, so neither
`analytics.track(event.name, event.payload)` nor `analytics[event.name](event.payload)`
type-checks from `GameState`. So `AnalyticsService` exposes **one** public
`dispatchAchievementEvent(event: PendingAnalyticsEvent): void` with an **exhaustive `switch`**
over the achievement event-name union (`achievement_progress` | `achievement_unlocked` |
`achievement_reward_granted` | `achievement_reconciliation_anomaly`). Because
`PendingAnalyticsEvent` is a **discriminated union keyed on `name`** (break #2 — each member
couples its literal `name` with its exact payload type), `switch (event.name)` **narrows
`event.payload`** to the matching payload type inside each arm, so each arm's typed
`analytics.achievement*(event.payload)` call type-checks; a non-discriminated
`{ name: union; payload: union }` would leave `payload` a union that no typed method accepts.
The `switch` is `never`-exhaustive so a future event name fails to compile until an arm is added.
`GameState.drainAnalyticsOutbox()` calls **only** this public dispatcher per event — no dynamic
property access, no `sdk` reach-in. (The later-UI page-view names are dispatched by ACH-2, not by
this card's drain, so they are not arms of this switch yet.)

**Honest dispatch boundary — there is no sink-success ack (fixes red-team break #5).**
The only observable boundary is the **synchronous return of the local dispatch call**:
`dispatchAchievementEvent` → `analytics.achievement*` → `sdk.track(...)`, which enqueues/hands off
locally and **returns `void`**; the underlying sink (`GameAnalyticsSink`) initializes lazily,
**swallows** initialization and dispatch errors (GameAnalyticsSink.ts:72-76), and never
reports provider delivery. So "emitted successfully to the provider" is **unobservable** and
this plan does not claim it. The durable guarantee is scoped to what we can observe: after
the settlement finalizes, GameState drains the outbox by handing each event to
`dispatchAchievementEvent`; an `eventId` is removed from the outbox **only after that dispatch
returns without throwing** — proving the event reached the local dispatch boundary, **not**
that a provider received it.

**`load()` must NOT drain the outbox — drain only after analytics is composed (correction 1).**
`GameState` is a singleton constructed (and `load()`-ed) **before** `getSdkContext()` composes
`AnalyticsService`; the default pre-composition SDK has `sinks: []`, so a load-time dispatch
would return normally and **delete the outbox events without any real sink ever seeing them**.
Therefore `load()` **never dispatches** — it only recovers wallet/settlement and, on a mismatch,
**appends** a reconciliation-anomaly event to `analyticsOutbox` for later drain (correction 6),
without ever handing an event to a sink. Draining is an **explicit method**
(`drainAnalyticsOutbox()`) invoked by the
bootstrap/`SdkContext` path **after** the real analytics sinks are installed and ready — the
same seam that already wires `AnalyticsService` into `GameState`. Both the normal
post-settlement drain and the recovery-of-a-previously-committed-outbox drain go through this
one post-composition entry point. A U6 test asserts a **pre-composition `load()` retains** the
outbox events (dispatches nothing) while a **post-composition `drainAnalyticsOutbox()`
dispatches and removes** them.

Because each event carries a stable `eventId`, re-dispatch is at-least-once **at the local
dispatch boundary only**. We **do not** promise sink-level, mirror-level, or provider-level
exactly-once (nor guaranteed delivery). In particular the owned mirror (`OwnedAnalyticsMirror`)
**mints its own `event_occurrence_id`/`dedupe_key` per `enqueue()`** (OwnedAnalyticsMirror.ts:110-113)
and dedupes on *that* top-level id, not on our payload `eventId` — so a re-dispatch **will**
produce a duplicate mirror/provider row (correction 3). Our stable `eventId` travels as an
**allowed payload param** usable for *analysis/query-time* dedupe downstream, and this plan
claims nothing stronger. Tests assert
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
    State->>LS: TX IDENTITY + SNAPSHOT (checkpoint 0a, FIRST): persistActiveCompletionTransaction() ACTIVE_COMPLETION_TRANSACTION carrying completionStatsRegistered=true + completionProgressAfter{bestTimes,streakDays,streakLastDate,totalLevelsCompleted}<br/>(error-propagating; throw -> ABORT; flag+target durable together; runs for ALL completion facts)
    State->>LS: PROGRESSION (checkpoint 0pre, after 0a): persistCompletionProgress() BEST_TIMES/STREAK_DAYS/STREAK_LAST_DATE/TOTAL_LEVELS_COMPLETED<br/>(error-propagating; throw -> ABORT; a tear here is repaired on load from the tx's completionProgressAfter snapshot; runs for ALL completion facts incl. no-reward)
    State->>LS: BASELINE (checkpoint 0b): persistWallet() flush HINTS/COINS/WALLET_COUNTERS<br/>(error-propagating; throw -> ABORT, no achievement state); before = persisted baseline
    State->>State: build CommittedDelta: post-cap GrantedReward[]{achievementId,coins,hints};<br/>deltaToEvents -> full event list
    State->>State: WRITE-AHEAD (all in one record write): applyDeltaToRecord folds progress[id]+unlocked+masteredLevelIds+processed;<br/>analyticsOutbox += full events;<br/>pendingSettlement = {txId, before=baseline, after=before+post-cap reward};<br/>lastDurableRecord updated after this persist returns
    State->>LS: persist RECORD key (checkpoint 1 — commits occurrence + events + intent together)
    State->>State: WALLET: applyCoinGrant/applyHintGrant (shared primitives, not grantCoins) -> lands at after
    State->>LS: persistWallet() HINTS, COINS, WALLET_COUNTERS (3 keys, checkpoint 2)
    State->>State: FINALIZE: record.pendingSettlement = null
    State->>LS: persist RECORD key (checkpoint 3)
    State->>An: drainAnalyticsOutbox() [post-composition only, never in load()]: dispatchAchievementEvent(event) per entry (public exhaustive switch); remove eventId after handoff returns (not provider ack)
    State-->>GS: CompletionTransactionResult + achievementCommit: CommittedAchievementDelta (existing fields intact)
```

On relaunch at any checkpoint, `load()` inspects `pendingSettlement` (KTD2) and resolves
each wallet component (`coins`, `hints`, each `counters` field) **independently**
against its own `before`/`after`: a component still at `before` is assigned `after`, a
component already at `after` is left, a component matching neither is a per-component anomaly
handled by the mismatch policy. Because the wallet is three separate keys, a mixed tear
(e.g. COINS advanced, HINTS not) is resolved correctly rather than mis-read as corruption.
Re-applying the same `txId` is independently a no-op via `processedOccurrenceIds` (KTD3).
`load()` itself never dispatches (it may only append a reconciliation anomaly to
`analyticsOutbox`, correction 6); the post-composition `drainAnalyticsOutbox()`
(called by bootstrap after the real sinks compose) re-dispatches any event still in the outbox
from its stored payload and removes it once the local dispatch handoff returns (KTD6 — at the
dispatch boundary, not provider receipt; the owned mirror re-dedupes on its own id).
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
  **`timeSeconds` (GameState.ts:105)**, `newBest`, `previousBestSeconds`, provenance — but
  **not** `transactionId`, `progressionIndex`, `totalCompletions`, or `streakDays`, so the
  fact is **not** a drop-in copy of the transaction and any "zero adaptation" claim for
  *fact construction* was false and is removed. Instead U3 owns an explicit, tested
  **builder mapping** inside GameState's completion seam (which is the only site with the
  missing fields in scope):
  `transactionId ← transaction.id`, `levelId ← transaction.levelId`,
  `progressionIndex ← transaction.levelIndex`, `totalCompletions ← this._totalLevelsCompleted`
  (freshly incremented by `registerLevelComplete`, GameState.ts:806),
  `streakDays ← this.currentStreakDays()` (GameState.ts:823),
  **`timeSeconds ← transaction.timeSeconds`** (the source shape DOES carry `timeSeconds`,
  GameState.ts:105, so timing has a real source and the fact type-checks — fixes the
  red-team break that claimed timing had no source field),
  `previousBestSeconds ← transaction.previousBestSeconds`, `newBest ← transaction.newBest`,
  and provenance (`intendedLevelId`/`servedLevelId`/`sequenceVersion`/`fallbackReason`)
  copied from the transaction. `levelId` is retained on the fact so mastery ("N distinct
  levels with a best time") can identify the contributing level. The **source-shape fact**
  explicitly lists `timeSeconds`, and a U3 typecheck test asserts the builder maps
  `timeSeconds ← transaction.timeSeconds` against the real `CompletionTransaction`. The **zero-adaptation guarantee applies
  only to the UI card consuming the returned `CommittedAchievementDelta`**, not to GameState
  producing the fact — GameState is the producer and owns this documented builder + a U3 test
  asserting it type-checks against the real `CompletionTransaction`.
- **`CompletionTransaction` gains an optional recoverable progression snapshot (latest
  break #1).** Extend the existing `CompletionTransaction` interface (GameState.ts:101-120)
  **additively** with `completionProgressAfter?: { bestTimes: Record<string, number>;
  streakDays: number; streakLastDate: string | null; totalLevelsCompleted: number }` — the
  **absolute** post-`registerLevelComplete` progression state. It is set in memory alongside
  `completionStatsRegistered = true` and travels in the durably-persisted
  `ACTIVE_COMPLETION_TRANSACTION` (checkpoint 0a), so a tear between the transaction write and the
  separate progression keys is repaired on load by reconciling to this snapshot (KTD2 /
  U3). Optional so legacy/pre-migration serialized transactions without it retain existing
  `beginLevelCompletionTransaction` behavior unchanged. All existing `CompletionTransaction`
  fields keep their names/types/meaning; the additive field composes alongside them.
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
  each with optional `entitledReward`), masteredLevelIdsAdded: readonly string[] }`. The
  **`masteredLevelIdsAdded`** field (latest red-team break #1) makes the delta self-sufficient for
  record folding: `apply()` derives it from `fact.levelId`/`fact.newBest` against the record's
  `masteredLevelIds` (the level id iff this is a `newBest` completion of a not-yet-mastered level,
  else `[]`), so `applyDeltaToRecord` never needs the fact to update mastery. `CommittedAchievementDelta`
  (returned by GameState, consumed by UI/analytics) extends it with `rewards: readonly
  GrantedReward[]` (applied amounts, `achievementId`-tagged). This is the single owned consumer shape.
- `AchievementRecord` (versioned, the durable journal — one storage key): `{ version,
  progress: Record<id, number>, masteredLevelIds: readonly string[] (persisted distinct-level
  identity set — see below), unlocked: readonly id[], processedOccurrenceIds:
  readonly string[], pendingSettlement: { occurrenceId, before: SettlementSnapshot, after:
  SettlementSnapshot } | null (the single in-flight write-ahead settlement), analyticsOutbox:
  readonly PendingAnalyticsEvent[] (fully-formed events awaiting sink confirmation, each a
  member of the `PendingAnalyticsEvent` **discriminated union on `name`** — `{ eventId, name,
  payload }` pairing the literal name with its exact payload type (break #2) — with a stable
  deterministic `eventId`, appended in checkpoint 1
  — KTD6), nextAnalyticsEventSequence: number (a monotonic counter that mints a **durable,
  collision-free** id per emitted analytics event — replaces the prior bounded occurrence hash,
  latest break #3 — see KTD6/U6) }`, where `SettlementSnapshot = { coins: number, hints: number, counters:
  WalletCounters }` (reuses the existing `WalletCounters` interface exactly, GameState.ts:90-97)
  holds **absolute** wallet values whose components are resolved **independently** on recovery
  (the wallet persists as three separate keys — KTD2).
- **`masteredLevelIds` persists mastery identity (fixes the reload-double-count break):**
  distinct-level mastery progress is the size of this persisted set, not a raw numeric counter.
  A `newBest` completion of a not-yet-mastered level surfaces its level id via the delta's
  `masteredLevelIdsAdded` (derived by `apply()`, break #1), which `applyDeltaToRecord` folds into
  the set, so a *repeat* best time for an already-mastered level yields `masteredLevelIdsAdded: []`
  and does **not** re-increment mastery after a serialize/reload —
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
  catalog `order`, attaches each newly-unlocked entry's catalog `entitledReward`
  (requested amount only — the post-cap applied `GrantedReward` is GameState's job, KTD1), and
  **derives `masteredLevelIdsAdded`** (latest break #1) from `fact.levelId`/`fact.newBest` against
  the record's `masteredLevelIds` — the contributing level id iff `newBest` and not already
  mastered, else `[]`. Pure, deterministic, no I/O; mastery progress is derived from the record's
  persisted `masteredLevelIds` set passed in, never a bare counter.
- **Pure `applyDeltaToRecord(record, delta): AchievementRecord` (correction 3)** lives here too
  (owned, pure): it folds every `progressChanges` entry into `progress[id]`, adds `newlyUnlocked`
  ids to `unlocked`, adds **`delta.masteredLevelIdsAdded`** to `masteredLevelIds` (no fact
  dependency — break #1), and appends the occurrence to `processedOccurrenceIds` — one derived
  next-record value GameState/migration persist. It never touches
  `pendingSettlement`/`analyticsOutbox`/wallet (those are GameState's).
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
- **`applyDeltaToRecord` folds progress (correction 3).** Given a record and a below-threshold
  delta, the returned record's `progress[id]` equals the delta's new value, `unlocked`/
  `masteredLevelIds`/`processedOccurrenceIds` advance for crossings, and the input record is not
  mutated (pure). Feeding that returned record back into `apply()` continues from the folded
  progress.
- **Mastery additions ride on the delta, not the fact (latest break #1).** `apply()` of a
  `newBest` completion for a not-yet-mastered level returns `masteredLevelIdsAdded: [levelId]`;
  `applyDeltaToRecord` folds that into `masteredLevelIds` **using only the delta** (no fact
  argument). A **repeat** `newBest` for an already-mastered level returns
  `masteredLevelIdsAdded: []`, so folding does not re-increment mastery — proven without reference
  to `fact.levelId` inside `applyDeltaToRecord`.

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
  no-pending steady state, but the settlement protocol drives its **own ordered durable
  persist checkpoints** (baseline 0, write-ahead 1, wallet 2, finalize 3 — see below) because
  the baseline must be durable *before* `before` is captured and finalize must be durable
  *after* the wallet write — a single `save()` pass cannot express that ordering.
- **Add `'achievement'` to the `WalletMutationSource` union** (GameState.ts:80-88) so the
  reward calls type-check — the union is closed and rejects an unknown source today.
- **Extract shared non-persisting economy primitives (correction 2).** The public
  `grantCoins`/`grantHints` (GameState.ts:467-501) mutate then call the broad,
  exception-swallowing `save()` — calling them inside a checkpoint would re-tear the wallet
  outside the write-ahead discipline. `applyHintGrant` (GameState.ts:485-493) is **already**
  the non-persisting hint primitive (validate, cap, increment `_hintBalance` +
  `_walletCounters.hintsGranted`, return applied). Add the symmetric
  `applyCoinGrant(amount, source): number` (validate, increment `_coinBalance` +
  `_walletCounters.coinsGranted`, no `save()`); refactor `grantCoins` to call it then `save()`
  so the public path and the achievement path share one mutation semantics. Achievement
  checkpoint 2 calls `applyCoinGrant(coins, 'achievement')` / `applyHintGrant(hints, …)` then
  the strict `persistWallet()` — never `grantCoins`/`grantHints`. A U3 test asserts a completed
  achievement reward moves `_coinBalance`/`_hintBalance` and advances only
  `coinsGranted`/`hintsGranted` under the `'achievement'` source with zero type errors, and that
  the public `grantCoins` still behaves identically after the refactor.
- Four targeted persist helpers so each checkpoint is a minimal atomic write:
  `persistCompletionProgress()` (the `BEST_TIMES`/`STREAK_DAYS`/`STREAK_LAST_DATE`/
  `TOTAL_LEVELS_COMPLETED` keys from memory — the checkpoint-0pre progression write, run **after**
  0a so a tear is repaired from the transaction's durable snapshot, break #1),
  `persistActiveCompletionTransaction()` (single `setItem` of `ACTIVE_COMPLETION_TRANSACTION`
  carrying `transaction.id` **and** the `completionProgressAfter` snapshot — the checkpoint-0a
  identity+snapshot write run FIRST, break #1),
  `persistAchievementRecord()` (single `setItem` of `ftd_achievements`) and
  `persistWallet()` (the HINTS/COINS/WALLET_COUNTERS keys — three separate `setItem`s that
  can each land or tear independently). **All four helpers must let a `setItem` throw propagate to
  the caller — they deliberately do NOT inherit `save()`'s catch-and-continue behavior**
  (GameState.ts:897-926 swallows/continues). This is load-bearing: the write-ahead protocol
  branches on whether each checkpoint's write actually committed, so a silently-swallowed throw
  would let the protocol advance to the wallet while believing the record was persisted. Add a
  code comment on each helper stating this failure-propagation contract and the checkpoint
  ordering invariant so a future refactor can't re-wrap them in `save()`'s try/catch.
- **Checkpoint 0a strictly persists the transaction identity + progression snapshot FIRST
  (break #1).** For a completion fact, before any progression/wallet/record state,
  `applyAchievementFact` (invoked from the completion seam) sets `completionStatsRegistered = true`
  and `completionProgressAfter` (absolute post-register bestTimes/streakDays/streakLastDate/
  totalLevelsCompleted) on the transaction in memory, then calls
  `persistActiveCompletionTransaction()` to durably flush the accepted
  `ACTIVE_COMPLETION_TRANSACTION`, confirming its `id` **and** snapshot are stored; if it **throws,
  abort** before any progression/wallet/record/outbox state — so no achievement occurrence can
  commit under a non-durably-recoverable id, and no progression is left advanced without its guard.
  `load()`'s existing `sequenceFromCompletionId` max logic (GameState.ts:965-968) handles sequence
  recovery. Dog-found facts skip 0a (no transaction; occurrence id derives from durable level/dog
  state).
- **Checkpoint 0pre strictly persists completion progression (after 0a, break #1).** For **every**
  completion fact (reward or progress-only), after the transaction+snapshot write
  `applyAchievementFact` calls `persistCompletionProgress()` to durably flush
  `BEST_TIMES`/`STREAK_DAYS`/`STREAK_LAST_DATE`/`TOTAL_LEVELS_COMPLETED` from memory; if it
  **throws, abort** before any wallet/record/outbox state. Because 0a landed the flag and the exact
  target snapshot together, a tear here is repaired on load: `load()` reconciles progression to the
  transaction's `completionProgressAfter` (below) before any new fact — so a reload never sees
  advanced progression with an absent guard (the prior progression-first order's break) nor a true
  flag over stale progression. Dog-found facts skip 0pre.
- **Load-time progression reconciliation (break #1).** In `load()`, after keys parse and before
  `beginLevelCompletionTransaction`/`applyAchievementFact`, if the active transaction has
  `completionStatsRegistered === true` **and** a `completionProgressAfter` snapshot, reconcile
  `_bestTimes`/`_streakDays`/`_streakLastDate`/`_totalLevelsCompleted` to it and **strict-persist**
  them (`persistCompletionProgress()`), then continue. Transactions without a snapshot
  (legacy) keep existing behavior unchanged.
- **Checkpoint 0b uses `persistWallet()` as the baseline write.** Before any achievement state
  is written, `applyAchievementFact` calls `persistWallet()` to durably flush the current
  in-memory wallet; on success it captures `before` from that just-persisted state, so
  stored-wallet == `before` even if an earlier broad `save()` in the same completion had torn
  (break #4). If checkpoint 0b throws, the method **aborts before touching the record** (nothing
  durable about the achievement written; fact stays unprocessed for a clean retry).
- New GameState method `applyAchievementFact(fact)`:
  0. **`recoverPendingSettlement()` FIRST — before the processed guard (latest break #2).** If a
     prior in-process checkpoint-3 throw left `{ processed occurrence, pendingSettlement }` durable,
     the wallet is already at `after` but the settlement is not finalized. Running the
     `processedOccurrenceIds` guard first would return an empty delta for the *next* fact while the
     pending settlement is never finalized (and a same-process retry of the same occurrence returns
     empty before recovery could run). So `applyAchievementFact` calls `recoverPendingSettlement()`
     at entry: it finalizes any durable pending settlement (component-wise `before`/`after`, clears
     pending — no reapply since the wallet is already at `after`), **then** the method proceeds to
     the processed guard. This is the same idempotent recovery `load()` runs; calling it at entry
     makes the in-process retry path safe without a reload. (No-op when `pendingSettlement` is null.)
  1. Guard on `processedOccurrenceIds` — already processed → return empty delta, no-op.
  2. **Occurrence-durability gate for completion facts (break #3).** For a
     `LevelCompletionFact` — **regardless of whether a reward is later granted** — first run
     **checkpoint 0a (`persistActiveCompletionTransaction()`, carrying `completionStatsRegistered`
     + `completionProgressAfter` snapshot)** then **checkpoint 0pre (`persistCompletionProgress()`)**;
     if either throws, **abort** with no achievement state written. This makes the completion
     transaction id (the dedupe occurrence id) and its guarded progression snapshot durable
     before **any** completion achievement commits — including a progress-only/no-reward delta —
     so a crash after a prior torn broad `save()` cannot reload without the id, mint a new one on
     retry, and bypass `processedOccurrenceIds` dedupe. Dog-found facts skip 0a/0pre (their
     occurrence id `dog:<servedLevelId>:<dogId>` derives from already-durable level/dog state).
     Then call `AchievementSystem.apply(fact, record)`. If the delta grants no reward
     (progress-only / no-wallet path, including a `newBest` that only updates
     `masteredLevelIds`), fold the delta into the record via the pure
     `applyDeltaToRecord(record, delta)` (correction 3 — updates `progress[id]` for every
     `progressChanges` entry, adds unlocks, folds `delta.masteredLevelIdsAdded` into
     `masteredLevelIds` (break #1), marks processed),
     **append its `deltaToEvents` output to `analyticsOutbox`**, and persist the record once
     (no `pendingSettlement`, no wallet touch) — the events are still journaled durably, and the
     occurrence is already durable via 0pre/0a above. If it
     grants a reward, run the write-ahead protocol (0pre/0a already done above; continue with the
     wallet baseline 0b):
     - (**Checkpoints 0pre + 0a already ran in step 2** for completion facts — completion
       progression and transaction identity are durable; dog-found facts had neither. The reward
       branch continues at the wallet baseline.)
     - **Checkpoint 0b (baseline).** Call `persistWallet()` to durably flush the current
       in-memory wallet; if it **throws, abort** — return without marking the occurrence,
       appending the outbox, or writing `pendingSettlement` (no achievement state committed).
       On success, capture `before = settlementSnapshot()` from that just-persisted baseline.
     - **Compute the post-cap reward first.** Coins are uncapped; hints are capped to
       `MAX_HINT_BALANCE - _hintBalance` room (mirroring `applyHintGrant`, GameState.ts:485-493).
       Set the delta's `GrantedReward.hints` to the **actually applied** amount (may be < the
       catalog reward or 0 at a full wallet) so the delta the caller/analytics sees is honest.
     - **Build the committed delta + events first.** Wrap the pure delta into a
       `CommittedAchievementDelta` whose `rewards` carry `{ achievementId, coins, hints }`
       with the post-cap applied amounts; run `deltaToEvents` to get the full event list.
     - **Checkpoint 1 (single record write commits everything recoverable):** fold the delta
       into the record via `applyDeltaToRecord` (correction 3 — `progress[id]` for every
       `progressChanges` entry, unlocks, and `delta.masteredLevelIdsAdded` folded into
       `masteredLevelIds` (break #1 — the mastery additions are derived onto the delta by
       `apply()`, so no `fact` reference is needed here), occurrence marked processed),
       **append the full event list to `analyticsOutbox`**,
       and set `pendingSettlement = { occurrenceId, before = the checkpoint-0 baseline, after =
       before + post-cap reward }`; `persistAchievementRecord()`. (`settlementSnapshot()` is a
       narrow helper returning `{ coins: _coinBalance, hints: _hintBalance, counters:
       { ..._walletCounters } }` — reusing `WalletCounters`, not the rich `WalletSnapshot`.)
     - **Checkpoint 2:** apply the reward via the shared primitives
       `applyCoinGrant(coins, 'achievement')` / `applyHintGrant(hints, …)` (never the
       broad-saving `grantCoins`/`grantHints`), landing the wallet at `after` by construction;
       then `persistWallet()`.
     - **Checkpoint 3:** `pendingSettlement = null`; `persistAchievementRecord()`.
  On a **record-write throw**, roll the in-memory `_achievementRecord` back to the tracked
  `lastDurableRecord` snapshot (corrections 4 + 8): a **checkpoint-1** throw restores the
  **pre-transaction** record (occurrence unprocessed → in-process retry re-derives and grants
  once); a **checkpoint-3** throw restores the **post-checkpoint-1 pending** record (occurrence
  **processed**, `pendingSettlement` present → the retry runs `recoverPendingSettlement()` first,
  finalizes at `after` with no reapply, then applies the new fact) — **never** rolling a
  checkpoint-3 failure back past the durable checkpoints 1/2 (which would re-baseline the
  already-rewarded wallet and double-grant).
  3. Return the `CommittedAchievementDelta`. `applyAchievementFact` returns it directly (the
     dog-found seam consumes it as-is); the completion seam attaches it to the existing
     `CompletionTransactionResult` as the new optional `achievementCommit` field (break #1 —
     never replacing the result). The whole method is synchronous with no `await`/callback
     between checkpoints, guaranteeing no player mutation interleaves.
- New `recoverPendingSettlement()` runs in `load()` after all keys parse: implements the
  KTD2 **component-by-component** `before`/`after`/mismatch resolution (each of `coins`,
  `hints`, and every `counters` field resolved against its own snapshot values) and is
  the only place load mutates the wallet. On a component mismatch it **appends** a fully-formed
  `achievement_reconciliation_anomaly` event to `analyticsOutbox` (correction 6) so the
  post-composition drain dispatches it. **Ordering (correction 6):** while
  `pendingSettlement` is still durable, resolve the wallet in memory, then **strict-persist the
  repaired wallet via `persistWallet()`**, and **only then** clear `pendingSettlement` and
  `persistAchievementRecord()` — so a second fresh `load()` can never read a torn wallet with no
  pending intent and lose the grant. If the wallet persist tears, pending survives for the next
  load; if the final record persist tears, the next load sees wallet `== after` + pending and
  finalizes with no reapply. It is idempotent — a second `load()` after both writes sees
  `pendingSettlement == null` and does nothing.
- **`load()` does NOT dispatch analytics (correction 1).** `load()` never hands an event to a
  sink; it only recovers wallet/settlement and (on a mismatch) **appends** a reconciliation-anomaly
  event to `analyticsOutbox` for later drain (correction 6) — it does not *dispatch* it. A separate
  explicit
  `drainAnalyticsOutbox()` (below) is called by the bootstrap/`SdkContext` seam **after** the
  real `AnalyticsService` sinks are composed — because the `GameState` singleton `load()`s
  before analytics composition, and the pre-composition SDK has `sinks: []`, so a load-time
  drain would silently discard events (KTD6).
- New `drainAnalyticsOutbox()`: the **only** dispatch path. Invoked post-composition (both for
  freshly-committed events and for events recovered from a prior session's outbox). Hands each
  event to the local dispatch call and removes it from the outbox only after the `track` handoff
  returns without throwing; then persists the record (best-effort). Never called from `load()`.
- **Preserve the completion-reuse guard exactly — do NOT relax it (reverts prior narrowing
  per contract red-team).** `beginLevelCompletionTransaction`'s existing `canReuse` predicate
  (GameState.ts:646-650, `!transaction.advanced && transaction.levelId === input.levelId &&
  transaction.levelIndex === input.levelIndex`) is **left unchanged**. The prior draft dropped
  the `levelIndex` check to force cursor-drift retries onto one id, but that made a single
  transaction id span *multiple intentional same-level completions*, and achievement dedupe
  (keyed on transaction `id`) would then suppress a legitimate later completion's
  progress/reward. Correct model (KTD3): achievement dedupe is **per accepted completion
  transaction**, not per level lifetime. An interrupted completion's retry that reuses the same
  *unadvanced* transaction is one occurrence (granted once); a later intentional same-level
  completion is a new transaction id, a distinct occurrence that advances progress normally.
  No GameState code change is made to this guard.
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
clean-tear boundary (recovered, not lost, not doubled). Inject a throw at
**checkpoint 0a (transaction identity + snapshot)**,
**checkpoint 0pre (each progression key — BEST_TIMES, STREAK_DAYS, STREAK_LAST_DATE, TOTAL_LEVELS_COMPLETED)**,
**checkpoint 0b (baseline)** and at each of checkpoints 1–3, **and after each individual wallet key** (HINTS,
COINS, WALLET_COUNTERS) within both the checkpoint-0b baseline write and the checkpoint-2 wallet
write, so mixed per-key tears (e.g. COINS advanced but HINTS not) and a **pre-existing base-save
tear** (an earlier `save()` left storage torn before settlement began) are exercised; assert
component-wise load-time recovery lands every wallet component at `after` exactly once, that
a checkpoint-0a, checkpoint-0pre, or checkpoint-0b throw leaves the fact **unprocessed** with no partial
achievement state, and that after a checkpoint-0a-then-0pre tear (transaction+snapshot durable,
progression keys torn) the reload **reconciles progression to the transaction's
`completionProgressAfter` snapshot** — never advanced progression under an absent guard nor a true
flag over stale stats.

**Test scenarios:**
- Covers AC3. Duplicate completion callback with same `transactionId` grants reward
  once; second call returns empty delta.
- Covers AC3. Reload GameState from persisted storage, re-apply same fact → no double
  grant, unlocked set unchanged.
- Covers AC3. Interrupted completion (transaction persisted, app "relaunched"
  mid-flow) then retried → single grant, single unlock.
- **Per-transaction dedupe, not per-level (break #2 — guard preserved).** (a) A duplicate
  completion callback on **one** transaction (same `transactionId`) is suppressed — the second
  apply returns an empty delta, no duplicate progress/unlock/reward. (b) A **later distinct**
  accepted completion of the **same level** (a new transaction with a new `id`) is a distinct
  occurrence that **advances achievement progress normally** (e.g. a second completion increments
  the completion-count achievement). Assert the existing `beginLevelCompletionTransaction` reuse
  guard is unchanged and existing stats/base-coin one-shot behavior still holds.
- **Checkpoint-0a transaction-identity + snapshot durability, transaction-first order (break #1).**
  Simulate a pre-existing base-save tear where `COINS` persisted but `ACTIVE_COMPLETION_TRANSACTION`
  did **not** (the real GameState.ts:911-before-919 ordering). (a) The strict
  `persistActiveCompletionTransaction()` re-writes the transaction — carrying `transaction.id`
  **and** the `completionProgressAfter` snapshot — durable before checkpoint 0pre/1; a crash+reload
  after the achievement commits then finds the same id and a duplicate completion callback
  **cannot re-grant** (dedupe holds). (b) Inject a throw **during** checkpoint-0a
  `persistActiveCompletionTransaction()`: the fact is **not** marked processed, no progression key /
  wallet baseline / `pendingSettlement` / outbox / unlock is written, and a subsequent retry grants
  exactly once (no achievement committed under a non-durable id, no progression advanced without its
  guard).
- **Checkpoint-0pre progression tear repaired from snapshot (break #1 — transaction-first proof).**
  (a) Inject a throw **between** checkpoint 0a and the end of checkpoint 0pre (transaction+snapshot
  durable, some/all of BEST_TIMES/STREAK_DAYS/STREAK_LAST_DATE/TOTAL_LEVELS_COMPLETED torn). On the
  next `load()`, the reconciliation step sees `completionStatsRegistered === true` +
  `completionProgressAfter` and **reconciles progression to the snapshot** and strict-persists it —
  so streak/best/total match the flag and a retry neither skips `registerLevelComplete` over stale
  stats **nor** re-registers advanced progression under an absent guard (the exact double-advance the
  prior progression-first order allowed). (b) Inject a throw **during** `persistCompletionProgress()`:
  the fact is **not** marked processed, no wallet/record state written; reload reconciles from the
  durable snapshot, and a retry converges to the snapshot exactly once.
- **No-reward completion occurrence durability (break #3).** A completion fact that only advances
  progress (crosses no reward threshold) still runs checkpoints 0pre + 0a. After a **pre-existing
  base-save tear** (COINS persisted, ACTIVE_COMPLETION_TRANSACTION did not), applying the
  progress-only fact re-persists the transaction id via 0a; a crash+reload then finds the **same**
  transaction id, and a duplicate completion callback is deduped (empty delta) — the no-reward path
  cannot mint a new id and double-count progress.
- **Checkpoint-0b baseline abort (break #4).** Inject a throw during the checkpoint-0b
  `persistWallet()` (including after only some wallet keys land). The fact is **not** marked
  processed, no `pendingSettlement`/outbox/unlock is written, and a subsequent reload+retry
  grants exactly once. With a **pre-existing base-save tear** (storage already torn before
  settlement), checkpoint 0b re-flushes memory so `before` == stored wallet, and later recovery
  is never a false corruption.
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
- **Same-process retry after a checkpoint-3 throw — recovery-first ordering (corrections 4 + latest
  break #2).** Inject a throw in the **finalize** `persistAchievementRecord()` (checkpoints 1 and 2
  durable). Rollback lands on the post-checkpoint-1 pending record (occurrence processed, pending
  present). **Retry the same fact in-process** (no reload): `applyAchievementFact` runs
  `recoverPendingSettlement()` **at entry, before the `processedOccurrenceIds` guard**, which finds
  the wallet `== after`, finalizes without reapply and clears pending; the reward is **not** doubled.
  Assert the ordering explicitly: a spy proves `recoverPendingSettlement()` is invoked before the
  processed-guard branch, so the pending settlement is finalized even though the occurrence is
  already processed (the guard-first order would have returned an empty delta and left pending
  unfinalized). Then apply a **next distinct fact** in-process and assert it, too, finalizes the
  prior pending first and grants once. Contrast with a checkpoint-1 throw retry, which grants exactly
  once (occurrence was rolled back to unprocessed).
- **Fault injection — crash before checkpoint 1.** Neither pending nor wallet persist;
  reload re-applies the fact cleanly, exactly once (occurrence not yet marked).
- **Mismatch policy + anomaly journaled (correction 6).** Corrupt one wallet component so it
  equals neither its `before` nor its `after` while `pendingSettlement` is present → recovery
  trusts that component as-is, **appends the `achievement_reconciliation_anomaly` event to
  `analyticsOutbox`**, persists the repaired wallet then the record, clears the pending marker,
  keeps the occurrence processed; no double grant, no crash. Assert a **pre-composition `load()`
  persists the anomaly in the outbox (dispatches nothing)** and a later
  `drainAnalyticsOutbox()` dispatches it exactly once.
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
- **Committed reward association (requested-vs-applied split + `achievementId` tagging).** A multi-unlock completion returns a
  `CommittedAchievementDelta` whose `rewards` each carry the earning `achievementId` and the
  **applied** (post-cap) amounts; an unlock with no catalog reward yields no `GrantedReward`.
- **Cumulative progress survives reload (correction 3).** Apply a below-threshold fact so
  `applyDeltaToRecord` writes `progress[id] = k`; persist, reload a fresh GameState, apply the
  next fact and assert progress continues from the persisted `k` (not a stale/zero base) and the
  threshold crosses at the right cumulative count.
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
- **Initialize/sanitize `nextAnalyticsEventSequence` (latest break #3).** A fresh migrated record
  sets it to `0`; an upgraded record with an absent/NaN/negative counter is repaired to one past the
  max sequence already present in any journaled `analyticsOutbox` entry (so a recovered outbox never
  re-mints a live analytics `event_id`). Migration itself emits **no** analytics events (correction
  7), so it never advances the counter for its own occurrence.
- **No retroactive reward (correction 7):** backfilled achievements are marked `unlocked`
  with progress set **and** recorded reward-settled/reward-ineligible — `migrate()` writes no
  `pendingSettlement`, mutates no wallet key, and emits no reward entitlement or reward
  analytics event. A later live fact for a migrated (already-unlocked) achievement cannot mint
  its catalog reward; only post-migration first-unlocks reward normally.
- Lifetime-dog, hintless, clean-run, replay stay unearned (no derivable source).
- Called from `load()` after all other keys parse, only when the record is absent or
  `version` is older. Because migration touches no wallet key, it needs none of the
  write-ahead settlement machinery — it is a pure record rebuild persisted once.

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
- **No retroactive reward (correction 7).** (a) Migration of a save with derivable
  completions marks the milestones `unlocked` with **zero** wallet/`_walletCounters` change and
  emits **no** reward event. (b) A subsequent live completion fact for an already-migrated
  achievement does **not** mint its catalog reward (already unlocked/settled). (c) A genuinely
  new post-migration achievement rewards normally through the write-ahead protocol.
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
`games/find_the_dog/src/analytics/GameAnalyticsEvents.ts`,
`games/find_the_dog/tests/unit/achievement-analytics.test.ts`,
`games/find_the_dog/tests/unit/purchase-funnel-analytics.test.ts` (extend the existing
primary-dimension superset gate to cover the achievement rows — break #4).

**Approach (compose the full typed stack — KTD6 breaks #1/#3):**
- **`FtdEvent` + service methods (AnalyticsService.ts).** Add `achievement_progress`,
  `achievement_unlocked`, `achievement_reward_granted`, `achievement_reconciliation_anomaly`,
  and the later-UI `achievement_page_viewed` / `achievement_viewed` to the `FtdEvent` union
  (AnalyticsService.ts:13-32) — required because `sdk` is `Analytics<FtdEvent>` and `sdk.track`
  only accepts union names. Add a typed params interface per event and a thin
  `analytics.achievement*` method for each (mirroring `dogFound`/`resourceChanged`,
  AnalyticsService.ts:297-345).
- **Canonical rows + allow-list (CanonicalAnalyticsEvents.ts).** Add a
  `CanonicalAnalyticsEventDefinition` per event with `id`, `firebaseName`, `gameAnalyticsName`
  (`achievement:progress`/`:unlocked`/`:reward:granted`/`:reconciliation:anomaly`),
  `family: 'design'`, panel, question, dimensions, **`instrumentationStatus`**,
  **`successBoundary`**, and an **`allowedGameAnalyticsCustomFields`**
  list of every dimension the wire must carry (`achievement_id`, `occurrence_id`, `event_id`,
  `category`, `progress`, `threshold`, `reward_coins`, `reward_hints`, and — on the
  `achievement:reconciliation:anomaly` row — **`wallet_component`**, break #3) —
  `compactCustomFields` drops any key not listed (GameAnalyticsEvents.ts:150-177).
  The `AchievementReconciliationAnomalyPayload` type carries a concrete
  `wallet_component: string` naming the torn component, and the anomaly canonical row lists it
  in `primaryDimensions` **and** `allowedGameAnalyticsCustomFields`, **and `wallet_component` is
  added to find_the_dog's `dashboardImportDimensionKeys`** (break #4 — the
  `purchase-funnel-analytics.test.ts` superset gate requires every `primaryDimension` to appear in
  that allowlist, else import rejects/drops the field); a U6 sink test dispatches
  a real anomaly event and asserts `wallet_component` survives `compactCustomFields`.
- **Design mapping (GameAnalyticsEvents.ts).** Add `achievement:progress`/`:unlocked`/
  `:reward:granted`/`:reconciliation:anomaly` **and the later-UI `achievement:viewed`/
  `achievement:page:viewed`** (correction 5) → their canonical ids in
  `canonicalEventIdForDesignEvent` (GameAnalyticsEvents.ts:190-200); without this the sink's
  fall-through `designEvent(...)` gets `canonicalEventId === null` and **zeroes `customFields`**,
  dropping every achievement field on the GameAnalytics wire. The page-view ids are mapped now
  (with canonical rows + allow-lists) even though ACH-2 emits them, so the contract is whole.
- Every payload carries a stable `eventId` for downstream dedupe (analytics is **at-least-once
  at the local dispatch boundary**, never promised sink-level or provider-level delivery — the
  sink swallows errors and returns `void`, GameAnalyticsSink.ts:72-76 — dedupe is the consumer's
  job on the `eventId`).
- `AchievementAnalytics.ts` owns `AchievementAnalyticsPayload` types, the
  **`PendingAnalyticsEvent` discriminated union (correction / break #2)** — one member per
  `AchievementEventName`, each pairing the literal `name` with its exact payload type and a
  common `eventId`, e.g. `{ eventId: string; name: 'achievement_progress'; payload:
  AchievementProgressPayload } | { eventId: string; name: 'achievement_unlocked'; payload:
  AchievementUnlockedPayload } | { eventId: string; name: 'achievement_reward_granted';
  payload: AchievementRewardGrantedPayload } | { eventId: string; name:
  'achievement_reconciliation_anomaly'; payload: AchievementReconciliationAnomalyPayload }`.
  Because `name` is the discriminant, `switch (event.name)` in `dispatchAchievementEvent`
  **narrows `event.payload`** to the exact per-event type, so each arm's typed
  `analytics.achievement*` call type-checks (a plain `{ name: union; payload: union }` shape
  would NOT narrow the independently-typed payload — the red-team break). It also owns a pure
  `deltaToEvents(committedDelta, record)` mapper that reads each `GrantedReward.achievementId` to
  associate reward events with their unlock and assigns each event a **durable sequence-backed**
  `eventId` (`ach:<sequence>:<eventKind>:<achievementId>`, drawing consecutive values from the
  record's monotonic `nextAnalyticsEventSequence` — latest break #3, replacing the collision-prone
  `shortHash(occurrenceId)`), returning both the events and the advanced counter so checkpoint 1
  persists the counter atomically with the outbox. Catalog achievement `id` length is asserted ≤ a
  fixed bound so every id is provably ≤96 chars (no `compactCustomFields` truncation) and unique by
  construction (no hash collision). The same value is written to both `eventId` and the payload's
  `event_id`. It is well-defined for multi-unlock deltas and unlocks without rewards. Add thin `analytics.achievement*` methods to `AnalyticsService`
  mirroring `dogFound`/`resourceChanged` (AnalyticsService.ts:297-345), **plus one public
  `dispatchAchievementEvent(event: PendingAnalyticsEvent)` with an exhaustive `never`-checked
  `switch` over the achievement event-name union** (correction 1) that routes each entry to its
  typed method — `GameState.drainAnalyticsOutbox()` calls only this, never the private `sdk` or a
  dynamic `analytics[name]`.
- The full event list is appended to `record.analyticsOutbox` and persisted **in checkpoint 1**
  (U3 / KTD6), i.e. in the same record write that first marks the occurrence processed — never
  after finalize. Emit via the explicit `drainAnalyticsOutbox()` method (U3): hand each event
  to the public `analytics.dispatchAchievementEvent(event)` (correction 1 — no private-`sdk`
  reach-in); remove that `eventId` from the outbox **only after that dispatch
  returns without throwing** (the observable dispatch boundary — not a provider ack,
  which the sink cannot give) and persist (best-effort).
  **`load()` never dispatches (correction 1):** the `GameState` singleton `load()`s before
  `getSdkContext()` composes the real sinks (pre-composition SDK is `sinks: []`), so load leaves
  `analyticsOutbox` intact and the bootstrap/`SdkContext` seam calls `drainAnalyticsOutbox()`
  **after** analytics is ready. That post-composition drain re-dispatches **from the stored
  payloads** any events left from a prior session (KTD6 emission recovery — persistence
  succeeded, dispatch handoff interrupted; one occurrence's multiple events are fully
  reconstructable because the payloads, not just the occurrence id, are durable), removing each
  once its handoff returns. **No wire/mirror dedupe is claimed (correction 3):** re-dispatch is
  at-least-once at the local boundary only; `OwnedAnalyticsMirror.enqueue` mints its own
  `event_occurrence_id`/`dedupe_key` per call (OwnedAnalyticsMirror.ts:110-113), so a
  re-dispatched event produces a duplicate mirror/provider row — our stable `eventId` rides as a
  payload param for analysis-time dedupe only. Page-view events are
  defined but emitted by the later UI card — this card only owns the contract.

**Test scenarios:**
- Covers AC7. `deltaToEvents` maps a multi-unlock delta to one event per unlock +
  one reward event per granted reward, in catalog order.
- Covers AC2/AC7. Zero-adaptation round-trip: payload built by the mapper is consumed
  by a consumer stub with no field renaming (contract-ownership proof).
- Covers AC3. Re-applied (already-processed) occurrence produces an empty delta →
  zero analytics events.
- **Load retains, explicit drain dispatches (correction 1).** An occurrence committed with a
  progress + two unlock + one reward event, with those events still in `analyticsOutbox`. A
  **pre-composition `load()` dispatches nothing and retains all four** (proving load can't
  silently discard events into an empty-sink SDK). Then, after composing a **fake sink**,
  `drainAnalyticsOutbox()` re-dispatches **all four** from their stored payloads exactly once and
  removes them; a second drain dispatches nothing. Asserts each carries its stable `eventId`.
  The test observes only which payloads reached the fake sink's dispatch boundary — **never**
  provider receipt (the real sink swallows errors and cannot ack), and it does **not** claim the
  owned mirror deduplicates on our `eventId` (correction 3 — the mirror mints its own id).
- **No false delivery claim.** A dispatch that throws at the `track` handoff leaves the
  `eventId` in `analyticsOutbox` for re-dispatch; the test asserts the event is retained, not
  that any provider received it.
- Canonical event definitions typecheck against `CanonicalAnalyticsEventDefinition`.
- **Primary-dimension superset holds (break #4).** The extended `purchase-funnel-analytics.test.ts`
  superset gate passes for the achievement rows — every achievement `primaryDimension` (including
  the anomaly row's `wallet_component`) is present in find_the_dog's `dashboardImportDimensionKeys`;
  a row whose `primaryDimensions` names a key missing from that allowlist fails the gate.
- **`sdk.track` composes (break #1).** A test constructs each `analytics.achievement*` call
  and asserts it type-checks against `Analytics<FtdEvent>` — i.e. the event name is in the
  `FtdEvent` union — proving canonical rows alone are insufficient.
- **Public dispatcher routes each event (correction 1).** `analytics.dispatchAchievementEvent`
  is called with each of the four achievement `PendingAnalyticsEvent` shapes and a fake sink
  observes the matching typed payload — proving `drainAnalyticsOutbox` needs no private-`sdk`
  or dynamic property access, and the `never`-exhaustive switch covers every emitted name.
- **Discriminated-union narrowing (break #2).** A compile-level test builds each
  `PendingAnalyticsEvent` member and asserts `switch (event.name)` narrows `event.payload` to the
  exact per-event payload type (each arm's typed `analytics.achievement*(event.payload)` call
  compiles); a mis-paired `{ name, payload }` is a type error. Proves the outbox union is
  discriminated, not a `{ name: union; payload: union }` that fails to narrow.
- **Anomaly `wallet_component` survives the wire (break #3).** Dispatch a real
  `achievement_reconciliation_anomaly` event whose payload names a torn `wallet_component`
  through the GameAnalytics sink; assert the resulting `designEvent.customFields` **contains**
  `wallet_component` (on the anomaly row's allow-list, not stripped by `compactCustomFields`).
- **GameAnalytics wire fields survive (break #3).** Dispatch a real `achievement_unlocked`,
  `achievement_progress`, and `achievement_reward_granted` event through the GameAnalytics sink
  path; assert the resulting `designEvent.customFields` **contains** `achievement_id`,
  `event_id`, `progress`/`threshold`, and applied `reward_coins`/`reward_hints` (not `{}`) —
  proving `canonicalEventIdForDesignEvent` resolves and the allow-list passes the fields.
- **Page-view ids mapped for ACH-2 (correction 5).** `canonicalEventIdForDesignEvent` resolves
  `achievement:viewed` and `achievement:page:viewed` to their canonical ids (not `null`), and
  dispatching a synthetic `achievement_viewed`/`achievement_page_viewed` design event through the
  sink yields non-empty `customFields` — proving the contract is whole even though this card does
  not emit them.
- **`event_id` survives compaction (correction 2).** A dispatched achievement event's
  `event_id` is present in the emitted `designEvent` after both `compactParams` and
  `compactCustomFields` (on the allow-list, not stripped).
- **Sequence-backed `event_id` is bounded, unique, and durable (latest break #3).** (a) Build
  events for the **known 32-bit collision pair** (`completion:2155:0:synthetic-level-2155` and
  `completion:11853:0:synthetic-level-11853`, which `shortHash` collides): the sequence-backed
  `event_id`s are **distinct** (proving the hash-collision hazard is gone). (b) Each derived
  `event_id` is **≤96 chars** so `compactCustomFields`'s slice is a no-op — the wire `event_id`
  equals the journaled `PendingAnalyticsEvent.eventId` byte-for-byte. (c) A **multi-event delta**
  (progress + two unlocks + one reward) mints four consecutive sequence ids and advances
  `nextAnalyticsEventSequence` by four in the same checkpoint-1 record. (d) A **checkpoint-1
  rollback** restores `nextAnalyticsEventSequence` with the record (no leaked/duplicated sequence
  after an in-process retry). (e) After **serialize/reload**, the next event's id continues from the
  persisted counter (never reuses a prior id), and a recovered non-empty `analyticsOutbox` is
  re-initialized to one past its max present sequence. (f) Catalog: every achievement `id` length is
  ≤ the asserted bound, so all ids are ≤96.
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
- **Over-dedupe suppressing a legitimate same-level completion.** The completion-reuse guard
  is **preserved unchanged** (not narrowed); achievement dedupe is per accepted completion
  transaction id, so a later intentional same-level completion is a distinct occurrence that
  advances progress; U3 duplicate-vs-distinct test.
- **Stored wallet already torn before settlement begins.** Checkpoint 0b durably re-flushes the
  in-memory wallet (error-propagating) and captures `before` from that persisted baseline, so
  recovery never mis-reads a pre-existing base-save tear as corruption; U3 checkpoint-0b baseline
  + pre-existing-tear fault tests.
- **Achievement committed under a non-durable completion transaction id (break #1).** The broad
  `save()` writes `COINS` before `ACTIVE_COMPLETION_TRANSACTION` and can tear between; a crash
  would reload without the id, mint a new one on retry, and bypass dedupe → double grant.
  Mitigated by the strict error-propagating `persistActiveCompletionTransaction()` at checkpoint
  0a — the transaction id is durable before any achievement/wallet checkpoint, or the fact
  aborts unprocessed; U3 checkpoint-0a durability + abort tests.
- **Outbox event/payload mismatch not caught by the compiler (break #2).** `PendingAnalyticsEvent`
  is a **discriminated union on `name`**, so `dispatchAchievementEvent`'s `switch` narrows
  `event.payload` and a mis-paired name/payload is a type error; U6 narrowing test.
- **Reconciliation anomaly's diagnostic component stripped on the wire (break #3).** The anomaly
  payload carries a concrete `wallet_component`; it is on the anomaly canonical row's
  `allowedGameAnalyticsCustomFields`, proven to survive `compactCustomFields`; U6 anomaly
  wire-survival test.
- **Achievement analytics dropped on the wire.** Composing only the FTD registry does not
  type-check `sdk.track` and leaves the GameAnalytics sink zeroing custom fields; U6 adds
  `FtdEvent` names + params methods, canonical rows with `allowedGameAnalyticsCustomFields`, and
  the `canonicalEventIdForDesignEvent` mapping, with a sink test proving fields survive.
- **Settlement helpers swallowing a write failure.** `persistAchievementRecord()`/
  `persistWallet()` propagate throws (no `save()`-style catch-and-continue), so the protocol
  never advances on a failed checkpoint; asserted by the fault-injection tests.
- **False analytics-delivery claim.** Durability is scoped to the local dispatch-call boundary
  (the sink swallows errors, gives no ack); tests assert only which payloads reached a fake
  sink, never provider receipt. The owned mirror re-dedupes on its own id, so re-dispatch may
  duplicate downstream; our `eventId` supports analysis-time dedupe only (correction 3).
- **Load-time drain into an empty-sink SDK.** `GameState.load()` runs before analytics is
  composed; it never dispatches. An explicit `drainAnalyticsOutbox()` runs only post-composition
  (correction 1); U6 pre/post-composition test proves it.
- **Repaired wallet not persisted on recovery.** Recovery strict-persists the resolved wallet
  **before** clearing `pendingSettlement`, so a second fresh load can't lose the grant
  (correction 6); U3 second-load test proves it.
- **Broad-saving wallet methods inside a checkpoint.** Checkpoints use the non-persisting
  `applyCoinGrant`/`applyHintGrant` primitives + strict `persistWallet()`, never
  `grantCoins`/`grantHints` (which call `save()`); shared mutation semantics preserved
  (correction 2).
- **Same-process retry falsely deduped or double-granted after a record-write throw.** Rollback
  restores the **actual** last durable record: a checkpoint-1 throw → pre-transaction (retry
  grants once); a checkpoint-3 throw → post-checkpoint-1 pending (occurrence stays processed,
  recovery finalizes, retry does **not** double-grant) — never rolling a checkpoint-3 failure past
  the durable wallet write (corrections 4 + 8); U3 checkpoint-1 and checkpoint-3 same-process retry
  tests.
- **`apply()` progress deltas never reach the persisted map.** A pure `applyDeltaToRecord` folds
  every `progressChanges` entry into `record.progress[id]` (with unlocks/mastery/processed)
  together, so cumulative progress survives serialize/reload and the next fact continues from it
  (correction 3); U2 pure fold test + U3 reload-continuity test.
- **`event_id` stripped by field compaction.** Every payload/wire field is snake_case `event_id`
  on the canonical `allowedGameAnalyticsCustomFields`, proven to survive `compactParams` +
  `compactCustomFields` (correction 2); U6 survival test.
- **Dynamic private-`sdk` dispatch does not type-check.** A public
  `dispatchAchievementEvent(PendingAnalyticsEvent)` with a `never`-exhaustive switch is the only
  drain path — no `analytics[name]` / `sdk` reach-in (correction 1); U6 dispatcher-routing test.
- **ACH-2 page-view events would drop their fields.** `achievement:viewed`/`achievement:page:viewed`
  are mapped in `canonicalEventIdForDesignEvent` with canonical rows + allow-lists now, even though
  ACH-2 emits them (correction 5); U6 page-view mapping test.
- **Reconciliation anomaly never dispatched.** Recovery **appends** the anomaly event to
  `analyticsOutbox` (not a fire-and-drop emit) before persisting the record, so the
  post-composition drain dispatches it (correction 6); U3 mismatch → pre-composition-persist +
  post-composition-drain test.
- **Mastery fold needs a fact the delta doesn't carry (latest break #1).** `apply()` derives
  `masteredLevelIdsAdded` onto the delta from `fact.levelId`/`fact.newBest`, and
  `applyDeltaToRecord` folds that field with no fact dependency; U2 delta-driven repeat-best test.
- **True `completionStatsRegistered` flag over stale progression (latest break #2).** A new
  error-propagating `persistCompletionProgress()` (checkpoint 0pre) strictly persists
  BEST_TIMES/STREAK_DAYS/STREAK_LAST_DATE/TOTAL_LEVELS_COMPLETED before the transaction identity
  write, so a reload never sees the true flag over stale stats; U3 per-progression-key fault tests.
- **Progress-only completion re-mints its transaction id (latest break #3).** Checkpoints 0pre/0a
  run for **every** `LevelCompletionFact` (not just reward-granting ones), so a no-reward
  completion's occurrence id is durable before its record commit; U3 no-reward torn-save dedupe test.
- **Anomaly `wallet_component` rejected by dashboard import (latest break #4).** `wallet_component`
  is added to find_the_dog's `dashboardImportDimensionKeys`, satisfying the
  `purchase-funnel-analytics.test.ts` primary-dimension superset gate; U6 extended superset test.
- **`event_id` truncates/collides on the wire (latest break #3).** `deltaToEvents` mints each
  `event_id` from the record's durable monotonic `nextAnalyticsEventSequence`
  (`ach:<sequence>:<eventKind>:<achievementId>`) — no hash, so no 32-bit collision — advancing the
  counter atomically with the outbox in checkpoint 1; catalog achievement `id` length is asserted so
  every id is ≤96 chars, `compactCustomFields`'s slice never changes it, and rollback/reload/migration
  preserve counter uniqueness; U6 collision-pair/multi-event/rollback/reload id test.

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
   fault-injected torn writes at the **checkpoint-0pre completion-progression write** (each of
   BEST_TIMES/STREAK_DAYS/STREAK_LAST_DATE/TOTAL_LEVELS_COMPLETED — so a true
   `completionStatsRegistered` flag never sits over stale progression), the **checkpoint-0a
   transaction-identity write** (running for **every** completion fact incl. progress-only/no-reward
   so a no-reward completion cannot re-mint its id), the
   **checkpoint-0b wallet baseline**, and every later settlement
   checkpoint **and after every individual wallet key** (transaction id durable before any
   achievement commit so a crash cannot re-mint an id and double-grant; grant recovered
   component-by-component, never lost on a clean tear or a pre-existing base-save tear, never
   double-granted; corruption mismatch handled per component; a checkpoint-0a/0b throw aborts
   with no partial achievement state), hint-cap settlement, interrupted completion/retry,
   the documented `LevelCompletionFact` builder mapping incl. `timeSeconds ←
   transaction.timeSeconds` (break #4), fallback serving, multi-event
   analytics emission recovery from a durable outbox (journaled in checkpoint 1, before the
   wallet write), persisted distinct-level mastery that does not re-increment on reload (folded
   from the delta's own `masteredLevelIdsAdded`, break #1 — no hidden fact dependency in
   `applyDeltaToRecord`),
   committed `achievementId`-tagged post-cap
   rewards, the additive `CompletionTransactionResult.achievementCommit` field (existing consumer
   fields intact), the **preserved (un-narrowed) completion-reuse guard** with per-transaction
   (not per-level) dedupe proven by a duplicate-vs-distinct test, the **four-seam analytics
   composition** (`FtdEvent` names, canonical allow-list, design-event mapping, sink
   field-survival), the settlement helpers **propagating** write failure, and write-ahead
   settlement recovery all have passing deterministic tests (AC8).
3. Rewards are coins/hints only, modest and asserted-bounded; hint grants respect
   `MAX_HINT_BALANCE` with the applied amount recorded; achievement settlement advances only
   `coinsGranted`/`hintsGranted` (never the `levelCompleteCoinGrants`/`rewardedHintGrants`
   occurrence counts); `'achievement'` is added to `WalletMutationSource` and the real wallet
   methods compose; no dependency added (AC6).
4. Analytics contract emits progress/unlock/reward once-per-occurrence (stable
   snake_case `event_id` per event — `ach:<sequence>:<eventKind>:<achievementId>` minted from the
   record's durable monotonic `nextAnalyticsEventSequence` (latest break #3), no hash so no
   collision, catalog id length asserted so every id is ≤96 chars and never truncates through
   `compactCustomFields`'s slice — proven to survive `compactParams`/`compactCustomFields`,
   stay distinct across the known 32-bit collision pair, and preserve counter uniqueness across
   rollback/reload/migration, durable outbox for recovery), **composes through the whole typed stack** — achievement
   names in the `FtdEvent` union + typed `analytics.achievement*` methods **and one public
   `dispatchAchievementEvent` exhaustive-switch dispatcher over the discriminated-union
   `PendingAnalyticsEvent` (narrows payload per `name`, break #2)** (no private-`sdk`/dynamic
   access) so `sdk.track` type-checks and drain routes safely, canonical rows with
   `allowedGameAnalyticsCustomFields` (incl. the anomaly's `wallet_component`, break #3, which is
   also added to find_the_dog's `dashboardImportDimensionKeys` to satisfy the primary-dimension
   superset gate, latest break #4), and the
   `canonicalEventIdForDesignEvent` mapping (including
   the later-UI `achievement:viewed`/`achievement:page:viewed` ids) so the GameAnalytics sink
   carries (not drops) `achievement_id`/`event_id`/`progress`/`threshold`/applied reward fields —
   recovery-time reconciliation anomalies are **journaled into the outbox** and drained
   post-composition, scopes its guarantee to the local dispatch-call boundary (no false
   provider-delivery claim; sink swallows errors), and never mutates state (AC7).
5. All four gate commands pass; the diff stays within the scope fence and preserves
   the unrelated dirty evidence changes on main.
