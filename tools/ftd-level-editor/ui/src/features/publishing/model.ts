import type {
  CandidateResponse,
  PublishingSnapshotResponse,
  SagaResponse,
} from '../../api/generated.ts';

export type PublishingCandidate = CandidateResponse;
export type PublishSaga = SagaResponse;
export type PublishingSnapshot = PublishingSnapshotResponse;
export type PublishSagaStatus = PublishSaga['status'];
export type ApprovalAction = 'publish_sequence' | 'rollback_sequence';

const COPY: Record<PublishSagaStatus, { label: string; detail: string; tone: string }> = {
  pending_remote: {
    label: 'Pending remote response',
    detail: 'The exact digest is awaiting a publisher response. Current selection is unchanged.',
    tone: 'waiting',
  },
  reconciling: {
    label: 'Reconciling by readback',
    detail: 'The outcome is ambiguous. Read back the exact hash; do not republish.',
    tone: 'waiting',
  },
  remote_committed: {
    label: 'Remote hash confirmed',
    detail: 'Remote identity matches. Local selection still needs durable finalization.',
    tone: 'progress',
  },
  finalizing: {
    label: 'Finalizing local selection',
    detail: 'The validated immutable candidate is becoming the selected sequence.',
    tone: 'progress',
  },
  succeeded: {
    label: 'Sequence selected',
    detail: 'The selected manifest points at the approved immutable candidate.',
    tone: 'success',
  },
  failed: {
    label: 'Publication failed',
    detail: 'Selection was not changed. Review the error before preparing a new attempt.',
    tone: 'danger',
  },
};

export function publishingStatusCopy(status: PublishSagaStatus) {
  return COPY[status];
}

export function publishingAnnouncement(saga: Pick<PublishSaga, 'status' | 'action'>): string {
  const copy = publishingStatusCopy(saga.status);
  return `${saga.action === 'rollback' ? 'Rollback' : 'Publication'}: ${copy.label}. ${copy.detail}`;
}

export function isUnfinishedSagaStatus(status: PublishSagaStatus): boolean {
  return ['pending_remote', 'reconciling', 'remote_committed', 'finalizing'].includes(status);
}

export function grantAcknowledgement(action: ApprovalAction, digest: string): string {
  return `I approve ${action} for ${digest}`;
}

export function retainedCandidates(
  candidates: PublishingCandidate[],
  selected: PublishingCandidate | null,
  eligibleCandidateIds: string[],
): PublishingCandidate[] {
  const eligible = new Set(eligibleCandidateIds);
  return candidates
    .filter((candidate) => (
      candidate.candidateId !== selected?.candidateId
      && eligible.has(candidate.candidateId)
    ))
    .sort((left, right) => right.sequenceVersion.localeCompare(left.sequenceVersion));
}
