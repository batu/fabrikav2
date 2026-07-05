/**
 * Canonical lifecycle event contract for the screen flow machine.
 *
 * @experimental Seed carried from v1 `shell/flow-machine.ts` with ZERO consumers.
 * It is the starting point for the screen flow machine and WILL be rewritten
 * against real consumers in the ui cards. Do not treat this event map as a
 * settled contract.
 */

export const ENDLESS_LEVEL_ID = 'endless' as const;

export type FlowMeta = Record<string, unknown>;

export interface FlowLevelEventPayload {
  readonly levelId: string;
  readonly meta?: FlowMeta;
}

export interface FlowLevelNextEventPayload {
  readonly levelId: string;
  readonly meta: FlowMeta & {
    readonly nextLevelId: string;
  };
}

export interface FlowMenuEnterPayload {
  readonly lastLevelId?: string;
  readonly meta?: FlowMeta;
}

export type FlowEventMap = {
  readonly 'level:start': FlowLevelEventPayload;
  readonly 'level:complete': FlowLevelEventPayload;
  readonly 'level:fail': FlowLevelEventPayload;
  readonly 'level:next': FlowLevelNextEventPayload;
  readonly 'menu:enter': FlowMenuEnterPayload;
};
