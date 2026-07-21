import { createElement, type ReactElement } from 'react';

import {
  discardPendingIntent,
  reapplyPendingIntent,
  type CurrentSessionSnapshot,
  type RevisionConflict,
} from './revisionConflict.ts';

export * from './revisionConflict.ts';

export interface RevisionConflictPanelProps<TIntent> {
  conflict: RevisionConflict<TIntent>;
  onReapply: (request: { intent: TIntent; expectedRevision: string }) => void;
  onDiscard: (snapshot: CurrentSessionSnapshot) => void;
}

export function RevisionConflictPanel<TIntent>({
  conflict,
  onReapply,
  onDiscard,
}: RevisionConflictPanelProps<TIntent>): ReactElement {
  return createElement(
    'section',
    { role: 'alert', 'aria-labelledby': 'revision-conflict-title' },
    createElement('h2', { id: 'revision-conflict-title' }, 'Session changed elsewhere'),
    createElement(
      'p',
      null,
      'Your pending edit was not reapplied. Review the current session, then choose what to do.',
    ),
    createElement(
      'button',
      { type: 'button', onClick: () => onReapply(reapplyPendingIntent(conflict)) },
      'Reapply edit to current revision',
    ),
    createElement(
      'button',
      { type: 'button', onClick: () => onDiscard(discardPendingIntent(conflict)) },
      'Discard edit and refresh',
    ),
  );
}
