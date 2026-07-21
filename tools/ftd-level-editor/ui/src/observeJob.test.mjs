import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_BACKOFF,
  backoffDelayMs,
  ingestEvents,
  isTerminalJobStatus,
  observeJob,
} from './jobs/observeJob.ts';

function makeJob(overrides = {}) {
  return {
    jobId: 'job-1',
    kind: 'ftd.background_generate',
    sessionId: 'level-01',
    requestId: 'req-1',
    inputHash: 'sha256:abc',
    status: 'queued',
    stage: 'queued',
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

function makeEvent(id, eventType = 'job.progress') {
  return { id, eventType, message: null, data: {}, createdAt: '2026-07-21T12:00:00Z' };
}

// A scripted durable backend with an injectable stop/restart switch. While
// `down` is true every read rejects, exactly like a killed API process; the
// durable state object is untouched by downtime.
function fakeServer(initialJob) {
  const state = { job: initialJob, events: [makeEvent(1, 'job.created')], down: false };
  const guard = () => {
    if (state.down) throw new Error('api stopped');
  };
  const transport = {
    async startAction() {
      guard();
      return state.job;
    },
    async getJob() {
      guard();
      return state.job;
    },
    async listJobs(query) {
      guard();
      const matches =
        (!query.requestId || state.job.requestId === query.requestId) &&
        (!query.sessionId || state.job.sessionId === query.sessionId);
      return matches ? [state.job] : [];
    },
    async listEvents(_jobId, after) {
      guard();
      return state.events.filter((event) => event.id > after);
    },
    async cancelJob() {
      guard();
      return state.job;
    },
    async retryJob() {
      guard();
      return state.job;
    },
    async forceNewJob() {
      guard();
      return state.job;
    },
    artifactUrl: (jobId, artifactId) => `/api/jobs/${jobId}/artifacts/${artifactId}`,
  };
  return { state, transport };
}

describe('event ingestion', () => {
  it('deduplicates out-of-order replay into one ordered once-only sequence', () => {
    const first = [makeEvent(1), makeEvent(3)];
    const replay = [makeEvent(2), makeEvent(3), makeEvent(1), makeEvent(4)];
    const { events, cursor } = ingestEvents(first, replay);
    assert.deepEqual(
      events.map((event) => event.id),
      [1, 2, 3, 4],
    );
    assert.equal(cursor, 4);
  });
});

describe('backoff', () => {
  it('is bounded and never introduces a terminal timeout', () => {
    assert.equal(backoffDelayMs(DEFAULT_BACKOFF, 0), 500);
    assert.equal(backoffDelayMs(DEFAULT_BACKOFF, 1), 1000);
    assert.equal(backoffDelayMs(DEFAULT_BACKOFF, 100), DEFAULT_BACKOFF.maxMs);
    assert.equal(backoffDelayMs(DEFAULT_BACKOFF, 10_000), DEFAULT_BACKOFF.maxMs);
  });
});

describe('observeJob', () => {
  it('AE6: one failed read shows only reconnecting, then the same job runs and succeeds with each event once', async () => {
    const { state, transport } = fakeServer(makeJob());
    const observer = observeJob({
      transport,
      requestId: 'req-1',
      sessionId: 'level-01',
      jobId: 'job-1',
    });

    let snapshot = await observer.pollOnce();
    assert.equal(snapshot.job.status, 'queued');
    assert.equal(snapshot.connection, 'connected');

    state.down = true; // injected API stop
    snapshot = await observer.pollOnce();
    assert.equal(snapshot.connection, 'reconnecting');
    // durable snapshot, identity, and cursor are preserved untouched
    assert.equal(snapshot.job.status, 'queued');
    assert.equal(snapshot.jobId, 'job-1');
    assert.equal(snapshot.eventCursor, 1);

    state.down = false; // injected API restart
    state.job = makeJob({ status: 'running', stage: 'painting' });
    state.events.push(makeEvent(2, 'job.claimed'));
    snapshot = await observer.pollOnce();
    assert.equal(snapshot.connection, 'connected');
    assert.equal(snapshot.job.status, 'running');

    state.job = makeJob({ status: 'succeeded', completedAt: '2026-07-21T12:05:00Z' });
    state.events.push(makeEvent(3, 'job.succeeded'));
    const final = await observer.run(async () => {});
    assert.equal(final.job.status, 'succeeded');
    assert.equal(final.jobId, 'job-1');
    assert.deepEqual(
      final.events.map((event) => event.id),
      [1, 2, 3],
    );
  });

  it('disconnect and reconnect never change durable job status', async () => {
    const { state, transport } = fakeServer(makeJob({ status: 'running' }));
    const observer = observeJob({
      transport,
      requestId: 'req-1',
      sessionId: 'level-01',
      jobId: 'job-1',
    });
    await observer.pollOnce();
    const durableBefore = JSON.parse(JSON.stringify(state.job));
    state.down = true;
    await observer.pollOnce();
    await observer.pollOnce();
    state.down = false;
    await observer.pollOnce();
    assert.deepEqual(state.job, durableBefore);
  });

  it('AE5a: a reload holding only the pending Request ID rediscovers the job from the server', async () => {
    const { transport } = fakeServer(makeJob({ status: 'polling' }));
    const observer = observeJob({ transport, requestId: 'req-1', sessionId: 'level-01' });
    const snapshot = await observer.pollOnce();
    assert.equal(snapshot.jobId, 'job-1');
    assert.equal(snapshot.job.status, 'polling');
  });

  it('a pending Request ID the server has never seen stays connected with no job', async () => {
    const { transport } = fakeServer(makeJob());
    const observer = observeJob({ transport, requestId: 'req-unknown', sessionId: 'level-01' });
    const snapshot = await observer.pollOnce();
    assert.equal(snapshot.jobId, null);
    assert.equal(snapshot.connection, 'connected');
  });

  it('AE7: stopping the observer detaches without touching the durable job', async () => {
    const { state, transport } = fakeServer(makeJob({ status: 'running' }));
    const observer = observeJob({
      transport,
      requestId: 'req-1',
      sessionId: 'level-01',
      jobId: 'job-1',
    });
    await observer.pollOnce();
    observer.stop();
    assert.equal(observer.state().connection, 'stopped');
    assert.equal(state.job.status, 'running');
    // a stopped observer never polls again
    state.down = true;
    const after = await observer.pollOnce();
    assert.equal(after.connection, 'stopped');
  });

  it('run() stops only on a terminal durable status, waiting through repeated failures', async () => {
    const { state, transport } = fakeServer(makeJob({ status: 'running' }));
    const observer = observeJob({
      transport,
      requestId: 'req-1',
      sessionId: 'level-01',
      jobId: 'job-1',
    });
    let polls = 0;
    state.down = true;
    const done = observer.run(async () => {
      polls += 1;
      if (polls === 4) {
        state.down = false;
        state.job = makeJob({ status: 'failed_retryable', retryable: true });
      }
    });
    const final = await done;
    assert.ok(polls >= 4);
    assert.equal(final.job.status, 'failed_retryable');
    assert.ok(isTerminalJobStatus(final.job.status));
  });

  it('two concurrent observers converge on equivalent ordered events', async () => {
    const { state, transport } = fakeServer(makeJob({ status: 'running' }));
    state.events.push(makeEvent(2), makeEvent(3));
    const makeObserver = () =>
      observeJob({ transport, requestId: 'req-1', sessionId: 'level-01', jobId: 'job-1' });
    const one = makeObserver();
    const two = makeObserver();
    const [snapOne, snapTwo] = [await one.pollOnce(), await two.pollOnce()];
    assert.deepEqual(snapOne.events, snapTwo.events);
    assert.deepEqual(
      snapOne.events.map((event) => event.id),
      [1, 2, 3],
    );
  });
});
