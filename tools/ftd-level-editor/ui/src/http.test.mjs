import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { FtdHttpError, createJobsTransport } from './api/http.ts';

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function recordingFetch(response = jsonResponse({})) {
  const calls = [];
  const fetchImpl = async (path, init) => {
    calls.push({ path, init });
    return response;
  };
  return { calls, fetchImpl };
}

describe('createJobsTransport', () => {
  it('forms a durable start: POST to the kind path with credential, JSON body, and abort signal', async () => {
    const { calls, fetchImpl } = recordingFetch(jsonResponse({ jobId: 'job-1' }));
    const transport = createJobsTransport({ fetchImpl, launchCredential: 'cred-1' });
    const body = { requestId: 'req-1', sessionId: 'level-01', revision: 'r1', inputs: {} };
    const job = await transport.startAction('ftd.background_generate', body);
    assert.equal(job.jobId, 'job-1');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].path, '/api/jobs/actions/ftd.background_generate');
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.credentials, 'same-origin');
    assert.equal(calls[0].init.headers['X-FTD-Launch-Credential'], 'cred-1');
    assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(calls[0].init.body), body);
    assert.equal(typeof calls[0].init.signal?.aborted, 'boolean');
  });

  it('forms reads: job, filtered job list, and events-after-cursor paths', async () => {
    const { calls, fetchImpl } = recordingFetch(jsonResponse([]));
    const transport = createJobsTransport({ fetchImpl, launchCredential: 'cred-1' });
    await transport.getJob('job 1');
    await transport.listJobs({ sessionId: 'level-01', requestId: 'req-1' });
    await transport.listJobs({});
    await transport.listEvents('job-1', 7);
    assert.equal(calls[0].path, '/api/jobs/job%201');
    assert.equal(calls[0].init.method, 'GET');
    assert.equal(calls[0].init.body, undefined);
    assert.equal(calls[1].path, '/api/jobs?sessionId=level-01&requestId=req-1');
    assert.equal(calls[2].path, '/api/jobs');
    assert.equal(calls[3].path, '/api/jobs/job-1/events?after=7');
  });

  it('forms lifecycle actions and artifact URLs', async () => {
    const { calls, fetchImpl } = recordingFetch(jsonResponse({}));
    const transport = createJobsTransport({ fetchImpl, launchCredential: 'cred-1' });
    await transport.cancelJob('job-1');
    await transport.retryJob('job-1');
    await transport.forceNewJob('job-1', 'ftd.band_generate', { grant: 'with_grant' });
    assert.equal(calls[0].path, '/api/jobs/job-1/cancel');
    assert.equal(calls[1].path, '/api/jobs/job-1/retry');
    assert.equal(calls[2].path, '/api/jobs/job-1/force-new/ftd.band_generate');
    assert.equal(
      transport.artifactUrl('job-1', 'art 9'),
      '/api/jobs/job-1/artifacts/art%209',
    );
  });

  it('throws FtdHttpError carrying status and the JSON conflict detail on non-2xx', async () => {
    const detail = { code: 'request_identity_conflict', requestId: 'req-1' };
    const { fetchImpl } = recordingFetch(jsonResponse(detail, 409));
    const transport = createJobsTransport({ fetchImpl, launchCredential: 'cred-1' });
    await assert.rejects(
      () => transport.getJob('job-1'),
      (error) => {
        assert.ok(error instanceof FtdHttpError);
        assert.equal(error.status, 409);
        assert.deepEqual(error.detail, detail);
        return true;
      },
    );
  });

  it('falls back to null detail when an error body is not JSON', async () => {
    const { fetchImpl } = recordingFetch({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('not json');
      },
    });
    const transport = createJobsTransport({ fetchImpl, launchCredential: 'cred-1' });
    await assert.rejects(
      () => transport.getJob('job-1'),
      (error) => error instanceof FtdHttpError && error.status === 502 && error.detail === null,
    );
  });

  it('aborts a hung request after timeoutMs so the observer sees an ordinary failed read', async () => {
    const fetchImpl = (_path, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')));
      });
    const transport = createJobsTransport({
      fetchImpl,
      launchCredential: 'cred-1',
      timeoutMs: 10,
    });
    await assert.rejects(() => transport.getJob('job-1'), /aborted/);
  });
});
