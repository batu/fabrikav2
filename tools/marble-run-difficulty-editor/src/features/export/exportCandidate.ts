import {
  canonicalDifficultyJson,
  createDefaultDifficultyDraft,
  EXPORT_CANDIDATE_VERSION,
  fingerprintCanonicalDifficultyJson,
  type DifficultyDraft,
  type ExportCandidate,
} from '../../../../../games/marble_run/src/levels/difficulty-contract.ts';
import { affectedLevelIds } from '../../../../../games/marble_run/src/levels/difficulty-expand.ts';
import { LEVELS } from '../../../../../games/marble_run/src/levels/levels.generated.ts';
import { canonicalizeExportCandidate, validateExportCandidate } from '../../../../../games/marble_run/src/levels/difficulty-validation.ts';
import type { AcceptedLevel } from '../../generation/protocol.ts';

export interface ExportReviewInput {
  readonly draft: DifficultyDraft;
  readonly accepted: Readonly<Record<number, AcceptedLevel>>;
  readonly failures?: Readonly<Record<number, string>>;
  readonly baselineCandidate?: ExportCandidate;
}

export interface ExportReview {
  readonly candidate: ExportCandidate;
  readonly reviewedDraftFingerprint: string;
  readonly candidateFingerprint: string;
  readonly json: string;
  readonly canExport: boolean;
  readonly issues: readonly string[];
  readonly summary: {
    readonly changedLevelIds: readonly number[];
    readonly overriddenLevelIds: readonly number[];
    readonly lockedLevelIds: readonly number[];
    readonly failedLevelIds: readonly number[];
    readonly validatedLevelIds: readonly number[];
  };
}

export interface CandidateDownload {
  readonly filename: string;
  readonly mimeType: 'application/json';
  readonly bytes: Uint8Array;
  readonly fingerprint: string;
}

/** The revision identity intentionally excludes derived evidence and UI state. */
export function draftReviewProjection(draft: DifficultyDraft): unknown {
  return { version: draft.version, baseline: draft.baseline, authored: draft.authored, levels: draft.levels, locks: draft.locks, overrides: draft.overrides };
}

export function fingerprintDifficultyDraft(draft: DifficultyDraft): Promise<string> {
  return fingerprintCanonicalDifficultyJson(draftReviewProjection(draft));
}

function changedInventory(draft: DifficultyDraft, accepted: Readonly<Record<number, AcceptedLevel>>): readonly number[] {
  const changed = new Set(affectedLevelIds(createDefaultDifficultyDraft(), draft));
  for (const level of LEVELS) {
    const next = accepted[level.id]?.level;
    if (next !== undefined && canonicalDifficultyJson(next) !== canonicalDifficultyJson(level)) changed.add(level.id);
  }
  return [...changed].sort((a, b) => a - b);
}

function coreValidationIssues(issues: readonly string[]): readonly string[] {
  return issues.filter((issue) => issue !== 'Embedded validation summary is internally inconsistent with computed validation.');
}

export async function createExportReview(input: ExportReviewInput): Promise<ExportReview> {
  const reviewedDraftFingerprint = await fingerprintDifficultyDraft(input.draft);
  const accepted = Object.values(input.accepted).sort((a, b) => a.level.id - b.level.id);
  const failedLevelIds = Object.keys(input.failures ?? {}).map(Number).sort((a, b) => a - b);
  const changedLevelIds = changedInventory(input.draft, input.accepted);
  const provisional: ExportCandidate = {
    version: EXPORT_CANDIDATE_VERSION,
    reviewedDraftFingerprint,
    baseline: input.draft.baseline,
    authored: input.draft.authored,
    levels: input.draft.levels,
    boards: accepted.map(({ level }) => level),
    evidence: accepted.map(({ evidence }) => evidence),
    locks: input.draft.locks,
    overrides: input.draft.overrides,
    validation: { valid: true, issues: [] },
    changedLevelIds,
  };
  const first = await validateExportCandidate(provisional, { baselineCandidate: input.baselineCandidate, currentDraftFingerprint: reviewedDraftFingerprint });
  const validationIssues = coreValidationIssues(first.issues);
  const candidate: ExportCandidate = { ...provisional, validation: { valid: validationIssues.length === 0, issues: validationIssues } };
  const final = await validateExportCandidate(candidate, { baselineCandidate: input.baselineCandidate, currentDraftFingerprint: reviewedDraftFingerprint });
  const issues = [...final.issues, ...failedLevelIds.map((id) => `Level ${id} Needs attention: ${input.failures![id]}`)];
  const invalidLevelIds = new Set(issues.flatMap((issue) => {
    const match = /^Level (\d+)\b/.exec(issue);
    return match === null ? [] : [Number(match[1])];
  }));
  const canonical = await canonicalizeExportCandidate(candidate);
  return {
    candidate,
    reviewedDraftFingerprint,
    candidateFingerprint: canonical.fingerprint,
    json: canonical.json,
    canExport: final.valid && failedLevelIds.length === 0,
    issues,
    summary: {
      changedLevelIds,
      overriddenLevelIds: input.draft.overrides.map(({ levelId }) => levelId).sort((a, b) => a - b),
      lockedLevelIds: input.draft.locks.map(({ levelId }) => levelId).sort((a, b) => a - b),
      failedLevelIds,
      validatedLevelIds: accepted.map(({ level }) => level.id).filter((id) => !invalidLevelIds.has(id)),
    },
  };
}

export async function reviewIsCurrent(review: ExportReview, draft: DifficultyDraft): Promise<boolean> {
  return review.reviewedDraftFingerprint === await fingerprintDifficultyDraft(draft);
}

export async function prepareCandidateDownload(review: ExportReview, currentDraft: DifficultyDraft): Promise<CandidateDownload> {
  if (!review.canExport) throw new Error('Export Candidate is blocked by validation.');
  if (!await reviewIsCurrent(review, currentDraft)) throw new Error('Export Candidate review is stale; review the current draft again.');
  const validation = await validateExportCandidate(review.candidate, { currentDraftFingerprint: review.reviewedDraftFingerprint });
  if (!validation.valid) throw new Error(`Export Candidate no longer validates: ${validation.issues.join(' ')}`);
  const canonical = await canonicalizeExportCandidate(review.candidate);
  if (canonical.json !== review.json || canonical.fingerprint !== review.candidateFingerprint) throw new Error('Export Candidate bytes no longer match the reviewed artifact.');
  return { filename: `marble-run-difficulty-${canonical.fingerprint}.json`, mimeType: 'application/json', bytes: new TextEncoder().encode(canonical.json), fingerprint: canonical.fingerprint };
}

/** UI seam: call only from the explicit confirmed download action. */
export function triggerCandidateDownload(download: CandidateDownload, documentRef: Document = document): void {
  const ownedBytes = new Uint8Array(download.bytes.byteLength);
  ownedBytes.set(download.bytes);
  const url = URL.createObjectURL(new Blob([ownedBytes.buffer], { type: download.mimeType }));
  const anchor = documentRef.createElement('a');
  anchor.href = url;
  anchor.download = download.filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
