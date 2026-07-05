/**
 * @experimental Screen flow machine seed — carried from v1 `shell/flow-machine.ts`
 * with ZERO consumers. It WILL be rewritten against real consumers in the ui cards.
 * Do not treat this surface as a settled contract.
 */

export {
  FLOW_TRANSITION_TABLE,
  FlowMachineError,
  FlowStates,
  FlowTransitions,
  createFlowMachine,
} from './machine.ts';
export { ENDLESS_LEVEL_ID } from './events.ts';
export type {
  FlowMachine,
  FlowMachineConfig,
  FlowState,
  FlowTransition,
  OptionalFlowState,
} from './machine.ts';
export type {
  FlowEventMap,
  FlowLevelEventPayload,
  FlowLevelNextEventPayload,
  FlowMenuEnterPayload,
  FlowMeta,
} from './events.ts';
