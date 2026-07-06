import { test, expect } from '@playwright/test';
import { mulberry32 } from '@fabrikav2/kernel';
import {
  gotoAndWaitForHarness,
  callHarness,
  readHarness,
  pollHarness,
} from '@fabrikav2/testkit/playwright';

/**
 * SEEDED CHAOS e2e — drive N random LEGAL + ILLEGAL game verbs through the typed
 * GameHarness `verbs` map and assert snapshot invariants after EVERY step. This
 * is the assertion that makes chaos more than a crash-hunt: coins may only move
 * when a matching economy event was emitted (the `drainEvents()` oracle).
 *
 * Reproducible by seed (card AC): the RNG lives HERE in the test process
 * (`mulberry32(SEED)`), and every random choice — which verb, which marble
 * (the `roll` passed to the verb) — is derived from it, so a red run replays
 * byte-identically with `CHAOS_SEED=<n>`. The seed + failing step index ride on
 * every assertion message.
 *
 * The harness reader/action fns are `.toString()`-serialized and rebuilt in the
 * browser, so they must be self-contained (no closure captures) — state is
 * passed via the `arg`.
 */

const WINDOW_KEY = '__MARBLE_RUN_HARNESS__';
const SEED = Number(process.env.CHAOS_SEED ?? 20260706);
const STEPS = Number(process.env.CHAOS_STEPS ?? 40);

/** Economy event names that legitimise a coin delta (the conservation oracle). */
const ECONOMY_EVENTS = ['resource_change', 'purchase'];

interface Snapshot {
  scene: string;
  status: string;
  hearts: number | null;
  coins: number;
  inputReady: boolean;
  animating: boolean;
}

interface Harness {
  gotoState(state: string): void;
  startLevel(id: number): void;
  unlockAll(): void;
  showHint(): void;
  snapshot(): Snapshot;
  drainEvents(): ReadonlyArray<{ name: string }>;
  verbs: Record<string, { run(roll?: number): unknown }>;
}

/** The weighted action deck. Legal progress moves dominate so the run actually
 *  advances; the adversarial `tapBlockedMarble` and a navigation move are mixed
 *  in to probe illegal input and state churn. */
type Action =
  | { kind: 'verb'; name: string }
  | { kind: 'legacy'; name: 'showHint' }
  | { kind: 'nav' };

const DECK: Action[] = [
  { kind: 'verb', name: 'tapUnlockedMarble' },
  { kind: 'verb', name: 'tapUnlockedMarble' },
  { kind: 'verb', name: 'tapUnlockedMarble' },
  { kind: 'verb', name: 'tapBlockedMarble' },
  { kind: 'legacy', name: 'showHint' },
  { kind: 'nav' },
];

test.describe('marble_run — seeded chaos (invariants under random legal+illegal input)', () => {
  test(`survives ${STEPS} random verbs with invariants intact (seed ${SEED})`, async ({ page }) => {
    console.log(`[chaos] seed=${SEED} steps=${STEPS}`);
    const rng = mulberry32(SEED);

    await gotoAndWaitForHarness<Harness>(page, '/', {
      windowKey: WINDOW_KEY,
      readyCheck: (h) => typeof h.startLevel === 'function' && typeof h.verbs === 'object',
    });

    await callHarness<Harness, null, void>(page, WINDOW_KEY, (h) => h.unlockAll(), null);
    await enterLevel(page, 1);

    // Cumulative conservation oracle: each observed coin CHANGE must be covered
    // by an economy event somewhere in the run. Counting cumulatively (not
    // per-step) is robust to the async win, where the reward event and the coin
    // delta can land in adjacent steps.
    let prevCoins = (await snapshot(page)).coins;
    let coinChanges = 0;
    let economyCount = 0;

    for (let step = 0; step < STEPS; step += 1) {
      const where = `seed=${SEED} step=${step}`;
      let snap = await snapshot(page);

      // If we drifted out of the level (won/failed/paused), re-enter so marble
      // verbs stay meaningful — this also exercises the level lifecycle whose win
      // path emits the reward economy event.
      if (snap.scene !== 'playing') {
        await enterLevel(page, 1);
      } else {
        const action = DECK[Math.floor(rng() * DECK.length)]!;
        const roll = rng();
        await applyAction(page, action, roll);
      }

      // inputReady must RECOVER after any transient animating window — the game
      // never wedges. Bounded poll; a stuck input surfaces as a timeout here.
      snap = await pollHarness<Harness, Snapshot>(
        page,
        WINDOW_KEY,
        (h) => h.snapshot(),
        (v) => v.inputReady === true,
        8000,
      );

      // Drain this step's events (cumulative economy tally for the oracle).
      const drained = await callHarness<Harness, null, ReadonlyArray<{ name: string }>>(
        page,
        WINDOW_KEY,
        (h) => h.drainEvents(),
        null,
      );
      economyCount += drained.filter((e) => ECONOMY_EVENTS.includes(e.name)).length;

      // INVARIANT 1 — hearts never negative (null between levels is fine).
      expect(snap.hearts === null || snap.hearts >= 0, `hearts negative (${where}): ${snap.hearts}`).toBe(true);

      // INVARIANT 2 — coins conserved except through an economy event: every
      // coin change so far must be covered by an economy event so far.
      if (snap.coins !== prevCoins) coinChanges += 1;
      expect(
        economyCount >= coinChanges,
        `coins changed ${coinChanges}× but only ${economyCount} economy events emitted (last ${prevCoins}→${snap.coins}, ${where})`,
      ).toBe(true);
      prevCoins = snap.coins;

      // INVARIANT 3 — no crash: the harness is still callable (snapshot resolved
      // above; an unhandled crash would have rejected the evaluate).
    }
  });
});

async function snapshot(page: import('@playwright/test').Page): Promise<Snapshot> {
  return readHarness<Harness, Snapshot>(page, WINDOW_KEY, (h) => h.snapshot());
}

async function enterLevel(page: import('@playwright/test').Page, id: number): Promise<void> {
  // Always route through the menu first: `start` is only reachable from menu, so
  // re-entering from a terminal (complete/failed) or paused state must bounce
  // through HomeMenu or the flow machine rejects the transition.
  await callHarness<Harness, number, void>(
    page,
    WINDOW_KEY,
    (h, levelId) => {
      h.gotoState('HomeMenu');
      h.startLevel(levelId);
    },
    id,
  );
  await pollHarness<Harness, { scene: string; inputReady: boolean }>(
    page,
    WINDOW_KEY,
    (h) => {
      const s = h.snapshot();
      return { scene: s.scene, inputReady: s.inputReady };
    },
    (v) => v.scene === 'playing' && v.inputReady === true,
    10_000,
  );
}

async function applyAction(
  page: import('@playwright/test').Page,
  action: Action,
  roll: number,
): Promise<void> {
  await callHarness<Harness, { action: Action; roll: number }, void>(
    page,
    WINDOW_KEY,
    (h, a) => {
      if (a.action.kind === 'verb') {
        h.verbs[a.action.name]?.run(a.roll);
      } else if (a.action.kind === 'legacy') {
        h.showHint();
      } else {
        // Navigation churn: bounce to pause and back to probe state transitions.
        h.gotoState('PauseOverlay');
        h.gotoState('HomeMenu');
      }
    },
    { action, roll },
  );
  // Let animations / deferred win resolution advance a beat.
  await page.waitForTimeout(120);
}
