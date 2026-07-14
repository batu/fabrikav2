import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  SHELL_CONTRACT_V2_ID,
  SHELL_CONTRACT_V2_VERSION,
  canonicalizeJson,
  computeShellProjectionIdV2,
  hashShellContractById,
  parseProjectionRevisionV2,
  parseShellPublishedRevisionV2,
  type ShellProjectionArtifact,
  type ShellProjectionRevisionV2,
} from '@fabrikav2/kernel';
import { parseAcceptedHandoff, validateAcceptedHandoff, type AcceptedHandoff } from '../publish/handoff.ts';
import { offlineProof } from '../publish/proof.ts';
import { status } from '../publish/status.ts';

export type ApplicationOutcome =
  | 'applied'
  | 'no-op'
  | 'blocked-drift'
  | 'invalid-revision'
  | 'unsupported-intent';

export class ApplicationError extends Error {
  constructor(
    readonly outcome: Exclude<ApplicationOutcome, 'applied' | 'no-op'>,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ApplicationError';
  }
}

export interface ApplicationOptions {
  /** Root containing U5's immutable publications and accepted.json. */
  readonly publicationRoot: string;
  /** Target proof game root; U6 owns only its design/ projection paths. */
  readonly gameRoot: string;
  readonly publicationId: string;
  /** Explicit intent guard; phaser-native is the only supported target. */
  readonly rendererProfile?: string;
}

export interface ApplicationResult {
  readonly outcome: ApplicationOutcome;
  readonly publicationId: string;
  readonly projectionId: string;
  readonly revisionPath: string;
  readonly artifactCount: number;
}

interface CandidateProjection {
  readonly revision: ShellProjectionRevisionV2;
  readonly files: ReadonlyMap<string, Buffer>;
}

const HASH_ID = /^sha256-[a-f0-9]{64}$/u;

function hashBytes(bytes: Uint8Array): string {
  return `sha256-${createHash('sha256').update(bytes).digest('hex')}`;
}

function jsonBytes(value: unknown): Buffer {
  return Buffer.from(`${canonicalizeJson(value)}\n`, 'utf8');
}

function byCodeUnit(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function invalidRevision(error: unknown): ApplicationError {
  if (error instanceof ApplicationError) return error;
  return new ApplicationError(
    'invalid-revision',
    error instanceof Error ? error.message : 'Published revision is invalid.',
    { cause: error },
  );
}

function blockedDrift(error: unknown): ApplicationError {
  if (error instanceof ApplicationError) return error;
  return new ApplicationError(
    'blocked-drift',
    error instanceof Error ? error.message : 'Selected projection has drifted.',
    { cause: error },
  );
}

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}

async function readJson(target: string): Promise<unknown> {
  return JSON.parse(await readFile(target, 'utf8')) as unknown;
}

async function acceptedHandoff(options: ApplicationOptions): Promise<AcceptedHandoff> {
  const raw = await readJson(path.join(options.publicationRoot, 'accepted.json'));
  const handoff = parseAcceptedHandoff(raw);
  const issues = await validateAcceptedHandoff(handoff, options.publicationRoot);
  if (issues.length > 0) {
    throw new Error(`U5 accepted-publication handoff is invalid: ${issues.map((issue) => issue.code).join(', ')}`);
  }
  const acceptedIds = new Set(Object.values(handoff.roles).map((entry) => entry.publicationId));
  if (!acceptedIds.has(options.publicationId)) {
    throw new Error(`Publication ${options.publicationId} is not in U5's accepted P0/A/B handoff.`);
  }
  return handoff;
}

/** Read a projection tree without following symlinks or accepting special files. */
async function readProjectionTree(root: string, rel = ''): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>();
  for (const entry of (await readdir(path.join(root, rel), { withFileTypes: true }))
    .sort((left, right) => byCodeUnit(left.name, right.name))) {
    const relative = rel ? `${rel}/${entry.name}` : entry.name;
    const absolute = path.join(root, relative);
    const info = await lstat(absolute);
    if (info.isSymbolicLink()) throw new Error(`Projection contains symlink "${relative}".`);
    if (info.isDirectory()) {
      for (const [filePath, bytes] of await readProjectionTree(root, relative)) files.set(filePath, bytes);
    } else if (info.isFile()) {
      files.set(relative, await readFile(absolute));
    } else {
      throw new Error(`Projection contains unsupported entry "${relative}".`);
    }
  }
  return files;
}

function projectionDigest(files: ReadonlyMap<string, Buffer>): string {
  return canonicalizeJson(
    [...files.entries()].map(([artifactPath, bytes]) => [artifactPath, hashBytes(bytes), bytes.byteLength]),
  );
}

async function buildCandidate(
  options: ApplicationOptions,
  intent: 'new-candidate' | 'selected-revision' = 'new-candidate',
): Promise<CandidateProjection> {
  if ((options.rendererProfile ?? 'phaser-native') !== 'phaser-native') {
    throw new ApplicationError(
      'unsupported-intent',
      `Unsupported renderer profile "${options.rendererProfile}"; only phaser-native can be applied.`,
    );
  }
  try {
    if (!HASH_ID.test(options.publicationId)) throw new Error('Invalid publication identity.');
    // Acceptance is a mutable authoring decision, while an already-selected
    // projection is an immutable runtime record. A later accepted-set rotation
    // must not make intact selected bytes look drifted, but every new candidate
    // still has to pass the current U5 handoff gate.
    if (intent === 'new-candidate') await acceptedHandoff(options);
    const publicationDir = path.join(path.resolve(options.publicationRoot), options.publicationId);
    const verified = await status(publicationDir);
    if (verified.outcome !== 'ready' || verified.publicationId !== options.publicationId) {
      throw new Error(`Publication is not immutable-ready (${verified.outcome}).`);
    }
    const publication = await parseShellPublishedRevisionV2(await readJson(path.join(publicationDir, 'revision.json')));
    if (publication.rendererProfile !== 'phaser-native') {
      throw new ApplicationError(
        'unsupported-intent',
        `Publication renderer profile "${publication.rendererProfile}" is unsupported.`,
      );
    }
    if (publication.publicationId !== options.publicationId) {
      throw new Error('Publication identity does not match revision.json.');
    }
    const proof = await offlineProof(publicationDir);
    if (!proof.ok) throw new Error(`Publication projection failed offline proof: ${proof.findings.map((item) => item.code).join(', ')}`);

    // Read twice around a second full-manifest verification. A publication that
    // mutates during ingest never becomes a candidate.
    const projectionRoot = path.join(publicationDir, 'projection');
    const firstRead = await readProjectionTree(projectionRoot);
    const verifiedAgain = await status(publicationDir);
    const secondRead = await readProjectionTree(projectionRoot);
    if (verifiedAgain.outcome !== 'ready' || projectionDigest(firstRead) !== projectionDigest(secondRead)) {
      throw new Error('Publication changed while its projection was being ingested.');
    }
    const files = new Map([...secondRead.entries()].sort(([left], [right]) => byCodeUnit(left, right)));
    const artifacts: ShellProjectionArtifact[] = [...files.entries()].map(([artifactPath, bytes]) => ({
      path: artifactPath,
      sha256: hashBytes(bytes),
      bytes: bytes.byteLength,
    }));
    const base = {
      contractId: SHELL_CONTRACT_V2_ID,
      contractVersion: SHELL_CONTRACT_V2_VERSION,
      rendererProfile: 'phaser-native' as const,
      compatibilityHash: await hashShellContractById(SHELL_CONTRACT_V2_ID),
      sourcePublicationId: options.publicationId,
      artifacts,
    };
    const projectionId = await computeShellProjectionIdV2(base);
    const revision = await parseProjectionRevisionV2({
      ...base,
      projectionId,
      revisionPath: `design/revisions/${projectionId}`,
    });
    return { revision, files };
  } catch (error) {
    throw invalidRevision(error);
  }
}

async function verifyDirectory(directory: string, candidate: CandidateProjection): Promise<void> {
  const actual = await readProjectionTree(directory);
  if (projectionDigest(actual) !== projectionDigest(candidate.files)) {
    throw new Error('Selected projection bytes diverge from deterministic regeneration.');
  }
}

async function selectedRevision(options: ApplicationOptions): Promise<ShellProjectionRevisionV2 | undefined> {
  const pointerPath = path.join(path.resolve(options.gameRoot), 'design', 'revision.json');
  if (!(await exists(pointerPath))) return undefined;
  try {
    const revision = await parseProjectionRevisionV2(await readJson(pointerPath));
    if (revision.rendererProfile !== 'phaser-native') {
      throw new ApplicationError('unsupported-intent', `Unsupported selected renderer profile "${revision.rendererProfile}".`);
    }
    const pinned = await buildCandidate(
      { ...options, publicationId: revision.sourcePublicationId },
      'selected-revision',
    );
    if (canonicalizeJson(pinned.revision) !== canonicalizeJson(revision)) {
      throw new Error('Selected projection pointer diverges from deterministic regeneration.');
    }
    await verifyDirectory(path.join(path.resolve(options.gameRoot), revision.revisionPath), pinned);
    return revision;
  } catch (error) {
    if (error instanceof ApplicationError && error.outcome === 'unsupported-intent') throw error;
    throw blockedDrift(error);
  }
}

export async function preflightPublication(options: ApplicationOptions): Promise<ApplicationResult> {
  const selected = await selectedRevision(options);
  const candidate = await buildCandidate(options);
  return {
    outcome: selected?.projectionId === candidate.revision.projectionId ? 'no-op' : 'applied',
    publicationId: options.publicationId,
    projectionId: candidate.revision.projectionId,
    revisionPath: candidate.revision.revisionPath,
    artifactCount: candidate.revision.artifacts.length,
  };
}

async function writeCandidate(directory: string, candidate: CandidateProjection): Promise<void> {
  for (const [artifactPath, bytes] of candidate.files) {
    const target = path.join(directory, artifactPath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
  await verifyDirectory(directory, candidate);
}

export async function applyPublication(options: ApplicationOptions): Promise<ApplicationResult> {
  const selected = await selectedRevision(options);
  const candidate = await buildCandidate(options);
  const result: ApplicationResult = {
    outcome: selected?.projectionId === candidate.revision.projectionId ? 'no-op' : 'applied',
    publicationId: options.publicationId,
    projectionId: candidate.revision.projectionId,
    revisionPath: candidate.revision.revisionPath,
    artifactCount: candidate.revision.artifacts.length,
  };
  if (result.outcome === 'no-op') return result;

  const designRoot = path.join(path.resolve(options.gameRoot), 'design');
  const revisionsRoot = path.join(designRoot, 'revisions');
  const target = path.join(path.resolve(options.gameRoot), candidate.revision.revisionPath);
  await mkdir(revisionsRoot, { recursive: true });
  if (await exists(target)) {
    try {
      await verifyDirectory(target, candidate);
    } catch (error) {
      throw blockedDrift(error);
    }
  } else {
    const staging = await mkdtemp(path.join(revisionsRoot, '.stage-'));
    try {
      await writeCandidate(staging, candidate);
      await rename(staging, target);
    } catch (error) {
      await rm(staging, { recursive: true, force: true });
      throw error;
    }
  }

  // The pointer rename is the only commit point. Until this succeeds the prior
  // selected revision remains active; an unselected directory is harmless.
  const pointer = path.join(designRoot, 'revision.json');
  const temporary = `${pointer}.tmp-${process.pid}`;
  await writeFile(temporary, jsonBytes(candidate.revision));
  await rename(temporary, pointer);
  return result;
}

export async function readSelectedProjection(options: Pick<ApplicationOptions, 'publicationRoot' | 'gameRoot'>): Promise<{
  readonly state: 'absent' | 'selected' | 'drifted';
  readonly projectionId?: string;
  readonly publicationId?: string;
}> {
  const pointerPath = path.join(path.resolve(options.gameRoot), 'design', 'revision.json');
  if (!(await exists(pointerPath))) return { state: 'absent' };
  try {
    const revision = await parseProjectionRevisionV2(await readJson(pointerPath));
    await selectedRevision({ ...options, publicationId: revision.sourcePublicationId });
    return { state: 'selected', projectionId: revision.projectionId, publicationId: revision.sourcePublicationId };
  } catch {
    return { state: 'drifted' };
  }
}
