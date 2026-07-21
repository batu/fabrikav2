// Lineup feature adapter: the sequence-workflow start moves onto the same
// durable POST + polling observer lifecycle as every wizard start (R23).

import { observeJob } from '../../jobs/observeJob.ts';
import type { DurableStart, DurableStartContext } from '../wizard/durableStarts.ts';

export async function startSequenceWorkflow(
  context: DurableStartContext,
  inputs: { sequenceName: string; levelIds: string[] },
): Promise<DurableStart> {
  const job = await context.transport.startAction('ftd.sequence_workflow', {
    requestId: context.requestId,
    sessionId: context.sessionId,
    revision: context.revision,
    inputs,
  });
  const observer = observeJob({
    transport: context.transport,
    requestId: context.requestId,
    sessionId: context.sessionId,
    jobId: job.jobId,
  });
  return { job, observer };
}
