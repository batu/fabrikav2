import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  JOB_STATE_ACTIONS,
  durableViewState,
  jobViewState,
  stateActionsFor,
} from './jobs/jobStateActions.ts';

function makeJob(status, result = {}) {
  return {
    jobId: 'job-1',
    kind: 'ftd.background_generate',
    sessionId: 'level-01',
    requestId: 'req-1',
    inputHash: 'sha256:abc',
    status,
    stage: status,
    retryable: status === 'failed_retryable',
    error: null,
    result,
    attempt: { reason: 'initial', previousAttemptId: null, supersededBy: null },
    artifacts: [],
    createdAt: '2026-07-21T12:00:00Z',
    updatedAt: '2026-07-21T12:00:00Z',
    completedAt: null,
  };
}

describe('durable view state', () => {
  it('maps every backend status onto exactly one matrix row', () => {
    assert.equal(durableViewState(makeJob('queued')), 'queued');
    assert.equal(durableViewState(makeJob('running')), 'running');
    assert.equal(durableViewState(makeJob('downloading')), 'running');
    assert.equal(durableViewState(makeJob('finalizing')), 'running');
    assert.equal(durableViewState(makeJob('submitted')), 'waiting_provider');
    assert.equal(durableViewState(makeJob('polling')), 'waiting_provider');
    assert.equal(durableViewState(makeJob('cancel_requested')), 'cancel_requested');
    assert.equal(durableViewState(makeJob('cancelled')), 'cancelled');
    assert.equal(durableViewState(makeJob('failed_retryable')), 'failed_retryable');
    assert.equal(durableViewState(makeJob('failed_terminal')), 'failed_terminal');
    assert.equal(durableViewState(makeJob('orphaned_unknown')), 'orphaned_unknown');
    assert.equal(durableViewState(makeJob('succeeded')), 'succeeded');
  });

  it('distinguishes succeeded-with-unapplied-artifact by the durable application marker', () => {
    assert.equal(
      durableViewState(makeJob('succeeded', { application: 'conflict' })),
      'succeeded_unapplied',
    );
    assert.equal(
      durableViewState(makeJob('succeeded', { application: 'applied' })),
      'succeeded',
    );
  });

  it('locks controls for an unknown durable status', () => {
    assert.equal(durableViewState(makeJob('status_from_the_future')), 'orphaned_unknown');
  });
});

describe('connection overlay', () => {
  it('reconnecting is presentation-only: it comes from connection state, never from the job', () => {
    const running = makeJob('running');
    assert.equal(jobViewState(running, 'connected'), 'running');
    assert.equal(jobViewState(running, 'reconnecting'), 'reconnecting');
    assert.equal(jobViewState(null, 'connected'), 'reconnecting');
  });

  it('suspends every mutating control while reconnecting', () => {
    const row = stateActionsFor(makeJob('running'), 'reconnecting');
    assert.equal(row.canCancel, false);
    assert.equal(row.canRetry, false);
    assert.equal(row.forceNew, 'no');
  });
});

describe('state-action matrix', () => {
  it('covers every view state with copy, announcement, and an explicit grant posture', () => {
    for (const [state, row] of Object.entries(JOB_STATE_ACTIONS)) {
      assert.ok(row.copy.length > 0, `${state} needs copy`);
      assert.ok(row.announcement.length > 0, `${state} needs an announcement`);
      assert.ok(['no', 'with_grant'].includes(row.forceNew), `${state} grant posture`);
      assert.ok(
        ['none', 'inspect', 'inspect_and_apply'].includes(row.artifactAccess),
        `${state} artifact access`,
      );
    }
  });

  it('orphaned_unknown can never retry; starting over demands a grant', () => {
    const row = JOB_STATE_ACTIONS.orphaned_unknown;
    assert.equal(row.canRetry, false);
    assert.equal(row.forceNew, 'with_grant');
  });

  it('only definitive retryable failure retries grant-free', () => {
    for (const [state, row] of Object.entries(JOB_STATE_ACTIONS)) {
      assert.equal(row.canRetry, state === 'failed_retryable', state);
    }
  });

  it('only active durable states can cancel', () => {
    const cancellable = Object.entries(JOB_STATE_ACTIONS)
      .filter(([, row]) => row.canCancel)
      .map(([state]) => state)
      .sort();
    assert.deepEqual(cancellable, ['queued', 'running', 'waiting_provider']);
  });

  it('retained artifacts get an explicit apply only in succeeded_unapplied', () => {
    for (const [state, row] of Object.entries(JOB_STATE_ACTIONS)) {
      assert.equal(
        row.artifactAccess === 'inspect_and_apply',
        state === 'succeeded_unapplied',
        state,
      );
    }
  });
});
