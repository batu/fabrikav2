// Gallery feature adapter: thin unpaid stable-ID session actions over the
// named HTTP routes. Same wire contract a direct client derives from the
// pinned OpenAPI document (AE12) — no repository knowledge, no extra state.

import type {
  CaptureCurrentSessionImageResponseHeaders,
  CaptureCurrentSessionImageResponseMediaType,
  CaptureSessionImageRequest,
  SessionSnapshotResponse,
} from '../../api/generated.ts';
import {
  type JobsTransportOptions,
  requestFtd,
  requestFtdBinary,
} from '../../api/http.ts';

export type SessionActionContext = JobsTransportOptions;

export interface SessionImageCapture {
  sessionId: string;
  revision: string;
  source: string;
  sha256: string;
  mediaType: CaptureCurrentSessionImageResponseMediaType;
  image: Blob;
}

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

function requireCaptureHeader(
  headers: Headers,
  name: keyof CaptureCurrentSessionImageResponseHeaders,
): string {
  const value = headers.get(name);
  if (!value) throw new Error(`FTD capture response lacks ${name}`);
  return value;
}

function requireCaptureMediaType(headers: Headers): CaptureCurrentSessionImageResponseMediaType {
  const value = headers.get('Content-Type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (value !== 'image/png') throw new Error('FTD capture response is not image/png');
  return value;
}

export async function captureCurrentSessionImage(
  context: SessionActionContext,
  args: { sessionId: string } & CaptureSessionImageRequest,
): Promise<SessionImageCapture> {
  const response = await requestFtdBinary(
    context,
    'POST',
    `/api/sessions/${encodeURIComponent(args.sessionId)}/capture`,
    { revision: args.revision, variant: args.variant ?? 'gemini' },
  );
  return {
    sessionId: requireCaptureHeader(response.headers, 'X-FTD-Session-Id'),
    revision: requireCaptureHeader(response.headers, 'X-FTD-Session-Revision'),
    source: requireCaptureHeader(response.headers, 'X-FTD-Image-Source'),
    sha256: requireCaptureHeader(response.headers, 'X-FTD-Image-SHA256'),
    mediaType: requireCaptureMediaType(response.headers),
    image: response.blob,
  };
}
