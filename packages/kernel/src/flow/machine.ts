/**
 * Renderer-agnostic game lifecycle shell.
 *
 * FlowMachine models logical game flow, not renderer screens: `complete`
 * and `failed` are states even when a game renders them as modals over the
 * play scene. Adoption is intentionally follow-up work; the first sanctioned
 * adopter is block_blast, then arrow.
 *
 * Events use the core typed emitter directly. Listener throws propagate, and
 * listener-requested transitions queue until the current emit has finished so
 * every listener observes one stable post-transition state.
 *
 * @experimental Ported from v1 `shell/flow-machine.ts`, which had ZERO consumers.
 * This is the SEED of the screen flow machine and WILL be rewritten against the
 * real UI consumers in the ui cards. Do not wire new consumers to this contract
 * or treat its transition table as settled — it is carried in quarantined, not
 * blessed.
 */

import { createTypedEventEmitter, type TypedEventEmitter } from '../emitter.ts';
import type { FlowEventMap, FlowMeta } from './events.ts';

export const FlowStates = Object.freeze({
  Boot: 'boot',
  Menu: 'menu',
  LevelSelect: 'levelSelect',
  Playing: 'playing',
  Paused: 'paused',
  Complete: 'complete',
  Failed: 'failed',
} as const);

export type FlowState = (typeof FlowStates)[keyof typeof FlowStates];

export const FlowTransitions = Object.freeze({
  Start: 'start',
  Complete: 'complete',
  Fail: 'fail',
  Next: 'next',
  Retry: 'retry',
  SelectLevel: 'selectLevel',
  Pause: 'pause',
  Resume: 'resume',
  ToMenu: 'toMenu',
} as const);

export type FlowTransition = (typeof FlowTransitions)[keyof typeof FlowTransitions];

export type OptionalFlowState = typeof FlowStates.LevelSelect | typeof FlowStates.Paused;

type TransitionTable = Readonly<Record<FlowState, Readonly<Partial<Record<FlowTransition, FlowState>>>>>;

export const FLOW_TRANSITION_TABLE: TransitionTable = Object.freeze({
  [FlowStates.Boot]: Object.freeze({
    [FlowTransitions.Start]: FlowStates.Playing,
    [FlowTransitions.ToMenu]: FlowStates.Menu,
  }),
  [FlowStates.Menu]: Object.freeze({
    [FlowTransitions.Start]: FlowStates.Playing,
    [FlowTransitions.SelectLevel]: FlowStates.LevelSelect,
  }),
  [FlowStates.LevelSelect]: Object.freeze({
    [FlowTransitions.Start]: FlowStates.Playing,
    [FlowTransitions.ToMenu]: FlowStates.Menu,
  }),
  [FlowStates.Playing]: Object.freeze({
    [FlowTransitions.Complete]: FlowStates.Complete,
    [FlowTransitions.Fail]: FlowStates.Failed,
    [FlowTransitions.Pause]: FlowStates.Paused,
    [FlowTransitions.ToMenu]: FlowStates.Menu,
  }),
  [FlowStates.Paused]: Object.freeze({
    [FlowTransitions.Resume]: FlowStates.Playing,
    [FlowTransitions.ToMenu]: FlowStates.Menu,
  }),
  [FlowStates.Complete]: Object.freeze({
    [FlowTransitions.Next]: FlowStates.Playing,
    [FlowTransitions.Retry]: FlowStates.Playing,
    [FlowTransitions.ToMenu]: FlowStates.Menu,
  }),
  [FlowStates.Failed]: Object.freeze({
    [FlowTransitions.Retry]: FlowStates.Playing,
    [FlowTransitions.ToMenu]: FlowStates.Menu,
  }),
});

const OPTIONAL_FLOW_STATES = Object.freeze(new Set<FlowState>([FlowStates.LevelSelect, FlowStates.Paused]));

export interface FlowMachineConfig {
  readonly optionalStates?: ReadonlyArray<OptionalFlowState>;
}

export interface FlowMachine {
  readonly state: FlowState;
  /**
   * The last level id passed to `start()`/`next()`. Retained across
   * `complete`/`fail`/`pause`/`toMenu` — it is NOT cleared on failure or menu
   * return — and only reassigned by `start()`/`next()`. `undefined` until the
   * first `start()`.
   */
  readonly currentLevelId: string | undefined;
  readonly events: TypedEventEmitter<FlowEventMap>;
  start(levelId: string, meta?: FlowMeta): void;
  complete(meta?: FlowMeta): void;
  fail(meta?: FlowMeta): void;
  next(nextLevelId: string, meta?: FlowMeta): void;
  retry(meta?: FlowMeta): void;
  selectLevel(): void;
  pause(): void;
  resume(): void;
  toMenu(meta?: FlowMeta): void;
  /**
   * Would `transition` succeed from the current state right now? Answers both
   * the transition table AND optional-state enablement, mirroring the guard in
   * the internal `runTransition` minus the throw. Callers use it to avoid
   * provoking a `FlowMachineError` on a double-fire race (e.g. a double
   * `complete()`/`fail()` in one frame): guard with `if (m.can(...))`. The
   * machine itself stays strict — an illegal transition still throws.
   */
  can(transition: FlowTransition): boolean;
  /**
   * After `dispose()`, all listeners are removed and any further transition
   * throws `FlowMachineError(..., 'machine is disposed')`. A disposed machine
   * is inert and loud rather than silently mutating state.
   */
  dispose(): void;
}

export class FlowMachineError extends Error {
  readonly state: FlowState;
  readonly transition: FlowTransition;

  constructor(state: FlowState, transition: FlowTransition, reason: string) {
    super(`FlowMachine: cannot ${transition} from ${state}: ${reason}`);
    this.name = 'FlowMachineError';
    this.state = state;
    this.transition = transition;
  }
}

interface TransitionRequest {
  readonly transition: FlowTransition;
  readonly levelId?: string;
  readonly meta?: FlowMeta;
}

export function createFlowMachine(config: FlowMachineConfig = {}): FlowMachine {
  const enabledOptionalStates = new Set<FlowState>();
  for (const optionalState of config.optionalStates ?? []) {
    if (!OPTIONAL_FLOW_STATES.has(optionalState)) {
      throw new Error(`FlowMachine: unknown optional state ${String(optionalState)}`);
    }
    enabledOptionalStates.add(optionalState);
  }

  const events = createTypedEventEmitter<FlowEventMap>();
  const queuedTransitions: TransitionRequest[] = [];
  let state: FlowState = FlowStates.Boot;
  let currentLevelId: string | undefined;
  let isEmitting = false;
  let isDrainingQueue = false;
  let isDisposed = false;

  const isStateEnabled = (targetState: FlowState): boolean =>
    !OPTIONAL_FLOW_STATES.has(targetState) || enabledOptionalStates.has(targetState);

  const emit = <K extends keyof FlowEventMap>(event: K, payload: FlowEventMap[K]): void => {
    isEmitting = true;
    try {
      events.emit(event, ...([payload] as FlowEventMap[K] extends undefined ? [] : [FlowEventMap[K]]));
    } catch (err) {
      queuedTransitions.length = 0;
      throw err;
    } finally {
      isEmitting = false;
    }
  };

  const runTransition = (request: TransitionRequest): void => {
    const targetState = FLOW_TRANSITION_TABLE[state][request.transition];
    if (targetState === undefined) {
      throw new FlowMachineError(state, request.transition, 'illegal transition');
    }
    if (!isStateEnabled(targetState)) {
      throw new FlowMachineError(
        state,
        request.transition,
        `target state ${targetState} is not enabled`,
      );
    }

    const previousLevelId = currentLevelId;
    if (
      request.transition === FlowTransitions.Start ||
      request.transition === FlowTransitions.Next
    ) {
      currentLevelId = requireLevelId(state, request.transition, request.levelId);
    }

    state = targetState;

    switch (request.transition) {
      case FlowTransitions.Start:
        emit(
          'level:start',
          payloadForLevel(requireLevelId(state, request.transition, currentLevelId), request.meta),
        );
        break;
      case FlowTransitions.Complete:
        emit(
          'level:complete',
          payloadForCurrentLevel(state, currentLevelId, request.transition, request.meta),
        );
        break;
      case FlowTransitions.Fail:
        emit('level:fail', payloadForCurrentLevel(state, currentLevelId, request.transition, request.meta));
        break;
      case FlowTransitions.Next:
        emit(
          'level:next',
          payloadForNextLevel(
            state,
            previousLevelId,
            request.transition,
            requireLevelId(state, request.transition, currentLevelId),
            request.meta,
          ),
        );
        emit(
          'level:start',
          payloadForLevel(requireLevelId(state, request.transition, currentLevelId), request.meta),
        );
        break;
      case FlowTransitions.Retry:
        emit(
          'level:start',
          payloadForCurrentLevel(state, currentLevelId, request.transition, request.meta),
        );
        break;
      case FlowTransitions.ToMenu:
        emit('menu:enter', menuEnterPayload(previousLevelId ?? currentLevelId, request.meta));
        break;
      case FlowTransitions.SelectLevel:
      case FlowTransitions.Pause:
      case FlowTransitions.Resume:
        break;
    }
  };

  const transition = (request: TransitionRequest): void => {
    if (isDisposed) {
      throw new FlowMachineError(state, request.transition, 'machine is disposed');
    }
    if (isEmitting) {
      queuedTransitions.push(request);
      return;
    }
    runTransition(request);
    drainQueuedTransitions();
  };

  function drainQueuedTransitions(): void {
    if (isEmitting || isDrainingQueue || queuedTransitions.length === 0) {
      return;
    }

    isDrainingQueue = true;
    try {
      while (queuedTransitions.length > 0) {
        const request = queuedTransitions.shift();
        if (request === undefined) break;
        runTransition(request);
      }
    } catch (err) {
      queuedTransitions.length = 0;
      throw err;
    } finally {
      isDrainingQueue = false;
    }
  }

  return {
    get state(): FlowState {
      return state;
    },

    get currentLevelId(): string | undefined {
      return currentLevelId;
    },

    events,

    start(levelId: string, meta?: FlowMeta): void {
      transition({ transition: FlowTransitions.Start, levelId, meta });
    },

    complete(meta?: FlowMeta): void {
      transition({ transition: FlowTransitions.Complete, meta });
    },

    fail(meta?: FlowMeta): void {
      transition({ transition: FlowTransitions.Fail, meta });
    },

    next(nextLevelId: string, meta?: FlowMeta): void {
      transition({ transition: FlowTransitions.Next, levelId: nextLevelId, meta });
    },

    retry(meta?: FlowMeta): void {
      transition({ transition: FlowTransitions.Retry, meta });
    },

    selectLevel(): void {
      transition({ transition: FlowTransitions.SelectLevel });
    },

    pause(): void {
      transition({ transition: FlowTransitions.Pause });
    },

    resume(): void {
      transition({ transition: FlowTransitions.Resume });
    },

    toMenu(meta?: FlowMeta): void {
      transition({ transition: FlowTransitions.ToMenu, meta });
    },

    can(candidate: FlowTransition): boolean {
      if (isDisposed) {
        return false;
      }
      const target = FLOW_TRANSITION_TABLE[state][candidate];
      return target !== undefined && isStateEnabled(target);
    },

    dispose(): void {
      isDisposed = true;
      events.removeAll();
      queuedTransitions.length = 0;
    },
  };
}

function payloadForLevel(levelId: string, meta?: FlowMeta): FlowEventMap['level:start'] {
  return meta === undefined ? { levelId } : { levelId, meta };
}

function requireLevelId(
  state: FlowState,
  transition: FlowTransition,
  levelId: string | undefined,
): string {
  if (levelId === undefined || levelId.length === 0) {
    throw new FlowMachineError(state, transition, 'levelId is required');
  }
  return levelId;
}

function payloadForCurrentLevel(
  state: FlowState,
  levelId: string | undefined,
  transition: FlowTransition,
  meta?: FlowMeta,
): FlowEventMap['level:complete'] {
  if (levelId === undefined || levelId.length === 0) {
    throw new FlowMachineError(state, transition, 'currentLevelId is required');
  }
  return meta === undefined ? { levelId } : { levelId, meta };
}

function payloadForNextLevel(
  state: FlowState,
  levelId: string | undefined,
  transition: FlowTransition,
  nextLevelId: string,
  meta?: FlowMeta,
): FlowEventMap['level:next'] {
  if (levelId === undefined || levelId.length === 0) {
    throw new FlowMachineError(state, transition, 'currentLevelId is required');
  }
  return {
    levelId,
    meta: {
      ...meta,
      nextLevelId,
    },
  };
}

function menuEnterPayload(
  levelId: string | undefined,
  meta: FlowMeta | undefined,
): FlowEventMap['menu:enter'] {
  if (levelId === undefined) {
    return meta === undefined ? {} : { meta };
  }
  return meta === undefined ? { lastLevelId: levelId } : { lastLevelId: levelId, meta };
}
