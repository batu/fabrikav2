// The session-scoped Activity surface (R20/AE20): a thin, accessible render
// of the pure model in activity.ts. All recovery, ordering, and state-action
// logic lives in the model; this component only presents it.

import { useEffect, useRef, useState } from 'react';

import { type ActivityEntry, activityAnnouncement } from './activity.ts';

export interface ActivityCallbacks {
  onCancel: (jobId: string) => void;
  onRetry: (jobId: string) => void;
  onForceNew: (jobId: string, kind: string) => void;
  onApplyArtifact: (jobId: string, artifactId: string) => void;
  onOpenFeature: (route: string) => void;
}

export interface ActivityProps {
  entries: ActivityEntry[];
  callbacks: ActivityCallbacks;
}

export function Activity({ entries, callbacks }: ActivityProps) {
  const [announcement, setAnnouncement] = useState('');
  const lastByJob = useRef<Map<string, string>>(new Map());
  const listRef = useRef<HTMLUListElement | null>(null);

  useEffect(() => {
    for (const entry of entries) {
      const text = activityAnnouncement(entry);
      if (lastByJob.current.get(entry.job.jobId) !== text) {
        lastByJob.current.set(entry.job.jobId, text);
        setAnnouncement(text);
      }
    }
  }, [entries]);

  const restoreFocus = () => {
    // After an action removes its own button, keep keyboard users anchored
    // inside Activity instead of dropping focus to <body>.
    listRef.current?.focus();
  };

  return (
    <section aria-labelledby="activity-heading">
      <h2 id="activity-heading">Activity</h2>
      <p aria-live="polite" role="status">
        {announcement}
      </p>
      {entries.length === 0 && <p>No recovered jobs or retained artifacts for this session.</p>}
      <ul ref={listRef} tabIndex={-1} aria-label="Recovered jobs and retained artifacts">
        {entries.map((entry) => (
          <li key={entry.job.jobId}>
            <h3>{entry.job.kind}</h3>
            <p>
              <span>Job status: {entry.durableStatusLabel}</span>{' '}
              <span>Connection: {entry.connectionStatusLabel}</span>
            </p>
            <p>{entry.actions.copy}</p>
            <button
              type="button"
              onClick={() => callbacks.onOpenFeature(entry.featureRoute)}
            >
              Open in feature
            </button>
            {entry.actions.canCancel && (
              <button
                type="button"
                aria-label={`Cancel ${entry.job.kind} job`}
                onClick={() => {
                  callbacks.onCancel(entry.job.jobId);
                  restoreFocus();
                }}
              >
                Cancel
              </button>
            )}
            {entry.actions.canRetry && (
              <button
                type="button"
                aria-label={`Retry ${entry.job.kind} job`}
                onClick={() => {
                  callbacks.onRetry(entry.job.jobId);
                  restoreFocus();
                }}
              >
                Retry
              </button>
            )}
            {entry.actions.forceNew === 'with_grant' && (
              <button
                type="button"
                aria-label={`Start ${entry.job.kind} over with approval`}
                onClick={() => {
                  callbacks.onForceNew(entry.job.jobId, entry.job.kind);
                  restoreFocus();
                }}
              >
                Start over (requires approval)
              </button>
            )}
            {entry.actions.artifactAccess !== 'none' &&
              entry.job.artifacts.map((artifact) => (
                <span key={artifact.artifactId}>
                  <span>
                    Retained: {artifact.displayName} ({artifact.mediaType})
                  </span>
                  {entry.actions.artifactAccess === 'inspect_and_apply' && (
                    <button
                      type="button"
                      aria-label={`Apply ${artifact.displayName} to the current session`}
                      onClick={() => {
                        callbacks.onApplyArtifact(entry.job.jobId, artifact.artifactId);
                        restoreFocus();
                      }}
                    >
                      Apply to current session
                    </button>
                  )}
                </span>
              ))}
          </li>
        ))}
      </ul>
    </section>
  );
}
