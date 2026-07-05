import { describe, expect, test, vi } from 'vitest';

import {
  FlowMachineError,
  FlowStates,
  createFlowMachine,
  type FlowMachine,
  type FlowMeta,
  type FlowState,
} from './index.ts';

describe('FlowMachine canonical events', (): void => {
  test('emits menu:enter on toMenu', (): void => {
    const machine = createFlowMachine();
    const onMenuEnter = vi.fn<(payload: { lastLevelId?: string; meta?: FlowMeta }) => void>();

    machine.events.on('menu:enter', onMenuEnter);
    machine.toMenu({ source: 'boot' });

    expect(onMenuEnter).toHaveBeenCalledWith({ meta: { source: 'boot' } });
  });

  test('emits level:start on start from boot, menu, and levelSelect', (): void => {
    const bootMachine = createFlowMachine();
    const onBootStart = vi.fn<(payload: { levelId: string }) => void>();
    bootMachine.events.on('level:start', onBootStart);
    bootMachine.start('boot-level');
    expect(onBootStart).toHaveBeenCalledWith({ levelId: 'boot-level' });

    const menuMachine = createFlowMachine();
    const onMenuStart = vi.fn<(payload: { levelId: string; meta?: FlowMeta }) => void>();
    menuMachine.toMenu();
    menuMachine.events.on('level:start', onMenuStart);
    menuMachine.start('menu-level', { source: 'menu' });
    expect(onMenuStart).toHaveBeenCalledWith({ levelId: 'menu-level', meta: { source: 'menu' } });

    const selectMachine = createFlowMachine({ optionalStates: [FlowStates.LevelSelect] });
    const onSelectStart = vi.fn<(payload: { levelId: string }) => void>();
    selectMachine.toMenu();
    selectMachine.selectLevel();
    selectMachine.events.on('level:start', onSelectStart);
    selectMachine.start('selected-level');
    expect(onSelectStart).toHaveBeenCalledWith({ levelId: 'selected-level' });
  });

  test('emits level:complete and level:fail with current level ids', (): void => {
    const completeMachine = createFlowMachine();
    const onComplete = vi.fn<(payload: { levelId: string; meta?: FlowMeta }) => void>();
    completeMachine.events.on('level:complete', onComplete);
    completeMachine.start('level-1');
    completeMachine.complete({ moves: 7 });
    expect(onComplete).toHaveBeenCalledWith({ levelId: 'level-1', meta: { moves: 7 } });

    const failMachine = createFlowMachine();
    const onFail = vi.fn<(payload: { levelId: string; meta?: FlowMeta }) => void>();
    failMachine.events.on('level:fail', onFail);
    failMachine.start('level-2');
    failMachine.fail({ reason: 'timeout' });
    expect(onFail).toHaveBeenCalledWith({ levelId: 'level-2', meta: { reason: 'timeout' } });
  });

  test('emits level:next then level:start on next', (): void => {
    const machine = createFlowMachine();
    const calls: string[] = [];

    machine.events.on('level:next', (payload): void => {
      calls.push(`next:${payload.levelId}:${String(payload.meta?.nextLevelId)}`);
    });
    machine.events.on('level:start', (payload): void => {
      calls.push(`start:${payload.levelId}:${String(payload.meta?.source)}`);
    });

    machine.start('level-1');
    calls.length = 0;
    machine.complete();
    machine.next('level-2', { source: 'next-button' });

    expect(calls).toEqual(['next:level-1:level-2', 'start:level-2:next-button']);
  });

  test('emits level:start on retry from complete and failed', (): void => {
    const completeMachine = createFlowMachine();
    const onCompleteRetry = vi.fn<(payload: { levelId: string; meta?: FlowMeta }) => void>();
    completeMachine.start('level-1');
    completeMachine.complete();
    completeMachine.events.on('level:start', onCompleteRetry);
    completeMachine.retry({ source: 'replay' });
    expect(onCompleteRetry).toHaveBeenCalledWith({ levelId: 'level-1', meta: { source: 'replay' } });

    const failedMachine = createFlowMachine();
    const onFailedRetry = vi.fn<(payload: { levelId: string }) => void>();
    failedMachine.start('level-2');
    failedMachine.fail();
    failedMachine.events.on('level:start', onFailedRetry);
    failedMachine.retry();
    expect(onFailedRetry).toHaveBeenCalledWith({ levelId: 'level-2' });
  });

  test('emits menu:enter with last level id after gameplay states', (): void => {
    const machine = createFlowMachine();
    const onMenuEnter = vi.fn<(payload: { lastLevelId?: string; meta?: FlowMeta }) => void>();

    machine.start('level-1');
    machine.complete();
    machine.events.on('menu:enter', onMenuEnter);
    machine.toMenu({ source: 'close-modal' });

    expect(onMenuEnter).toHaveBeenCalledWith({
      lastLevelId: 'level-1',
      meta: { source: 'close-modal' },
    });
  });

  test.each([
    {
      from: FlowStates.LevelSelect,
      arrange: (machine: FlowMachine): void => {
        machine.toMenu();
        machine.selectLevel();
      },
      expected: {},
    },
    {
      from: FlowStates.Playing,
      arrange: (machine: FlowMachine): void => {
        machine.start('level-1');
      },
      expected: { lastLevelId: 'level-1' },
    },
    {
      from: FlowStates.Paused,
      arrange: (machine: FlowMachine): void => {
        machine.start('level-1');
        machine.pause();
      },
      expected: { lastLevelId: 'level-1' },
    },
    {
      from: FlowStates.Failed,
      arrange: (machine: FlowMachine): void => {
        machine.start('level-1');
        machine.fail();
      },
      expected: { lastLevelId: 'level-1' },
    },
  ] satisfies ReadonlyArray<{
    readonly from: FlowState;
    readonly arrange: (machine: FlowMachine) => void;
    readonly expected: { readonly lastLevelId?: string };
  }>)('emits menu:enter from $from', ({ arrange, expected }): void => {
    const machine = createFlowMachine({ optionalStates: [FlowStates.LevelSelect, FlowStates.Paused] });
    const onMenuEnter = vi.fn<(payload: { lastLevelId?: string; meta?: FlowMeta }) => void>();

    arrange(machine);
    machine.events.on('menu:enter', onMenuEnter);
    machine.toMenu({ source: 'exit' });

    expect(onMenuEnter).toHaveBeenCalledWith({ ...expected, meta: { source: 'exit' } });
  });

  test('types level:next payloads with a guaranteed nextLevelId', (): void => {
    const machine = createFlowMachine();
    const nextLevelIds: string[] = [];

    machine.events.on('level:next', (payload): void => {
      nextLevelIds.push(payload.meta.nextLevelId);
    });

    machine.start('level-1');
    machine.complete();
    machine.next('level-2');

    expect(nextLevelIds).toEqual(['level-2']);
  });

  test('rejects non-canonical event names at typecheck time', (): void => {
    const machine = createFlowMachine();

    // @ts-expect-error FlowMachine events only expose the canonical lifecycle event names.
    machine.events.on('flow:transition', (): void => {});

    expect(machine.state).toBe(FlowStates.Boot);
  });

  test('selectLevel, pause, and resume are silent canonical transitions', (): void => {
    const machine = createFlowMachine({ optionalStates: [FlowStates.LevelSelect, FlowStates.Paused] });
    const onMenuEnter = vi.fn();
    const onLevelStart = vi.fn();
    const onLevelComplete = vi.fn();
    const onLevelFail = vi.fn();
    const onLevelNext = vi.fn();

    machine.events.on('menu:enter', onMenuEnter);
    machine.events.on('level:start', onLevelStart);
    machine.events.on('level:complete', onLevelComplete);
    machine.events.on('level:fail', onLevelFail);
    machine.events.on('level:next', onLevelNext);

    machine.toMenu();
    onMenuEnter.mockClear();
    machine.selectLevel();
    machine.start('level-1');
    onLevelStart.mockClear();
    machine.pause();
    machine.resume();

    expect(onMenuEnter).not.toHaveBeenCalled();
    expect(onLevelStart).not.toHaveBeenCalled();
    expect(onLevelComplete).not.toHaveBeenCalled();
    expect(onLevelFail).not.toHaveBeenCalled();
    expect(onLevelNext).not.toHaveBeenCalled();
  });

  test('state is updated before event listeners run', (): void => {
    const machine = createFlowMachine();
    const observedStates: string[] = [];

    machine.events.on('level:complete', (): void => {
      observedStates.push(machine.state);
    });

    machine.start('level-1');
    machine.complete();

    expect(observedStates).toEqual([FlowStates.Complete]);
  });

  test('queues listener-requested transitions until the current emit drains', (): void => {
    const machine = createFlowMachine();
    const calls: string[] = [];

    machine.events.on('level:complete', (): void => {
      calls.push(`complete:first:${machine.state}`);
      machine.next('level-2');
    });
    machine.events.on('level:complete', (): void => {
      calls.push(`complete:second:${machine.state}`);
    });
    machine.events.on('level:next', (payload): void => {
      calls.push(`next:${payload.levelId}`);
    });
    machine.events.on('level:start', (payload): void => {
      calls.push(`start:${payload.levelId}`);
    });

    machine.start('level-1');
    calls.length = 0;
    machine.complete();

    expect(calls).toEqual([
      `complete:first:${FlowStates.Complete}`,
      `complete:second:${FlowStates.Complete}`,
      'next:level-1',
      'start:level-2',
    ]);
    expect(machine.state).toBe(FlowStates.Playing);
  });

  test('clears queued transitions after a queued transition throws', (): void => {
    const machine = createFlowMachine();
    machine.events.on('level:complete', (): void => {
      machine.fail();
      machine.toMenu();
    });

    machine.start('level-1');
    expect((): void => machine.complete()).toThrow('cannot fail from complete');

    expect(machine.state).toBe(FlowStates.Complete);
    machine.next('level-2');
    expect(machine.state).toBe(FlowStates.Playing);
  });

  test('clears queued transitions when a listener throws', (): void => {
    const machine = createFlowMachine();
    machine.events.on('level:complete', (): void => {
      machine.next('level-2');
    });
    machine.events.on('level:complete', (): void => {
      throw new Error('listener failed');
    });

    machine.start('level-1');
    expect((): void => machine.complete()).toThrow('listener failed');

    expect(machine.state).toBe(FlowStates.Complete);
    machine.toMenu();
    expect(machine.state).toBe(FlowStates.Menu);
  });

  test('passes meta through by reference and omits meta when absent', (): void => {
    const machine = createFlowMachine();
    const meta = { score: 12 };
    const onStart = vi.fn<(payload: { levelId: string; meta?: FlowMeta }) => void>();
    machine.events.on('level:start', onStart);

    machine.start('level-1', meta);

    expect(onStart).toHaveBeenCalledWith({ levelId: 'level-1', meta });
    expect(onStart.mock.calls[0]?.[0]).not.toHaveProperty('missing');
  });

  test('dispose removes listeners and makes further transitions throw', (): void => {
    const machine = createFlowMachine();
    const onStart = vi.fn();

    machine.events.on('level:start', onStart);
    machine.dispose();

    // Post-dispose the machine is inert and loud: transitions throw instead of
    // silently mutating state, and no listener fires.
    expect((): void => machine.start('level-1')).toThrow(FlowMachineError);
    expect(onStart).not.toHaveBeenCalled();
  });
});
