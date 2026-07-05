import { describe, expect, test } from 'vitest';

import {
  ENDLESS_LEVEL_ID,
  FLOW_TRANSITION_TABLE,
  FlowMachineError,
  FlowStates,
  FlowTransitions,
  createFlowMachine,
  type FlowMachine,
  type FlowState,
  type FlowTransition,
} from './index.ts';

type LegalTransitionCase = {
  readonly from: FlowState;
  readonly transition: FlowTransition;
  readonly to: FlowState;
};

const EXPECTED_TRANSITION_TABLE = {
  [FlowStates.Boot]: {
    [FlowTransitions.Start]: FlowStates.Playing,
    [FlowTransitions.ToMenu]: FlowStates.Menu,
  },
  [FlowStates.Menu]: {
    [FlowTransitions.Start]: FlowStates.Playing,
    [FlowTransitions.SelectLevel]: FlowStates.LevelSelect,
  },
  [FlowStates.LevelSelect]: {
    [FlowTransitions.Start]: FlowStates.Playing,
    [FlowTransitions.ToMenu]: FlowStates.Menu,
  },
  [FlowStates.Playing]: {
    [FlowTransitions.Complete]: FlowStates.Complete,
    [FlowTransitions.Fail]: FlowStates.Failed,
    [FlowTransitions.Pause]: FlowStates.Paused,
    [FlowTransitions.ToMenu]: FlowStates.Menu,
  },
  [FlowStates.Paused]: {
    [FlowTransitions.Resume]: FlowStates.Playing,
    [FlowTransitions.ToMenu]: FlowStates.Menu,
  },
  [FlowStates.Complete]: {
    [FlowTransitions.Next]: FlowStates.Playing,
    [FlowTransitions.Retry]: FlowStates.Playing,
    [FlowTransitions.ToMenu]: FlowStates.Menu,
  },
  [FlowStates.Failed]: {
    [FlowTransitions.Retry]: FlowStates.Playing,
    [FlowTransitions.ToMenu]: FlowStates.Menu,
  },
} as const satisfies Readonly<Record<FlowState, Readonly<Partial<Record<FlowTransition, FlowState>>>>>;

const legalTransitionCases: readonly LegalTransitionCase[] = Object.entries(
  EXPECTED_TRANSITION_TABLE,
).flatMap(([from, transitions]: [string, Partial<Record<FlowTransition, FlowState>>]) =>
  Object.entries(transitions).map(([transition, to]: [string, FlowState]) => ({
    from: from as FlowState,
    transition: transition as FlowTransition,
    to,
  })),
);

describe('FlowMachine transitions', (): void => {
  test('pins the canonical transition table', (): void => {
    expect(FLOW_TRANSITION_TABLE).toEqual(EXPECTED_TRANSITION_TABLE);
  });

  test.each(legalTransitionCases)(
    '$from --$transition--> $to',
    ({ from, transition, to }: LegalTransitionCase): void => {
      const machine = machineInState(from);

      applyTransition(machine, transition);

      expect(machine.state).toBe(to);
    },
  );

  test('walks a full lifecycle', (): void => {
    const machine = createFlowMachine({ optionalStates: [FlowStates.LevelSelect, FlowStates.Paused] });

    machine.toMenu();
    expect(machine.state).toBe(FlowStates.Menu);
    machine.start('level-1');
    expect(machine.state).toBe(FlowStates.Playing);
    machine.complete();
    expect(machine.state).toBe(FlowStates.Complete);
    machine.next('level-2');
    expect(machine.state).toBe(FlowStates.Playing);
    machine.fail();
    expect(machine.state).toBe(FlowStates.Failed);
    machine.retry();
    expect(machine.state).toBe(FlowStates.Playing);
    machine.toMenu();
    expect(machine.state).toBe(FlowStates.Menu);
  });

  test('throws on illegal transitions with current state and transition', (): void => {
    const menuMachine = machineInState(FlowStates.Menu);
    expect((): void => menuMachine.complete()).toThrow(FlowMachineError);
    expect(captureFlowError((): void => menuMachine.complete())).toMatchObject({
      state: FlowStates.Menu,
      transition: FlowTransitions.Complete,
    });

    const playingMachine = machineInState(FlowStates.Playing);
    expect(captureFlowError((): void => playingMachine.resume())).toMatchObject({
      state: FlowStates.Playing,
      transition: FlowTransitions.Resume,
    });
    expect(captureFlowError((): void => playingMachine.start('again'))).toMatchObject({
      state: FlowStates.Playing,
      transition: FlowTransitions.Start,
    });

    const failedMachine = machineInState(FlowStates.Failed);
    expect(captureFlowError((): void => failedMachine.next('level-2'))).toMatchObject({
      state: FlowStates.Failed,
      transition: FlowTransitions.Next,
    });
  });

  test('throws when optional states are not enabled', (): void => {
    const menuMachine = createFlowMachine();
    menuMachine.toMenu();
    expect(captureFlowError((): void => menuMachine.selectLevel())).toMatchObject({
      state: FlowStates.Menu,
      transition: FlowTransitions.SelectLevel,
    });

    const playingMachine = createFlowMachine();
    playingMachine.start('level-1');
    expect(captureFlowError((): void => playingMachine.pause())).toMatchObject({
      state: FlowStates.Playing,
      transition: FlowTransitions.Pause,
    });
  });

  test('throws on unknown optional state config entries', (): void => {
    expect((): void => {
      createFlowMachine({ optionalStates: ['credits' as unknown as typeof FlowStates.Paused] });
    }).toThrow('unknown optional state credits');
  });

  test('tracks the current level id across terminal and menu states', (): void => {
    const machine = createFlowMachine();

    expect(machine.currentLevelId).toBeUndefined();
    machine.start('level-1');
    expect(machine.currentLevelId).toBe('level-1');
    machine.complete();
    expect(machine.currentLevelId).toBe('level-1');
    machine.toMenu();
    expect(machine.currentLevelId).toBe('level-1');
    machine.start('level-2');
    machine.fail();
    expect(machine.currentLevelId).toBe('level-2');
  });

  test('supports direct boot start for deep links and harnesses', (): void => {
    const machine = createFlowMachine();

    machine.start('level-1');

    expect(machine.state).toBe(FlowStates.Playing);
    expect(machine.currentLevelId).toBe('level-1');
  });

  test('can() reflects the transition table and optional-state enablement', (): void => {
    // Legal, target always-enabled: Playing --fail--> Failed.
    const playing = machineInState(FlowStates.Playing);
    expect(playing.can(FlowTransitions.Fail)).toBe(true);
    // Illegal from current state: Menu --complete--> (absent).
    const menu = machineInState(FlowStates.Menu);
    expect(menu.can(FlowTransitions.Complete)).toBe(false);

    // Transition table HAS Pause from Playing, but the target Paused state is
    // not enabled when the machine was created without it → can() is false and
    // pause() throws.
    const noPause = createFlowMachine();
    noPause.start('level-1');
    expect(noPause.state).toBe(FlowStates.Playing);
    expect(noPause.can(FlowTransitions.Pause)).toBe(false);
    expect((): void => noPause.pause()).toThrow(FlowMachineError);
  });

  test('can() guards a same-frame double-complete', (): void => {
    const machine = createFlowMachine();
    machine.start('level-1');
    expect(machine.can(FlowTransitions.Complete)).toBe(true);
    machine.complete();
    expect(machine.state).toBe(FlowStates.Complete);
    // Second complete() would be illegal from Complete — can() says so, and the
    // machine stays strict if the caller ignores the guard.
    expect(machine.can(FlowTransitions.Complete)).toBe(false);
    expect((): void => machine.complete()).toThrow(FlowMachineError);
  });

  test('a disposed machine is inert and loud', (): void => {
    const machine = createFlowMachine();
    machine.dispose();
    // Every transition throws instead of silently mutating state.
    expect(captureFlowError((): void => machine.start(ENDLESS_LEVEL_ID))).toMatchObject({
      state: FlowStates.Boot,
      transition: FlowTransitions.Start,
    });
    expect((): void => machine.toMenu()).toThrow(FlowMachineError);
    expect(machine.state).toBe(FlowStates.Boot);
    // can() reports false for everything after dispose.
    expect(machine.can(FlowTransitions.ToMenu)).toBe(false);
    expect(machine.can(FlowTransitions.Start)).toBe(false);
  });

  test('dispose() after a lifecycle still throws on further transitions', (): void => {
    const machine = createFlowMachine();
    machine.start('level-1');
    machine.fail();
    expect(machine.state).toBe(FlowStates.Failed);
    machine.dispose();
    expect((): void => machine.retry()).toThrow(FlowMachineError);
    expect(machine.state).toBe(FlowStates.Failed);
  });

  test('freezes registries and the transition table', (): void => {
    expect(Object.isFrozen(FlowStates)).toBe(true);
    expect(Object.isFrozen(FlowTransitions)).toBe(true);
    expect(Object.isFrozen(FLOW_TRANSITION_TABLE)).toBe(true);
    for (const transitions of Object.values(FLOW_TRANSITION_TABLE)) {
      expect(Object.isFrozen(transitions)).toBe(true);
    }
  });
});

function machineInState(targetState: FlowState): FlowMachine {
  const machine = createFlowMachine({ optionalStates: [FlowStates.LevelSelect, FlowStates.Paused] });
  switch (targetState) {
    case FlowStates.Boot:
      return machine;
    case FlowStates.Menu:
      machine.toMenu();
      return machine;
    case FlowStates.LevelSelect:
      machine.toMenu();
      machine.selectLevel();
      return machine;
    case FlowStates.Playing:
      machine.start('level-1');
      return machine;
    case FlowStates.Paused:
      machine.start('level-1');
      machine.pause();
      return machine;
    case FlowStates.Complete:
      machine.start('level-1');
      machine.complete();
      return machine;
    case FlowStates.Failed:
      machine.start('level-1');
      machine.fail();
      return machine;
  }
}

function applyTransition(machine: FlowMachine, transition: FlowTransition): void {
  switch (transition) {
    case FlowTransitions.Start:
      machine.start('level-2');
      break;
    case FlowTransitions.Complete:
      machine.complete();
      break;
    case FlowTransitions.Fail:
      machine.fail();
      break;
    case FlowTransitions.Next:
      machine.next('level-2');
      break;
    case FlowTransitions.Retry:
      machine.retry();
      break;
    case FlowTransitions.SelectLevel:
      machine.selectLevel();
      break;
    case FlowTransitions.Pause:
      machine.pause();
      break;
    case FlowTransitions.Resume:
      machine.resume();
      break;
    case FlowTransitions.ToMenu:
      machine.toMenu();
      break;
  }
}

function captureFlowError(fn: () => void): FlowMachineError {
  try {
    fn();
  } catch (err) {
    if (err instanceof FlowMachineError) {
      return err;
    }
    throw err;
  }
  throw new Error('Expected FlowMachineError');
}
