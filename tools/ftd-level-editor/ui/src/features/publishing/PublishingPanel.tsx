import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';

import {
  grantAcknowledgement,
  isUnfinishedSagaStatus,
  publishingAnnouncement,
  publishingStatusCopy,
  retainedCandidates,
  type PublishingCandidate,
  type PublishingSnapshot,
} from './model.ts';
import type { PreparePublishingInput } from './api.ts';

interface PublishingPanelProps {
  snapshot: PublishingSnapshot;
  busy: boolean;
  error: string | null;
  onPrepare(input: PreparePublishingInput): Promise<void>;
  onActivate(candidate: PublishingCandidate, humanApprovalCredential: string): Promise<void>;
  onRollback(candidate: PublishingCandidate, humanApprovalCredential: string): Promise<void>;
  onReconcile(sagaId: string): Promise<void>;
}

export function PublishingPanel({
  snapshot,
  busy,
  error,
  onPrepare,
  onActivate,
  onRollback,
  onReconcile,
}: PublishingPanelProps) {
  const [confirmedCandidateId, setConfirmedCandidateId] = useState<string | null>(null);
  const [humanApprovalCredential, setHumanApprovalCredential] = useState('');
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const newestCandidate = snapshot.candidates.at(-1) ?? null;
  const newestSaga = snapshot.sagas.at(-1) ?? null;
  const hasUnfinishedSaga = snapshot.sagas.some((saga) => isUnfinishedSagaStatus(saga.status));
  const retained = useMemo(
    () => retainedCandidates(
      snapshot.candidates,
      snapshot.selected,
      snapshot.rollbackEligibleCandidateIds,
    ),
    [snapshot.candidates, snapshot.selected, snapshot.rollbackEligibleCandidateIds],
  );

  useEffect(() => {
    if (newestSaga !== null) resultHeading.current?.focus();
  }, [newestSaga?.sagaId, newestSaga?.status]);

  async function submitPreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? '').trim();
    await onPrepare({
      sequenceVersion: value('sequenceVersion'),
      levelIds: value('levelIds').split(',').map((levelId) => levelId.trim()).filter(Boolean),
      catalogRevision: value('catalogRevision'),
      sourceRevision: value('sourceRevision'),
      changelog: value('changelog'),
      actor: value('actor'),
    });
  }

  async function submitHumanAction(
    action: (candidate: PublishingCandidate, credential: string) => Promise<void>,
    candidate: PublishingCandidate,
  ) {
    const credential = humanApprovalCredential;
    setHumanApprovalCredential('');
    await action(candidate, credential);
  }

  return (
    <section className="publishing" aria-labelledby="publishing-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Release control</p>
          <h2 id="publishing-title">Sequence publishing</h2>
        </div>
        <span className={`authority ${snapshot.remoteEnabled ? 'enabled' : 'disabled'}`}>
          {snapshot.remoteEnabled ? 'Authenticated publisher' : 'Remote publishing disabled'}
        </span>
      </div>

      <div className="publishing-grid">
        <form className="publish-form" onSubmit={submitPreview}>
          <fieldset disabled={busy}>
            <legend>Prepare immutable preview</legend>
            <div className="field-pair">
              <label>
                Sequence version
                <input required name="sequenceVersion" placeholder="seq-2026-07-22" />
              </label>
              <label>
                Catalog revision
                <input required name="catalogRevision" placeholder="catalog-000053" />
              </label>
            </div>
            <label>
              Ordered level IDs
              <textarea required name="levelIds" placeholder="starter-level, level-02, level-03" rows={3} />
              <small>Comma-separated. Bundled starters stay first.</small>
            </label>
            <label>
              Changelog
              <textarea required name="changelog" rows={3} placeholder="What changes for players and why?" />
            </label>
            <div className="field-pair">
              <label>
                Actor
                <input required name="actor" defaultValue="human:batu" />
              </label>
              <label>
                Remote base revision
                <input required name="sourceRevision" placeholder="remote-42" />
              </label>
            </div>
            <button className="primary" type="submit">Validate and calculate digest</button>
          </fieldset>
        </form>

        <div className="release-context">
          <article className="selection" aria-label="Current selected sequence">
            <span>Current selection</span>
            <strong>{snapshot.selected?.sequenceVersion ?? 'No target sequence selected'}</strong>
            <p>{snapshot.selected?.changelog ?? 'Preparing a preview will not change this selection.'}</p>
          </article>

          {newestCandidate !== null && (
            <article className="digest-review" aria-labelledby="digest-title">
              <span>Validated preview</span>
              <h3 id="digest-title">{newestCandidate.sequenceVersion}</h3>
              <code>{newestCandidate.digest}</code>
              <p>{newestCandidate.changelog}</p>
              <label className="confirmation" aria-describedby="grant-binding">
                <input
                  type="checkbox"
                  checked={confirmedCandidateId === newestCandidate.candidateId}
                  onChange={(event) => setConfirmedCandidateId(event.target.checked ? newestCandidate.candidateId : null)}
                />
                I reviewed this exact digest and changelog.
              </label>
              <p id="grant-binding" className="grant-binding">
                Grant binding: {grantAcknowledgement('publish_sequence', newestCandidate.digest)}
              </p>
              <label>
                Human approval credential
                <input
                  type="password"
                  autoComplete="off"
                  value={humanApprovalCredential}
                  onChange={(event) => setHumanApprovalCredential(event.target.value)}
                />
                <small>Obtain this out-of-band from the operator who launched the editor.</small>
              </label>
              <button
                className="primary"
                type="button"
                disabled={
                  busy
                  || hasUnfinishedSaga
                  || humanApprovalCredential.length === 0
                  || confirmedCandidateId !== newestCandidate.candidateId
                }
                onClick={() => void submitHumanAction(onActivate, newestCandidate)}
              >
                {snapshot.remoteEnabled ? 'Approve and publish' : 'Approve local selection'}
              </button>
            </article>
          )}
        </div>
      </div>

      <div className="saga-region">
        <h3 ref={resultHeading} tabIndex={-1}>Publication activity</h3>
        <p className="sr-only" aria-live="polite">
          {newestSaga === null ? 'No publication attempt yet.' : publishingAnnouncement(newestSaga)}
          {error === null ? '' : ` ${error}`}
        </p>
        {error !== null && <p className="inline-error" role="alert">{error}</p>}
        {snapshot.sagas.length === 0 ? (
          <p className="empty-state">No saga has started. Preview validation is side-effect free.</p>
        ) : (
          <ol className="saga-list">
            {[...snapshot.sagas].reverse().map((saga) => {
              const copy = publishingStatusCopy(saga.status);
              return (
                <li key={saga.sagaId} className={`saga ${copy.tone}`}>
                  <span className="saga-marker" aria-hidden="true" />
                  <div>
                    <strong>{copy.label}</strong>
                    <p>{copy.detail}</p>
                    <small>{saga.action} · {saga.digest.slice(0, 16)}…</small>
                  </div>
                  {isUnfinishedSagaStatus(saga.status) && (
                    <button type="button" disabled={busy} onClick={() => void onReconcile(saga.sagaId)}>
                      Read back exact hash
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <div className="rollback-region">
        <h3>Retained sequence rollback</h3>
        <p>Rollback selects an eligible immutable preview. Package bytes are never rewritten.</p>
        {retained.length === 0 ? (
          <p className="empty-state">No retained prior sequence is available.</p>
        ) : (
          <ul className="retained-list">
            {retained.map((candidate) => (
              <li key={candidate.candidateId}>
                <div>
                  <strong>{candidate.sequenceVersion}</strong>
                  <span>{candidate.changelog}</span>
                  <code>{candidate.digest.slice(0, 20)}…</code>
                </div>
                <button
                  type="button"
                  disabled={busy || hasUnfinishedSaga || humanApprovalCredential.length === 0}
                  onClick={() => void submitHumanAction(onRollback, candidate)}
                >
                  Confirm rollback
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
