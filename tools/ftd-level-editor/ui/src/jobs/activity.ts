// Session-scoped Activity model (R20/AE20): the persistent home for one or
// many recovered jobs and retained artifacts after reload. Pure data — the
// React surface in Activity.tsx renders exactly this.

import type { JobResource } from '../api/generated.ts';
import type { ConnectionState } from './observeJob.ts';
import { isTerminalJobStatus } from './observeJob.ts';
import {
  type JobViewState,
  type StateActionRow,
  JOB_STATE_ACTIONS,
  durableViewState,
  jobViewState,
} from './jobStateActions.ts';

export interface ActivityEntry {
  job: JobResource;
  viewState: JobViewState;
  actions: StateActionRow;
  // Durable and connection status are separate, both rendered as words.
  durableStatusLabel: string;
  connectionStatusLabel: string;
  featureRoute: string;
  hasRetainedArtifacts: boolean;
}

const FEATURE_ROUTES: Record<string, string> = {
  'ftd.background_generate': '/wizard/background',
  'ftd.crop_inpaint': '/wizard/crop',
  'ftd.retry_failed_dogs': '/wizard/dogs',
  'ftd.band_generate': '/wizard/bands',
  'ftd.multi_scene_generate': '/wizard/scenes',
  'ftd.dog_variant_upscale': '/lineup/upscale',
  'ftd.sprite_animate': '/lineup/animations',
  'ftd.sequence_workflow': '/lineup/sequence',
};

export function featureRouteForKind(kind: string): string {
  return FEATURE_ROUTES[kind] ?? '/activity';
}

const CONNECTION_LABELS: Record<ConnectionState, string> = {
  idle: 'Connecting',
  connected: 'Connected',
  reconnecting: 'Reconnecting',
  stopped: 'Not observing',
};

export function buildActivityEntry(
  job: JobResource,
  connection: ConnectionState,
): ActivityEntry {
  const viewState = jobViewState(job, connection);
  const durable = durableViewState(job);
  return {
    job,
    viewState,
    actions: JOB_STATE_ACTIONS[viewState],
    durableStatusLabel: durable.replaceAll('_', ' '),
    connectionStatusLabel: CONNECTION_LABELS[connection],
    featureRoute: featureRouteForKind(job.kind),
    hasRetainedArtifacts:
      job.artifacts.length > 0 &&
      (durable === 'succeeded_unapplied' || isTerminalJobStatus(job.status)),
  };
}

// Recovered listing order: still-active work first, then most recent first.
// Duplicate job ids (e.g. one row from Request ID recovery and one from the
// session listing) collapse to a single entry.
export function buildActivityEntries(
  jobs: JobResource[],
  connectionFor: (job: JobResource) => ConnectionState,
): ActivityEntry[] {
  const unique = new Map<string, JobResource>();
  for (const job of jobs) {
    if (!unique.has(job.jobId)) unique.set(job.jobId, job);
  }
  return [...unique.values()]
    .map((job) => buildActivityEntry(job, connectionFor(job)))
    .sort((a, b) => {
      const aActive = isTerminalJobStatus(a.job.status) ? 1 : 0;
      const bActive = isTerminalJobStatus(b.job.status) ? 1 : 0;
      if (aActive !== bActive) return aActive - bActive;
      return b.job.createdAt.localeCompare(a.job.createdAt);
    });
}

// One aria-live sentence per meaningful change; callers keep the previous
// announcement and only speak when the text actually differs.
export function activityAnnouncement(entry: ActivityEntry): string {
  return `${entry.job.kind}: ${entry.actions.announcement}`;
}
