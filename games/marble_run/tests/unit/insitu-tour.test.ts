import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { App } from '../../src/shell/App';
import { maybeRunInsituTour } from '../../src/testing/insituTour';

/**
 * Headless acceptance for the on-device tour (fidelity-diff ledger C5/D4-D7).
 *
 * maybeRunInsituTour drives document/window directly and needs no Stage/canvas,
 * so it CAN run in vitest given minimal DOM stand-ins — this suite fakes just
 * the document/window surface the tour touches (body, one marker element,
 * location.search) rather than pulling in a full jsdom dependency.
 *
 * The two things ROBUST-REVIEW called out: (1) 'allstates' really drives every
 * canonical state via h.driveTo (never assumes one), writing the confirmed/failed
 * marker each time; (2) the #__tourstate__ marker is off-screen (so it never
 * contaminates a capture) yet present in the a11y tree (queryable by an external
 * capturer) — both are asserted directly against the fake DOM.
 */

interface FakeElement {
  id: string;
  attrs: Map<string, string>;
  style: { cssText: string };
  textContent: string;
  setAttribute(k: string, v: string): void;
  getAttribute(k: string): string | null;
  appendChild?(el: FakeElement): void;
}

function snapshotFor(state: string): Record<string, unknown> {
  switch (state) {
    case 'level':
      return { scene: 'playing', status: 'playing', inputReady: true };
    case 'settings':
      return { scene: 'menu', status: 'idle', inputReady: true, settingsOpen: true };
    case 'pause':
      return { scene: 'paused', status: 'playing', inputReady: true };
    case 'win':
      return { scene: 'complete', status: 'complete', inputReady: false };
    case 'fail':
      return { scene: 'failed', status: 'failed', inputReady: false };
    case 'menu':
    default:
      return { scene: 'menu', status: 'idle', inputReady: true };
  }
}

function makeElement(ariaHistory: string[]): FakeElement {
  const el: FakeElement = {
    id: '',
    attrs: new Map(),
    style: { cssText: '' },
    textContent: '',
    setAttribute(k, v) {
      el.attrs.set(k, v);
      if (k === 'aria-label') ariaHistory.push(v);
    },
    getAttribute(k) {
      return el.attrs.get(k) ?? null;
    },
  };
  return el;
}

/** Minimal document/window stand-ins covering exactly what insituTour touches. */
function installFakeDom(ariaHistory: string[]): { markerFor: (id: string) => FakeElement | null } {
  const registry = new Map<string, FakeElement>();
  const body = makeElement(ariaHistory);
  body.appendChild = (el) => {
    if (el.id) registry.set(el.id, el);
  };

  const fakeDocument = {
    body,
    createElement: () => makeElement(ariaHistory),
    getElementById: (id: string) => registry.get(id) ?? null,
  };
  const fakeWindow = { location: { search: '?insituTour=allstates' } };

  vi.stubGlobal('document', fakeDocument);
  vi.stubGlobal('window', fakeWindow);

  return { markerFor: (id) => registry.get(id) ?? null };
}

/** A fake App whose harness().driveTo/snapshot are fully under test control. */
function makeFakeApp(
  driveTo: (state: string) => Promise<boolean>,
  snapshot?: () => Record<string, unknown>,
  harnessOverrides: Record<string, unknown> = {},
): App {
  let currentState = 'menu';
  const h = {
    snapshot: () => snapshot?.() ?? snapshotFor(currentState),
    driveTo: async (state: string): Promise<boolean> => {
      const ok = await driveTo(state);
      if (ok) currentState = state;
      return ok;
    },
    startLevel: () => {},
    gotoMenu: () => {},
    autoWin: async () => true,
    autoFail: async () => true,
    ...harnessOverrides,
  };
  return { harness: () => h } as unknown as App;
}

describe('maybeRunInsituTour — allstates', () => {
  let ariaHistory: string[];

  beforeEach(() => {
    ariaHistory = [];
    installFakeDom(ariaHistory);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('drives every canonical state via h.driveTo, marking each confirmed', async () => {
    const seen: string[] = [];
    const driveTo = async (state: string): Promise<boolean> => {
      seen.push(state);
      return true;
    };
    const app = makeFakeApp(driveTo);

    const run = maybeRunInsituTour(app);
    await vi.runAllTimersAsync();
    await run;

    expect(seen).toEqual(['menu', 'level', 'settings', 'pause', 'win', 'fail']);
    // Every state confirmed (driveTo resolved true) → marked by its own name,
    // then retired before the next drive so a late runner cannot accept a stale
    // exact marker during the transition to the next state.
    expect(ariaHistory).toEqual([
      'tourstate:menu',
      'tourstate:menu-DONE',
      'tourstate:level',
      'tourstate:level-DONE',
      'tourstate:settings',
      'tourstate:settings-DONE',
      'tourstate:pause',
      'tourstate:pause-DONE',
      'tourstate:win',
      'tourstate:win-DONE',
      'tourstate:fail',
      'tourstate:fail-DONE',
      'tourstate:done',
    ]);
  });

  it('resets and seeds save state before the first canonical drive', async () => {
    const calls: string[] = [];
    const app = makeFakeApp(
      async (state) => {
        calls.push(`drive:${state}`);
        return true;
      },
      undefined,
      {
        resetSave: () => calls.push('reset'),
        seedSave: (profile: { unlockedLevel?: number; coins?: number }) => {
          calls.push(`seed:${profile.unlockedLevel}:${profile.coins}`);
        },
      },
    );

    const run = maybeRunInsituTour(app);
    await vi.runAllTimersAsync();
    await run;

    expect(calls.slice(0, 3)).toEqual(['reset', 'seed:2:25', 'drive:menu']);
  });

  it('marks a state "-FAILED" — an honest miss, not a false confirm — when driveTo cannot reach it', async () => {
    const driveTo = async (state: string): Promise<boolean> => state !== 'pause';
    const app = makeFakeApp(driveTo);

    const run = maybeRunInsituTour(app);
    await vi.runAllTimersAsync();
    await run;

    expect(ariaHistory).toContain('tourstate:pause-FAILED');
    expect(ariaHistory).not.toContain('tourstate:pause');
  });

  it('marks FAILED instead of a false success when the settle re-check no longer matches', async () => {
    let currentState = 'menu';
    const driveTo = async (state: string): Promise<boolean> => {
      currentState = state;
      return true;
    };
    const app = makeFakeApp(driveTo, () =>
      currentState === 'settings'
        ? { scene: 'menu', status: 'idle', inputReady: true, settingsOpen: false }
        : snapshotFor(currentState),
    );

    const run = maybeRunInsituTour(app);
    await vi.runAllTimersAsync();
    await run;

    expect(ariaHistory).toContain('tourstate:settings-FAILED');
    expect(ariaHistory).not.toContain('tourstate:settings');
  });

  it('retires the exact settings marker before driving pause, preventing stale captures', async () => {
    let markerAtPauseStart: string | undefined;
    const driveTo = async (state: string): Promise<boolean> => {
      if (state === 'pause') markerAtPauseStart = ariaHistory.at(-1);
      return true;
    };
    const app = makeFakeApp(driveTo);

    const run = maybeRunInsituTour(app);
    await vi.runAllTimersAsync();
    await run;

    expect(markerAtPauseStart).toBe('tourstate:settings-DONE');
  });

  it('writes a single #__tourstate__ marker that is off-screen yet present in the a11y tree', async () => {
    const { markerFor } = installFakeDom(ariaHistory); // re-install for a fresh registry
    const app = makeFakeApp(async () => true);

    const run = maybeRunInsituTour(app);
    await vi.runAllTimersAsync();
    await run;

    const marker = markerFor('__tourstate__');
    expect(marker).not.toBeNull();
    // Off-screen (not merely faded) — must not intersect the viewport at all.
    expect(marker!.style.cssText).toContain('left:-9999px');
    expect(marker!.style.cssText).not.toContain('opacity');
    // But still queryable — present with a live aria-label an external
    // capturer (XCUITest) can wait on.
    expect(marker!.getAttribute('aria-label')).toBe('tourstate:done');
    expect(marker!.textContent).toBe('tourstate:done');
  });

  it('reuses the same marker element across states instead of creating a new one each time', async () => {
    let created = 0;
    const registry = new Map<string, FakeElement>();
    const body = makeElement(ariaHistory);
    body.appendChild = (el) => {
      if (el.id) registry.set(el.id, el);
    };
    vi.stubGlobal('document', {
      body,
      createElement: () => {
        created += 1;
        return makeElement(ariaHistory);
      },
      getElementById: (id: string) => registry.get(id) ?? null,
    });
    vi.stubGlobal('window', { location: { search: '?insituTour=allstates' } });

    const app = makeFakeApp(async () => true);
    const run = maybeRunInsituTour(app);
    await vi.runAllTimersAsync();
    await run;

    expect(created).toBe(1);
  });
});

describe('maybeRunInsituTour — no script', () => {
  it('does nothing when neither the env flag nor the URL param is set', async () => {
    const ariaHistory: string[] = [];
    vi.stubGlobal('window', { location: { search: '' } });
    let driveToCalled = false;
    const app = makeFakeApp(async () => {
      driveToCalled = true;
      return true;
    });

    await maybeRunInsituTour(app);

    expect(driveToCalled).toBe(false);
    expect(ariaHistory).toEqual([]);
    vi.unstubAllGlobals();
  });
});
