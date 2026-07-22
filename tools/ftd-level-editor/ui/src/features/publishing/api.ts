import { requestFtd, type JobsTransportOptions } from '../../api/http.ts';
import type {
  ApprovalGrantResponse,
  PrepareSequenceRequest,
} from '../../api/generated.ts';
import {
  grantAcknowledgement,
  type PublishSaga,
  type PublishingCandidate,
  type PublishingSnapshot,
} from './model.ts';

export type PreparePublishingInput = PrepareSequenceRequest;

const PROTECTED_ACTION = {
  publish: { approval: 'publish_sequence', endpoint: 'activate' },
  rollback: { approval: 'rollback_sequence', endpoint: 'rollback' },
} as const;

export function createPublishingApi(options: JobsTransportOptions) {
  const request = <T>(method: 'GET' | 'POST', path: string, body?: unknown) =>
    requestFtd<T>(options, method, path, body);

  async function protectedAction(
    candidate: PublishingCandidate,
    kind: PublishSaga['action'],
    remote: boolean,
  ): Promise<PublishSaga> {
    const action = PROTECTED_ACTION[kind];
    const grant = await request<ApprovalGrantResponse>('POST', '/api/approvals', {
      actor: candidate.actor,
      actionKind: action.approval,
      requestBinding: candidate.digest,
      sourceRevision: candidate.sourceRevision,
      acknowledgement: grantAcknowledgement(action.approval, candidate.digest),
    });
    return request('POST', `/api/publishing/${action.endpoint}`, {
      candidateId: candidate.candidateId,
      grantId: grant.grantId,
      remote,
    });
  }

  return {
    snapshot: () => request<PublishingSnapshot>('GET', '/api/publishing'),
    prepare: (input: PreparePublishingInput) =>
      request<PublishingCandidate>('POST', '/api/publishing/previews', input),
    activate: (candidate: PublishingCandidate, remote: boolean) =>
      protectedAction(candidate, 'publish', remote),
    rollback: (candidate: PublishingCandidate, remote: boolean) =>
      protectedAction(candidate, 'rollback', remote),
    reconcile: (sagaId: string) =>
      request<PublishSaga>('POST', `/api/publishing/sagas/${encodeURIComponent(sagaId)}/reconcile`),
  };
}
