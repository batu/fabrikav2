import { useEffect, useState } from 'react';

import type { EditorWorkspaceState } from '../../domain/draftStore.ts';
import {
  createExportReview,
  prepareCandidateDownload,
  reviewIsCurrent,
  triggerCandidateDownload,
  type ExportReview as ExportReviewResult,
} from './exportCandidate.ts';

interface ExportReviewProps {
  readonly state: EditorWorkspaceState;
  readonly onClose: () => void;
}

function Inventory({ label, ids, complete }: { readonly label: string; readonly ids: readonly number[]; readonly complete?: boolean }): React.JSX.Element {
  return (
    <div className="export-inventory">
      <span>{label}</span>
      <strong>{complete ? `${ids.length} / 110` : ids.length}</strong>
      <p>{ids.length === 0 ? 'None' : ids.join(', ')}</p>
    </div>
  );
}

export function ExportReview({ state, onClose }: ExportReviewProps): React.JSX.Element {
  const [review, setReview] = useState<ExportReviewResult | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [stale, setStale] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (review === null) return () => { active = false; };
    void reviewIsCurrent(review, state.draft).then((current) => {
      if (!active || current) return;
      setStale(true);
      setConfirmed(false);
    });
    return () => { active = false; };
  }, [review, state.draft]);

  const beginReview = async () => {
    setReviewing(true);
    setMessage(null);
    try {
      const next = await createExportReview({ draft: state.draft, accepted: state.accepted, failures: state.failures });
      setReview(next);
      setStale(false);
      setConfirmed(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally { setReviewing(false); }
  };

  const download = async () => {
    if (review === null) return;
    setMessage(null);
    try { triggerCandidateDownload(await prepareCandidateDownload(review, state.draft)); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  };

  const blocked = review === null || !review.canExport || stale;
  return (
    <aside className="export-review" aria-labelledby="export-review-title" data-export-review>
      <header className="drawer-heading">
        <div><span className="eyebrow">Explicit handoff</span><h2 id="export-review-title">Review export</h2></div>
        <button className="text-action" onClick={onClose}>Close</button>
      </header>

      {review === null ? (
        <div className="export-review__empty">
          <p>Validate the exact current draft and prepare an immutable JSON candidate. This does not change the game or publish anything.</p>
          <button className="primary-action" data-action="begin-review" disabled={reviewing} onClick={() => void beginReview()}>{reviewing ? 'Reviewing…' : 'Review current draft'}</button>
        </div>
      ) : (
        <>
          <div className={`review-verdict${blocked ? ' is-blocked' : ''}`} role="status">
            <div><span className="eyebrow">Candidate status</span><strong>{stale ? 'Review is stale' : review.canExport ? 'Ready to confirm' : 'Blocked'}</strong></div>
            <button className="text-action" data-action="refresh-review" disabled={reviewing} onClick={() => void beginReview()}>Review again</button>
          </div>
          <div className="candidate-fingerprint"><span>Candidate fingerprint</span><code>{review.candidateFingerprint}</code></div>
          <div className="export-inventories" aria-label="Export inventory">
            <Inventory label="Changed" ids={review.summary.changedLevelIds} />
            <Inventory label="Overridden" ids={review.summary.overriddenLevelIds} />
            <Inventory label="Locked" ids={review.summary.lockedLevelIds} />
            <Inventory label="Needs attention" ids={review.summary.failedLevelIds} />
            <Inventory label="Validated" ids={review.summary.validatedLevelIds} complete />
          </div>
          {(review.issues.length > 0 || stale) && (
            <section className="blocking-issues" aria-labelledby="blocking-issues-title">
              <h3 id="blocking-issues-title">Blocking issues</h3>
              {stale && <p>The draft changed after this fingerprint was reviewed. Review the current draft again.</p>}
              {review.issues.map((issue, index) => <p key={`${issue}-${index}`}>{issue}</p>)}
            </section>
          )}
          <footer className="export-actions">
            <label><input type="checkbox" data-action="confirm-export" checked={confirmed} disabled={blocked} onChange={(event) => setConfirmed(event.target.checked)} /><span>I confirm this reviewed draft as the Export Candidate.</span></label>
            <button className="primary-action" data-action="download-candidate" disabled={blocked || !confirmed} onClick={() => void download()}>Download candidate</button>
            <small>Download only · no source changes · no runtime migration · no Portal publication</small>
          </footer>
        </>
      )}
      {message !== null && <p className="export-message" role="alert">{message}</p>}
    </aside>
  );
}
