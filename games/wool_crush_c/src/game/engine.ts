/**
 * Wool Crush engine — pure reducers over WoolState. Written from scratch
 * against the grilled mechanics resolution (brief.md §Mechanics resolution):
 *
 *  1. Tap legality: a thread slides straight along its direction and off the
 *     board unless ANY cell on its exit path is occupied (Parking Jam rule).
 *  2. Released thread → leftmost free slot; with no free slot the tap is a
 *     no-op (the board can only buffer 4 spools).
 *  3. Pull: a spool pulls the CLOSEST VISIBLE matching section (visibility =
 *     the front-K window — the viewport is the scarcity dial). Pulled from
 *     the middle, the body seams shut (gap-close splice → adjacencies change).
 *  4. When several spools could pull, the CLOSEST-TO-FINISH pulls first
 *     (min remaining; tie → lowest slot index).
 *  5. While any pull is active the dragon holds (shortens instead of
 *     advancing); spools with no visible match idle, keeping progress + slot.
 *  6. Win: board empty + all slots free (== dragon consumed, by conservation).
 *     Fail: headProgress reaches trackLength (the cat). No deadlock detection
 *     — idle spools lose the race naturally.
 */

import type { Direction, ThreadDef, WoolEvent, WoolLevelDef, WoolState, YarnColor } from './types';
import { SLOT_COUNT } from './types';
import { makeRng, shuffled } from './rng';

const DIR_AXIS: Record<Direction, 'h' | 'v'> = { left: 'h', right: 'h', up: 'v', down: 'v' };

/** Cells a thread occupies: `length` cells from (x, y) along its axis. */
export function threadCells(t: ThreadDef): { x: number; y: number }[] {
  const cells: { x: number; y: number }[] = [];
  for (let i = 0; i < t.length; i += 1) {
    cells.push(DIR_AXIS[t.dir] === 'h' ? { x: t.x + i, y: t.y } : { x: t.x, y: t.y + i });
  }
  return cells;
}

/** Cells the thread must cross to leave the board (excluding its own). */
export function exitPathCells(t: ThreadDef, def: WoolLevelDef): { x: number; y: number }[] {
  const cells: { x: number; y: number }[] = [];
  if (t.dir === 'right') {
    for (let x = t.x + t.length; x < def.cols; x += 1) cells.push({ x, y: t.y });
  } else if (t.dir === 'left') {
    for (let x = t.x - 1; x >= 0; x -= 1) cells.push({ x, y: t.y });
  } else if (t.dir === 'down') {
    for (let y = t.y + t.length; y < def.rows; y += 1) cells.push({ x: t.x, y });
  } else {
    for (let y = t.y - 1; y >= 0; y -= 1) cells.push({ x: t.x, y });
  }
  return cells;
}

/** True when the thread's straight exit path is clear of other threads. */
export function canRelease(state: WoolState, threadId: string): boolean {
  const t = state.threads.find((x) => x.id === threadId);
  if (!t) return false;
  const occupied = new Set(
    state.threads.filter((o) => o.id !== threadId).flatMap((o) => threadCells(o).map((c) => `${c.x},${c.y}`)),
  );
  return exitPathCells(t, state.def).every((c) => !occupied.has(`${c.x},${c.y}`));
}

/** Derive the dragon from the thread map: one section per thread-length unit
 *  per color (conservation by construction), seeded shuffle for order. */
export function deriveDragon(def: WoolLevelDef): YarnColor[] {
  const sections: YarnColor[] = [];
  for (const t of def.threads) for (let i = 0; i < t.length; i += 1) sections.push(t.color);
  return shuffled(sections, makeRng(def.seed));
}

export function createGame(def: WoolLevelDef): WoolState {
  return {
    def,
    threads: def.threads.map((t) => ({ ...t })),
    slots: Array.from({ length: SLOT_COUNT }, () => null),
    dragon: deriveDragon(def),
    headProgress: 0,
    pullAccum: 0,
    status: 'playing',
  };
}

/** Indices of dragon sections currently visible (front-K window). */
export function visibleIndices(state: WoolState): number[] {
  const n = Math.min(state.def.visibleWindow, state.dragon.length);
  return Array.from({ length: n }, (_, i) => i);
}

/** The slot that pulls next: among spools with a visible matching section,
 *  the closest-to-finish (min remaining; tie → lowest slot). -1 if none. */
export function nextPullingSlot(state: WoolState): number {
  const visible = visibleIndices(state).map((i) => state.dragon[i]);
  let best = -1;
  for (let s = 0; s < state.slots.length; s += 1) {
    const spool = state.slots[s];
    if (!spool || !visible.includes(spool.color)) continue;
    const bestSpool = best >= 0 ? state.slots[best] : null;
    if (!bestSpool || spool.remaining < bestSpool.remaining) best = s;
  }
  return best;
}

/** Tap a thread. Legal → it leaves the board into the leftmost free slot.
 *  Illegal (blocked path, unknown id, no free slot, game over) → no-op. */
export function tapThread(state: WoolState, threadId: string): { state: WoolState; events: WoolEvent[] } {
  if (state.status !== 'playing') return { state, events: [] };
  const t = state.threads.find((x) => x.id === threadId);
  if (!t) return { state, events: [] };
  if (!canRelease(state, threadId)) return { state, events: [{ kind: 'blocked', threadId }] };
  const slot = state.slots.findIndex((s) => s === null);
  if (slot < 0) return { state, events: [{ kind: 'blocked', threadId }] };

  const slots = state.slots.slice();
  slots[slot] = { color: t.color, remaining: t.length, total: t.length };
  const next: WoolState = {
    ...state,
    threads: state.threads.filter((x) => x.id !== threadId),
    slots,
  };
  return { state: next, events: [{ kind: 'released', threadId, slot }] };
}

/** Advance time. While a pull is possible the dragon holds and sections are
 *  consumed at pullRate; otherwise the head advances at dragonSpeed. */
export function tick(state: WoolState, dtMs: number): { state: WoolState; events: WoolEvent[] } {
  if (state.status !== 'playing') return { state, events: [] };
  const events: WoolEvent[] = [];
  let s: WoolState = { ...state, slots: state.slots.slice(), dragon: state.dragon.slice() };
  let remainingMs = dtMs;

  while (remainingMs > 0) {
    const pullSlot = nextPullingSlot(s);
    if (pullSlot >= 0) {
      // Pulling: dragon holds; progress toward the next section pull.
      const msPerSection = 1000 / s.def.pullRate;
      const need = msPerSection * (1 - s.pullAccum);
      if (remainingMs < need) {
        s.pullAccum += remainingMs / msPerSection;
        remainingMs = 0;
        break;
      }
      remainingMs -= need;
      s.pullAccum = 0;
      // Pull the closest visible matching section (min dragon index).
      const spool = s.slots[pullSlot]!;
      const idx = visibleIndices(s).find((i) => s.dragon[i] === spool.color)!;
      s.dragon.splice(idx, 1); // gap closes — adjacencies change
      const remaining = spool.remaining - 1;
      events.push({ kind: 'sectionPulled', slot: pullSlot, dragonIndex: idx, color: spool.color });
      if (remaining <= 0) {
        s.slots[pullSlot] = null;
        events.push({ kind: 'spoolCompleted', slot: pullSlot, color: spool.color });
      } else {
        s.slots[pullSlot] = { ...spool, remaining };
      }
      // Win check: board empty and every slot free (conservation ⇒ dragon 0).
      if (s.threads.length === 0 && s.slots.every((x) => x === null)) {
        s.status = 'won';
        events.push({ kind: 'won' });
        break;
      }
    } else {
      // No pull possible: the dragon advances toward the cat.
      const distance = (remainingMs / 1000) * s.def.dragonSpeed;
      const room = s.def.trackLength - s.headProgress;
      if (distance >= room) {
        s.headProgress = s.def.trackLength;
        s.status = 'failed';
        events.push({ kind: 'failed' });
        break;
      }
      s.headProgress += distance;
      remainingMs = 0;
    }
  }
  return { state: s, events };
}
