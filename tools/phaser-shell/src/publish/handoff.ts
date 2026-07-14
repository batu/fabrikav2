// U5 → U6 handoff record (KTD-K, card comment 19). U5's concrete deliverable to
// U6 is exactly THREE accepted immutable publications:
//   p0 — the frozen-seed clean project BEFORE any edit
//   a  — the FIRST accepted matched-edit bundle
//   b  — a DISTINCT second accepted matched-edit bundle (U6 applies it twice)
// recorded in `authoring/publications/accepted.json`, each bound to its
// publicationId + manifest digest. A unit test binds the record to the committed
// publications so it cannot drift. U6 consumes exactly this set for P0→A→B→B and
// fabricates no fixtures.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { status } from './status.ts';

export type HandoffRole = 'p0' | 'a' | 'b';

export interface HandoffEntry {
  publicationId: string;
  manifestDigest: string;
}

export interface AcceptedHandoff {
  contractId: string;
  contractVersion: string;
  roles: Record<HandoffRole, HandoffEntry>;
}

export interface HandoffIssue {
  role: HandoffRole | '$';
  code: string;
  detail: string;
}

/** Build the handoff record from the three accepted publication entries. */
export function buildAcceptedHandoff(roles: Record<HandoffRole, HandoffEntry>): AcceptedHandoff {
  return { contractId: 'shell-presentation-v2', contractVersion: '2.0.0', roles };
}

/** Parse a raw `accepted.json`; throws on a structurally invalid shape. */
export function parseAcceptedHandoff(raw: unknown): AcceptedHandoff {
  if (raw === null || typeof raw !== 'object') throw new TypeError('accepted.json must be an object');
  const doc = raw as Record<string, unknown>;
  if (doc['roles'] === null || typeof doc['roles'] !== 'object') throw new TypeError('accepted.json.roles must be an object');
  return doc as unknown as AcceptedHandoff;
}

/**
 * Validate the handoff against the committed publications under `outputRoot`:
 * every role points at an on-disk publication whose manifest digest + publicationId
 * match the record, and A ≠ B (U6 reuses B, so it must differ from A).
 */
export async function validateAcceptedHandoff(
  handoff: AcceptedHandoff,
  outputRoot: string,
): Promise<HandoffIssue[]> {
  const issues: HandoffIssue[] = [];
  const roles: HandoffRole[] = ['p0', 'a', 'b'];
  for (const role of roles) {
    const entry = handoff.roles[role];
    if (!entry || !entry.publicationId) {
      issues.push({ role, code: 'missing-role', detail: `no publication recorded for "${role}"` });
      continue;
    }
    const dir = path.join(outputRoot, entry.publicationId);
    const manifestPath = path.join(dir, 'manifest.json');
    if (!existsSync(manifestPath)) {
      issues.push({ role, code: 'missing-publication', detail: `no publication on disk for ${entry.publicationId}` });
      continue;
    }
    const verified = await status(dir);
    if (verified.outcome !== 'ready') {
      issues.push({ role, code: 'publication-tampered', detail: `publication status is ${verified.outcome}` });
      continue;
    }
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      publicationId?: string;
      digest?: string;
    };
    if (manifest.publicationId !== entry.publicationId) {
      issues.push({ role, code: 'publication-id-drift', detail: `manifest ${manifest.publicationId}` });
    }
    if (manifest.digest !== entry.manifestDigest) {
      issues.push({ role, code: 'manifest-digest-drift', detail: `manifest digest differs from the record` });
    }
  }
  if (handoff.roles.a && handoff.roles.b && handoff.roles.a.publicationId === handoff.roles.b.publicationId) {
    issues.push({ role: '$', code: 'a-equals-b', detail: 'A and B must be distinct publications (U6 applies B twice)' });
  }
  return issues;
}
