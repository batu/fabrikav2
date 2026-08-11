import { analyzeDifficulty } from '../marble-board/solver';
import { scoreLevel } from '../marble-board/score';
import {
  canonicalDifficultyJson,
  EXPORT_CANDIDATE_VERSION,
  fingerprintCanonicalDifficultyJson,
  parseDifficultyDraft,
  SHIPPED_BASELINE,
  type ExportCandidate,
} from './difficulty-contract';
import { LEVEL_TOTAL } from './funnel-schedule';
import { affectedLevelIds, expandDifficultyDraft } from './difficulty-expand';

export interface CandidateValidationContext {
  readonly baselineCandidate?: ExportCandidate;
  /** Deprecated caller echo; candidate.reviewedDraftFingerprint is authoritative. */
  readonly reviewedDraftFingerprint?: string;
  readonly currentDraftFingerprint?: string;
}

export interface CandidateValidationResult { readonly valid: boolean; readonly issues: readonly string[] }

function inventory<T extends { readonly id?: number; readonly levelId?: number }>(rows: readonly T[], label: string, issues: string[]): Map<number, T> {
  const result = new Map<number, T>();
  for (const row of rows) {
    const id = row.id ?? row.levelId;
    if (!Number.isInteger(id) || id! < 1 || id! > LEVEL_TOTAL) {
      issues.push(`${label} has an invalid level identity ${String(id)}.`);
    } else if (result.has(id!)) {
      issues.push(`Level ${id} has duplicate ${label}.`);
    } else result.set(id!, row);
  }
  for (let id = 1; id <= LEVEL_TOTAL; id += 1) if (!result.has(id)) issues.push(`Level ${id} is missing ${label}.`);
  return result;
}

async function validateCandidate(candidate: ExportCandidate, context: CandidateValidationContext): Promise<CandidateValidationResult> {
  const issues: string[] = [];
  if (candidate.version !== EXPORT_CANDIDATE_VERSION) issues.push('Unsupported Export Candidate version.');
  if (typeof candidate.reviewedDraftFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(candidate.reviewedDraftFingerprint)) issues.push('Reviewed draft fingerprint must be a lowercase SHA-256 digest.');
  if (canonicalDifficultyJson(candidate.baseline) !== canonicalDifficultyJson(SHIPPED_BASELINE)) issues.push('Candidate does not match the currently shipped baseline fingerprint.');
  try {
    parseDifficultyDraft({ ...candidate, version: 1, derivedEvidence: candidate.evidence });
  } catch (error) {
    issues.push(`Candidate authoring contract is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
  const boards = inventory(candidate.boards, 'board', issues);
  const evidence = inventory(candidate.evidence, 'evidence', issues);
  inventory(candidate.levels, 'expanded identity', issues);
  const effective = expandDifficultyDraft({ ...candidate, version: 1, derivedEvidence: candidate.evidence });

  for (let id = 1; id <= LEVEL_TOTAL; id += 1) {
    const board = boards.get(id);
    const row = evidence.get(id);
    if (board === undefined || row === undefined) continue;
    const expected = effective[id - 1]!;
    let report: ReturnType<typeof analyzeDifficulty>;
    try { report = analyzeDifficulty(board); } catch { issues.push(`Level ${id} board cannot be analyzed.`); continue; }
    const measured = scoreLevel(board);
    if (!row.solvable) issues.push(`Level ${id} is unsolvable.`);
    if (row.measuredDifficulty < row.targetRange.min || row.measuredDifficulty > row.targetRange.max) issues.push(`Level ${id} measured difficulty is outside its target range.`);
    if (Math.abs(row.measuredDifficulty - measured) > 1e-9) issues.push(`Level ${id} measured difficulty is inconsistent with its board.`);
    if (row.marbleCount !== report.marbles) issues.push(`Level ${id} marble count is inconsistent with its board.`);
    if (row.solverWaves !== report.waves) issues.push(`Level ${id} solver waves are inconsistent with its board.`);
    if (Math.abs(row.initiallyMovableShare - report.initialMovableFraction) > 1e-9) issues.push(`Level ${id} initially movable share is inconsistent with its board.`);
    if (expected.overrideState !== 'locked') {
      if (canonicalDifficultyJson(row.targetRange) !== canonicalDifficultyJson(expected.targetRange)) issues.push(`Level ${id} target range is inconsistent with expanded authoring inputs.`);
      if (row.overrideState !== expected.overrideState) issues.push(`Level ${id} override state is inconsistent with expanded authoring inputs.`);
    }
  }

  const lockIds = new Set<number>();
  for (const lock of candidate.locks) {
    if (lockIds.has(lock.levelId)) issues.push(`Level ${lock.levelId} has duplicate locks.`);
    lockIds.add(lock.levelId);
    if (evidence.get(lock.levelId)?.overrideState !== 'locked') issues.push(`Level ${lock.levelId} lock and evidence state are inconsistent.`);
  }
  const overrideIds = new Set<number>();
  for (const override of candidate.overrides) {
    if (overrideIds.has(override.levelId)) issues.push(`Level ${override.levelId} has duplicate overrides.`);
    overrideIds.add(override.levelId);
    if (!lockIds.has(override.levelId) && evidence.get(override.levelId)?.overrideState !== 'overridden') issues.push(`Level ${override.levelId} override and evidence state are inconsistent.`);
  }

  if (context.currentDraftFingerprint !== undefined && candidate.reviewedDraftFingerprint !== context.currentDraftFingerprint) issues.push('Reviewed draft fingerprint is stale.');
  if (context.reviewedDraftFingerprint !== undefined && candidate.reviewedDraftFingerprint !== context.reviewedDraftFingerprint) issues.push('Candidate reviewed draft fingerprint does not match the confirmed review.');
  if (context.baselineCandidate !== undefined) {
    if (canonicalDifficultyJson(candidate.baseline) !== canonicalDifficultyJson(context.baselineCandidate.baseline)) issues.push('Candidate baseline fingerprint does not match the loaded baseline.');
    const changed = new Set(affectedLevelIds(
      { ...context.baselineCandidate, version: 1, derivedEvidence: context.baselineCandidate.evidence },
      { ...candidate, version: 1, derivedEvidence: candidate.evidence },
    ));
    const baselineBoards = new Map(context.baselineCandidate.boards.map((board) => [board.id, board]));
    for (const board of candidate.boards) if (canonicalDifficultyJson(board) !== canonicalDifficultyJson(baselineBoards.get(board.id))) changed.add(board.id);
    const baselineEvidence = new Map(context.baselineCandidate.evidence.map((row) => [row.levelId, row]));
    for (const id of lockIds) {
      if (canonicalDifficultyJson(boards.get(id)) !== canonicalDifficultyJson(baselineBoards.get(id))) issues.push(`Level ${id} locked board changed from its accepted baseline.`);
      if (canonicalDifficultyJson(evidence.get(id)) !== canonicalDifficultyJson(baselineEvidence.get(id))) issues.push(`Level ${id} locked evidence changed from its accepted baseline.`);
    }
    const declared = [...new Set(candidate.changedLevelIds)].sort((a, b) => a - b);
    if (declared.length !== candidate.changedLevelIds.length) issues.push('Changed-level inventory contains duplicate identities.');
    if (canonicalDifficultyJson([...changed].sort((a, b) => a - b)) !== canonicalDifficultyJson(declared)) issues.push('Changed-level inventory is inconsistent with candidate boards.');
  }
  const computedBeforeEmbedded = [...issues];
  if (candidate.validation.valid !== (computedBeforeEmbedded.length === 0) || canonicalDifficultyJson(candidate.validation.issues) !== canonicalDifficultyJson(computedBeforeEmbedded)) issues.push('Embedded validation summary is internally inconsistent with computed validation.');
  return { valid: issues.length === 0, issues };
}

/** Total validation boundary: malformed external JSON becomes a blocking issue, never an exception. */
export async function validateExportCandidate(candidate: unknown, context: CandidateValidationContext = {}): Promise<CandidateValidationResult> {
  try {
    return await validateCandidate(candidate as ExportCandidate, context);
  } catch (error) {
    return { valid: false, issues: [`Export Candidate is malformed: ${error instanceof Error ? error.message : String(error)}`] };
  }
}

export async function canonicalizeExportCandidate(candidate: ExportCandidate): Promise<{ readonly json: string; readonly fingerprint: string }> {
  const json = canonicalDifficultyJson(candidate);
  return { json, fingerprint: await fingerprintCanonicalDifficultyJson(candidate) };
}
