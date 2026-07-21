export interface CurrentSessionSnapshot {
  revision: string;
  session: Record<string, unknown>;
}

export interface RevisionConflict<TIntent> {
  pendingIntent: TIntent;
  current: CurrentSessionSnapshot;
  requiresExplicitResolution: true;
  resubmission: null;
}

export function preserveRevisionConflict<TIntent>(
  pendingIntent: TIntent,
  current: CurrentSessionSnapshot,
): RevisionConflict<TIntent> {
  return {
    pendingIntent,
    current,
    requiresExplicitResolution: true,
    resubmission: null,
  };
}

export function reapplyPendingIntent<TIntent>(conflict: RevisionConflict<TIntent>) {
  return {
    intent: conflict.pendingIntent,
    expectedRevision: conflict.current.revision,
  };
}

export function discardPendingIntent<TIntent>(
  conflict: RevisionConflict<TIntent>,
): CurrentSessionSnapshot {
  return conflict.current;
}
