// Lineup feature adapter: the sequence-workflow start moves onto the same
// durable POST + polling observer lifecycle as every wizard start (R23).

import {
  type DurableStart,
  type DurableStartContext,
  startDurable,
} from '../wizard/durableStarts.ts';

export function startSequenceWorkflow(
  context: DurableStartContext,
  inputs: { scenes: string[] },
): Promise<DurableStart> {
  return startDurable(context, 'ftd.sequence_workflow', inputs);
}
