// Gallery feature adapter: thin unpaid stable-ID session actions over the
// named HTTP routes. Same wire contract a direct client derives from the
// pinned OpenAPI document (AE12) — no repository knowledge, no extra state.

import type { SessionSnapshotResponse } from '../../api/generated.ts';

export interface SessionActionContext {
  fetchImpl: typeof fetch;
  launchCredential: string;
}

async function post(
  context: SessionActionContext,
  path: string,
  body: unknown,
): Promise<SessionSnapshotResponse> {
  const response = await context.fetchImpl(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'X-FTD-Launch-Credential': context.launchCredential,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw Object.assign(new Error(`session action failed (${response.status})`), {
      status: response.status,
      detail: await response.json().catch(() => null),
    });
  }
  return (await response.json()) as SessionSnapshotResponse;
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
