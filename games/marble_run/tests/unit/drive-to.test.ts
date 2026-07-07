import { describe, expect, it } from 'vitest';
import { createFlowMachine, type FlowMachine } from '@fabrikav2/kernel';
import { driveTo, isDriveState, type DriveToDeps } from '../../src/testing/driveTo';

/**
 * Headless acceptance for the per-state navigator (fidelity-diff ledger C5).
 *
 * driveTo lives on App.harness(), which needs WebGL/DOM (Stage, canvas) and
 * cannot run in vitest — so, exactly like the autoPlay drivers, the composition
 * is extracted (src/testing/driveTo) and exercised here against a fake App
 * backed by a REAL @fabrikav2/kernel FlowMachine. That makes the scene
 * transitions genuine (menu→playing→complete/failed/paused come from the same
 * transition table App uses), so the test proves driveTo actually REACHES and
 * CONFIRMS each state, not that a mock echoed a string back.
 *
 * `settingsOpen` (settings is a modal with no distinct flow scene) and
 * `inputReady` are modelled on the fake the same way App derives them. sleep is
 * a no-op so confirmation polling is instant and timer-free.
 */

const instantSleep = (): Promise<void> => Promise.resolve();
const opts = { pollMs: 0, sleep: instantSleep } as const;

interface FakeApp {
  deps: DriveToDeps;
  machine: FlowMachine;
}

/** Mirror App's transitions over a real FlowMachine (menu/playing/paused
 *  enabled) plus the settings-modal + input-ready flags App's snapshot exposes. */
function makeFakeApp(overrides: Partial<DriveToDeps> = {}): FakeApp {
  const machine = createFlowMachine({ optionalStates: ['levelSelect', 'paused'] });
  machine.toMenu(); // boot → menu, as App.start() does
  let settingsOpen = false;

  const deps: DriveToDeps = {
    // App.toMenu(): guarded, and closes any open modal on the way to the menu.
    gotoMenu: () => {
      if (machine.can('toMenu')) machine.toMenu();
      settingsOpen = false;
    },
    // App.startLevelId(): normalises playing/paused → menu, then starts.
    startLevel: (id) => {
      if (machine.state === 'playing' || machine.state === 'paused') {
        if (machine.can('toMenu')) machine.toMenu();
      }
      if (machine.can('start')) machine.start(String(id));
    },
    openSettings: () => {
      settingsOpen = true;
    },
    pause: () => {
      if (machine.can('pause')) machine.pause();
    },
    // Solver-bound terminal drivers → the machine's complete/fail transitions.
    autoWin: async () => {
      if (machine.can('complete')) machine.complete();
      return machine.state === 'complete';
    },
    autoFail: async () => {
      if (machine.can('fail')) machine.fail();
      return machine.state === 'failed';
    },
    snapshot: () => ({
      scene: machine.state,
      status: 'playing',
      inputReady: true,
      hearts: 5,
      coins: 0,
      settingsOpen,
    }),
    ...overrides,
  };

  return { deps, machine };
}

describe('driveTo — deterministic per-state navigation', () => {
  it.each([
    ['menu', 'menu', undefined] as const,
    ['level', 'playing', undefined] as const,
    ['win', 'complete', undefined] as const,
    ['fail', 'failed', undefined] as const,
    ['pause', 'paused', undefined] as const,
    ['settings', 'menu', true] as const,
  ])('driveTo(%s) reaches + confirms it', async (state, scene, settingsOpen) => {
    const { deps } = makeFakeApp();

    const reached = await driveTo(deps, state, opts);

    expect(reached).toBe(true);
    const snap = deps.snapshot();
    expect(snap.scene).toBe(scene);
    if (settingsOpen !== undefined) expect(snap.settingsOpen).toBe(settingsOpen);
  });

  it('is robust from a terminal state — win → drive to fail normalises via menu', async () => {
    const { deps, machine } = makeFakeApp();

    expect(await driveTo(deps, 'win', opts)).toBe(true);
    expect(machine.state).toBe('complete');

    // A complete board can't `start` directly; driveTo must re-normalise to menu.
    expect(await driveTo(deps, 'fail', opts)).toBe(true);
    expect(machine.state).toBe('failed');
  });

  it('returns false for an unknown state (honest "did not reach")', async () => {
    const { deps, machine } = makeFakeApp();
    expect(await driveTo(deps, 'bogus', opts)).toBe(false);
    // No transition attempted beyond the menu normalisation.
    expect(machine.state).toBe('menu');
  });

  it('returns false when the terminal driver never reaches the state', async () => {
    // autoWin that never completes (e.g. an unsolvable level) → unconfirmed.
    const { deps } = makeFakeApp({ autoWin: async () => false });
    const reached = await driveTo(deps, 'win', { pollMs: 0, maxPolls: 3, sleep: instantSleep });
    expect(reached).toBe(false);
    expect(deps.snapshot().scene).toBe('playing');
  });

  it.each([
    ['win', 'autoWin'] as const,
    ['fail', 'autoFail'] as const,
  ])('returns false when %s driver claims success but snapshot stays playing', async (state, driver) => {
    const { deps } = makeFakeApp({
      [driver]: async () => true,
    });

    const reached = await driveTo(deps, state, { pollMs: 0, maxPolls: 3, sleep: instantSleep });

    expect(reached).toBe(false);
    expect(deps.snapshot().scene).toBe('playing');
  });

  it('waits for inputReady before running the solver', async () => {
    const machine = createFlowMachine({ optionalStates: ['levelSelect', 'paused'] });
    machine.toMenu();
    let polls = 0;
    let autoWinCalledWhileReady = false;
    const deps: DriveToDeps = {
      gotoMenu: () => {
        if (machine.can('toMenu')) machine.toMenu();
      },
      startLevel: (id) => {
        if (machine.can('start')) machine.start(String(id));
      },
      openSettings: () => {},
      pause: () => {},
      autoWin: async () => {
        // Should only fire once inputReady flipped true.
        autoWinCalledWhileReady = ready();
        if (machine.can('complete')) machine.complete();
        return machine.state === 'complete';
      },
      autoFail: async () => false,
      snapshot: () => ({ scene: machine.state, inputReady: ready() }),
    };
    // inputReady stays false for the first two polls, then flips true.
    function ready(): boolean {
      return polls++ >= 2;
    }

    const reached = await driveTo(deps, 'win', { pollMs: 0, maxPolls: 10, sleep: instantSleep });
    expect(reached).toBe(true);
    expect(autoWinCalledWhileReady).toBe(true);
  });
});

describe('isDriveState', () => {
  it('accepts the six canonical states and rejects others', () => {
    for (const s of ['menu', 'level', 'win', 'fail', 'settings', 'pause']) {
      expect(isDriveState(s)).toBe(true);
    }
    expect(isDriveState('boot')).toBe(false);
    expect(isDriveState('')).toBe(false);
  });
});
