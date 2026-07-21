// Typed HTTP access to the durable job API. One transport serves the React UI
// and any coding agent; both consume the generated OpenAPI wire types.

import type {
  ForceNewJobRequest,
  JobEventResponse,
  JobResource,
  StartJobRequest,
} from './generated.ts';

export interface JobsTransportOptions {
  fetchImpl: typeof fetch;
  launchCredential: string;
}

export class FtdHttpError extends Error {
  readonly status: number;
  readonly detail: unknown;

  constructor(status: number, detail: unknown) {
    super(`FTD editor request failed (${status})`);
    this.status = status;
    this.detail = detail;
  }
}

export interface JobsTransport {
  startAction(kind: string, body: StartJobRequest): Promise<JobResource>;
  getJob(jobId: string): Promise<JobResource>;
  listJobs(query: { sessionId?: string; requestId?: string }): Promise<JobResource[]>;
  listEvents(jobId: string, after: number): Promise<JobEventResponse[]>;
  cancelJob(jobId: string): Promise<JobResource>;
  retryJob(jobId: string): Promise<JobResource>;
  forceNewJob(jobId: string, kind: string, body: ForceNewJobRequest): Promise<JobResource>;
  artifactUrl(jobId: string, artifactId: string): string;
}

export function createJobsTransport(options: JobsTransportOptions): JobsTransport {
  const request = async <T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> => {
    const response = await options.fetchImpl(path, {
      method,
      credentials: 'same-origin',
      headers: {
        'X-FTD-Launch-Credential': options.launchCredential,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      let detail: unknown = null;
      try {
        detail = (await response.json()) as unknown;
      } catch {
        detail = null;
      }
      throw new FtdHttpError(response.status, detail);
    }
    return (await response.json()) as T;
  };

  return {
    startAction: (kind, body) =>
      request('POST', `/api/jobs/actions/${encodeURIComponent(kind)}`, body),
    getJob: (jobId) => request('GET', `/api/jobs/${encodeURIComponent(jobId)}`),
    listJobs: (query) => {
      const params = new URLSearchParams();
      if (query.sessionId) params.set('sessionId', query.sessionId);
      if (query.requestId) params.set('requestId', query.requestId);
      const suffix = params.size > 0 ? `?${params.toString()}` : '';
      return request('GET', `/api/jobs${suffix}`);
    },
    listEvents: (jobId, after) =>
      request('GET', `/api/jobs/${encodeURIComponent(jobId)}/events?after=${after}`),
    cancelJob: (jobId) => request('POST', `/api/jobs/${encodeURIComponent(jobId)}/cancel`),
    retryJob: (jobId) => request('POST', `/api/jobs/${encodeURIComponent(jobId)}/retry`),
    forceNewJob: (jobId, kind, body) =>
      request(
        'POST',
        `/api/jobs/${encodeURIComponent(jobId)}/force-new/${encodeURIComponent(kind)}`,
        body,
      ),
    artifactUrl: (jobId, artifactId) =>
      `/api/jobs/${encodeURIComponent(jobId)}/artifacts/${encodeURIComponent(artifactId)}`,
  };
}
