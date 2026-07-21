// The durable-job state-action matrix (R28/AE20 scenario 9).
//
// Durable state and connection state are separate inputs on purpose: the
// matrix row is chosen by the durable status alone, and `reconnecting` is a
// presentation-only overlay that suspends controls while the observer cannot
// reach the server. Connection state never changes Job state.

import type { JobResource } from '../api/generated.ts';

export type DurableViewState =
  | 'queued'
  | 'running'
  | 'waiting_provider'
  | 'cancel_requested'
  | 'cancelled'
  | 'failed_retryable'
  | 'failed_terminal'
  | 'orphaned_unknown'
  | 'succeeded'
  | 'succeeded_unapplied';

export type JobViewState = DurableViewState | 'reconnecting';

export function durableViewState(job: JobResource): DurableViewState {
  switch (job.status) {
    case 'queued':
      return 'queued';
    case 'running':
    case 'downloading':
    case 'finalizing':
      return 'running';
    case 'submitted':
    case 'polling':
      return 'waiting_provider';
    case 'cancel_requested':
      return 'cancel_requested';
    case 'cancelled':
      return 'cancelled';
    case 'failed_retryable':
      return 'failed_retryable';
    case 'failed_terminal':
      return 'failed_terminal';
    case 'orphaned_unknown':
      return 'orphaned_unknown';
    case 'succeeded':
      return job.result['application'] === 'conflict' ? 'succeeded_unapplied' : 'succeeded';
    default:
      // An unknown durable status must never unlock controls.
      return 'orphaned_unknown';
  }
}

export function jobViewState(
  job: JobResource | null,
  connection: 'idle' | 'connected' | 'reconnecting' | 'stopped',
): JobViewState {
  if (job === null || connection === 'reconnecting') return 'reconnecting';
  return durableViewState(job);
}

export interface StateActionRow {
  copy: string;
  // Announcement text for the aria-live region; status is words, never color.
  announcement: string;
  canCancel: boolean;
  canRetry: boolean;
  forceNew: 'no' | 'with_grant';
  artifactAccess: 'none' | 'inspect' | 'inspect_and_apply';
}

export const JOB_STATE_ACTIONS: Record<JobViewState, StateActionRow> = {
  queued: {
    copy: 'Waiting for the editor worker.',
    announcement: 'Job queued.',
    canCancel: true,
    canRetry: false,
    forceNew: 'no',
    artifactAccess: 'none',
  },
  running: {
    copy: 'The worker is running this job.',
    announcement: 'Job running.',
    canCancel: true,
    canRetry: false,
    forceNew: 'no',
    artifactAccess: 'none',
  },
  waiting_provider: {
    copy: 'Submitted to the provider; cancel reconciles with the provider.',
    announcement: 'Job waiting on the provider.',
    canCancel: true,
    canRetry: false,
    forceNew: 'no',
    artifactAccess: 'none',
  },
  reconnecting: {
    copy: 'Connection lost; the durable job is unaffected and the observer keeps retrying.',
    announcement: 'Reconnecting to the editor. The job itself is unchanged.',
    canCancel: false,
    canRetry: false,
    forceNew: 'no',
    artifactAccess: 'none',
  },
  cancel_requested: {
    copy: 'Cancellation requested; the worker is reconciling.',
    announcement: 'Cancellation requested.',
    canCancel: false,
    canRetry: false,
    forceNew: 'no',
    artifactAccess: 'none',
  },
  cancelled: {
    copy: 'Cancelled. Any retained output stays inspectable.',
    announcement: 'Job cancelled.',
    canCancel: false,
    canRetry: false,
    forceNew: 'with_grant',
    artifactAccess: 'inspect',
  },
  failed_retryable: {
    copy: 'Failed before any provider spend; retry is free of a new grant.',
    announcement: 'Job failed and can be retried.',
    canCancel: false,
    canRetry: true,
    forceNew: 'with_grant',
    artifactAccess: 'inspect',
  },
  failed_terminal: {
    copy: 'Failed permanently. Starting over requires an explicit approval grant.',
    announcement: 'Job failed permanently.',
    canCancel: false,
    canRetry: false,
    forceNew: 'with_grant',
    artifactAccess: 'inspect',
  },
  orphaned_unknown: {
    copy: 'The provider outcome is unknown; retry is blocked because it could pay twice. Force-new requires an approval grant.',
    announcement: 'Job outcome unknown. Retry is not available.',
    canCancel: false,
    canRetry: false,
    forceNew: 'with_grant',
    artifactAccess: 'inspect',
  },
  succeeded: {
    copy: 'Succeeded and applied to the session.',
    announcement: 'Job succeeded.',
    canCancel: false,
    canRetry: false,
    forceNew: 'no',
    artifactAccess: 'inspect',
  },
  succeeded_unapplied: {
    copy: 'Succeeded, but the session moved on; the paid output is retained. Apply it explicitly to the current revision.',
    announcement: 'Job succeeded with an unapplied result that can be applied to the current session.',
    canCancel: false,
    canRetry: false,
    forceNew: 'no',
    artifactAccess: 'inspect_and_apply',
  },
};

export function stateActionsFor(
  job: JobResource | null,
  connection: 'idle' | 'connected' | 'reconnecting' | 'stopped',
): StateActionRow {
  return JOB_STATE_ACTIONS[jobViewState(job, connection)];
}
