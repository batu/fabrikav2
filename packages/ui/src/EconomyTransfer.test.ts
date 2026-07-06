import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { animateEconomyTransfer, type EconomyTransferOptions } from './index.ts';

// happy-dom has no real paint loop; drive rAF manually so token spawn/flight is
// deterministic. Each flush runs the currently-queued frame callbacks at `now`.
let rafCallbacks: Map<number, FrameRequestCallback>;
let nextRafId: number;

function flushFrame(now: number): void {
  const pending = Array.from(rafCallbacks.entries());
  rafCallbacks.clear();
  for (const [, cb] of pending) cb(now);
}

// Extension-less injected URL — mirrors wave A's ToggleRow test convention so
// the no-literals audit's asset-path rule stays clean.
const TOKEN_IMAGE = 'https://cdn.example/coin-glyph';

function makeTarget(id: string): HTMLElement {
  const el = document.createElement('div');
  el.id = id;
  // Non-zero rect so visibleCenter/visibleTransferAnchor resolve.
  el.getBoundingClientRect = (): DOMRect =>
    ({ left: 100, top: 100, width: 20, height: 20, right: 120, bottom: 120, x: 100, y: 100, toJSON: () => ({}) }) as DOMRect;
  document.body.appendChild(el);
  return el;
}

function baseOptions(overrides: Partial<EconomyTransferOptions>): EconomyTransferOptions {
  return {
    kind: 'coin',
    amount: 10,
    tokenImage: TOKEN_IMAGE,
    source: null,
    targets: ['#target'],
    ...overrides,
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
  rafCallbacks = new Map();
  nextRafId = 0;
  window.requestAnimationFrame = (cb: FrameRequestCallback): number => {
    const id = ++nextRafId;
    rafCallbacks.set(id, cb);
    return id;
  };
  window.cancelAnimationFrame = (id: number): void => {
    rafCallbacks.delete(id);
  };
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('animateEconomyTransfer — guards', () => {
  it('resolves immediately when amount is zero (no target lookup needed)', async () => {
    makeTarget('target');
    await expect(animateEconomyTransfer(baseOptions({ amount: 0 }))).resolves.toBeUndefined();
    expect(document.querySelector('.fab-economy-token')).toBeNull();
  });

  it('resolves immediately when no target is visible', async () => {
    // No #target in the DOM.
    await expect(animateEconomyTransfer(baseOptions({ amount: 5 }))).resolves.toBeUndefined();
    expect(document.querySelector('.fab-economy-token')).toBeNull();
  });
});

describe('animateEconomyTransfer — reduced motion', () => {
  it('sets the count instantly, spawns no tokens, and resolves', async () => {
    makeTarget('target');
    const countEl = document.createElement('span');

    const promise = animateEconomyTransfer(
      baseOptions({
        reducedMotion: true,
        countElement: countEl,
        fromValue: 3,
        toValue: 17,
      }),
    );

    // No async paint needed under reduced motion.
    await expect(promise).resolves.toBeUndefined();
    expect(countEl.textContent).toBe('17');
    expect(document.querySelector('.fab-economy-token')).toBeNull();
    expect(document.getElementById('fab-economy-transfer-layer')).toBeNull();
  });
});

describe('animateEconomyTransfer — token-count heuristic', () => {
  function spawnedTokenCount(options: EconomyTransferOptions): number {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    void animateEconomyTransfer(options);
    // Fire the per-token stagger setTimeouts, then paint one frame so each
    // token element is created and appended to the flight layer.
    vi.advanceTimersByTime(1);
    flushFrame(0);
    return document.querySelectorAll('.fab-economy-token').length;
  }

  it('clamps coin tokens to the lower bound for a small amount', () => {
    makeTarget('target');
    expect(spawnedTokenCount(baseOptions({ kind: 'coin', amount: 1, staggerMs: 0, durationMs: 1000 }))).toBe(6);
  });

  it('scales coin tokens with amount between the bounds', () => {
    makeTarget('target');
    // ceil(60/6) = 10, within [6, 12].
    expect(spawnedTokenCount(baseOptions({ kind: 'coin', amount: 60, staggerMs: 0, durationMs: 1000 }))).toBe(10);
  });

  it('clamps hint tokens to the upper bound', () => {
    makeTarget('target');
    // min(8, max(3, 5*3)) = 8.
    expect(spawnedTokenCount(baseOptions({ kind: 'hint', amount: 5, staggerMs: 0, durationMs: 1000 }))).toBe(8);
  });
});

describe('animateEconomyTransfer — flight lifecycle', () => {
  it('paints tokens with the injected image and bumps the target on completion', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const target = makeTarget('target');
    const promise = animateEconomyTransfer(
      baseOptions({ kind: 'coin', amount: 1, staggerMs: 0, durationMs: 100 }),
    );

    vi.advanceTimersByTime(1); // fire stagger timeouts → queue first frames
    flushFrame(0); // create tokens at startedAt = 0
    const token = document.querySelector<HTMLElement>('.fab-economy-token');
    expect(token).not.toBeNull();
    expect(token!.style.backgroundImage).toBe(`url("${TOKEN_IMAGE}")`);
    expect(token!.classList.contains('fab-economy-token--coin')).toBe(true);

    flushFrame(100); // raw = 1 → finish each token
    await promise;

    expect(document.querySelector('.fab-economy-token')).toBeNull();
    expect(target.classList.contains('fab-economy-target-bump')).toBe(true);
  });

  it('cancels in-flight tokens when the target leaves the DOM (isLive → cancel)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const target = makeTarget('target');
    const promise = animateEconomyTransfer(
      baseOptions({ kind: 'coin', amount: 1, staggerMs: 0, durationMs: 1000 }),
    );

    vi.advanceTimersByTime(1);
    flushFrame(0); // tokens created and in flight
    expect(document.querySelector('.fab-economy-token')).not.toBeNull();

    target.remove(); // endpoint gone → isLive() false
    flushFrame(50); // next frame observes the dead endpoint and finishes
    await promise;

    expect(document.querySelector('.fab-economy-token')).toBeNull();
  });
});
