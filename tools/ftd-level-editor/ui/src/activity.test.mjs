import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  activityAnnouncement,
  buildActivityEntries,
  buildActivityEntry,
  featureRouteForKind,
} from './jobs/activity.ts';

function makeJob(overrides = {}) {
  return {
    jobId: 'job-1',
    kind: 'ftd.background_generate',
    sessionId: 'level-01',
    requestId: 'req-1',
    inputHash: 'sha256:abc',
    status: 'running',
    stage: 'running',
    retryable: false,
    error: null,
    result: {},
    attempt: { reason: 'initial', previousAttemptId: null, supersededBy: null },
    artifacts: [],
    createdAt: '2026-07-21T12:00:00Z',
    updatedAt: '2026-07-21T12:00:00Z',
    completedAt: null,
    ...overrides,
  };
}

describe('activity recovery', () => {
  it('AE20: lists many recovered jobs, active first, most recent first, without duplicates', () => {
    const jobs = [
      makeJob({ jobId: 'done-old', status: 'succeeded', createdAt: '2026-07-21T09:00:00Z' }),
      makeJob({ jobId: 'active-old', status: 'polling', createdAt: '2026-07-21T10:00:00Z' }),
      makeJob({ jobId: 'active-new', status: 'queued', createdAt: '2026-07-21T11:00:00Z' }),
      makeJob({ jobId: 'active-old', status: 'polling', createdAt: '2026-07-21T10:00:00Z' }),
    ];
    const entries = buildActivityEntries(jobs, () => 'connected');
    assert.deepEqual(
      entries.map((entry) => entry.job.jobId),
      ['active-new', 'active-old', 'done-old'],
    );
  });

  it('keeps durable and connection status as separate word labels', () => {
    const entry = buildActivityEntry(makeJob({ status: 'polling' }), 'reconnecting');
    assert.equal(entry.durableStatusLabel, 'waiting provider');
    assert.equal(entry.connectionStatusLabel, 'Reconnecting');
    assert.equal(entry.viewState, 'reconnecting');
  });

  it('marks retained artifacts on conflicted success and offers explicit apply', () => {
    const artifact = {
      artifactId: 'art-1',
      displayName: 'background.png',
      mediaType: 'image/png',
      checksum: 'sha256:def',
      size: 10,
    };
    const entry = buildActivityEntry(
      makeJob({ status: 'succeeded', result: { application: 'conflict' }, artifacts: [artifact] }),
      'connected',
    );
    assert.equal(entry.hasRetainedArtifacts, true);
    assert.equal(entry.actions.artifactAccess, 'inspect_and_apply');
  });

  it('routes each recovered job back to its originating feature', () => {
    assert.equal(featureRouteForKind('ftd.background_generate'), '/wizard/background');
    assert.equal(featureRouteForKind('ftd.sequence_workflow'), '/lineup/sequence');
    assert.equal(featureRouteForKind('ftd.unknown_kind'), '/activity');
  });

  it('announces status changes as words including the job kind', () => {
    const entry = buildActivityEntry(makeJob({ status: 'orphaned_unknown' }), 'connected');
    assert.equal(
      activityAnnouncement(entry),
      'ftd.background_generate: Job outcome unknown. Retry is not available.',
    );
  });
});
