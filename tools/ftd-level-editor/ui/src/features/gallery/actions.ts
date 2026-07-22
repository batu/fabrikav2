// Gallery feature adapter: thin unpaid stable-ID session actions over the
// named HTTP routes. Same wire contract a direct client derives from the
// pinned OpenAPI document (AE12) — no repository knowledge, no extra state.

import type { SessionSnapshotResponse } from '../../api/generated.ts';
import { type JobsTransportOptions, requestFtd } from '../../api/http.ts';

export type SessionActionContext = JobsTransportOptions;

async function post(
  context: SessionActionContext,
  path: string,
  body: unknown,
): Promise<SessionSnapshotResponse> {
  return requestFtd<SessionSnapshotResponse>(context, 'POST', path, body);
}

export function setDogActiveVariant(
  context: SessionActionContext,
  args: { sessionId: string; dogId: string; revision: string; activeVariant: number | null },
): Promise<SessionSnapshotResponse> {
  return post(
    context,
    `/api/sessions/${encodeURIComponent(args.sessionId)}/dogs/${encodeURIComponent(args.dogId)}/active-variant`,
    { revision: args.revision, activeVariant: args.activeVariant },
  );
}

export function updateGalleryMetadata(
  context: SessionActionContext,
  args: { sessionId: string; revision: string; tags?: string[]; archived?: boolean },
): Promise<SessionSnapshotResponse> {
  return post(
    context,
    `/api/sessions/${encodeURIComponent(args.sessionId)}/gallery-metadata`,
    { revision: args.revision, tags: args.tags ?? null, archived: args.archived ?? null },
  );
}
