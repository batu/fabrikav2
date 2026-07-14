// Preflight = validate + (optional) drift check against a prior publication
// (U5, KTD-H). It runs the full typed validation gate and, when a prior
// publication directory is supplied, re-verifies that publication's manifest so
// a caller can tell a clean re-publish (no-op) from a genuine change.
import { validateProject, type AuthoringProject } from './validate.ts';
import { status, type StatusResult } from './status.ts';
import type { Block } from './safety.ts';

export interface PreflightResult {
  result: 'ok' | 'blocked';
  blocks: Block[];
  /** Present when a prior publication directory was supplied. */
  prior?: StatusResult;
}

/** Validate a project and optionally re-verify a prior publication's integrity. */
export async function preflight(
  project: AuthoringProject,
  priorPublicationDir?: string,
): Promise<PreflightResult> {
  const validation = validateProject(project);
  const prior = priorPublicationDir ? await status(priorPublicationDir) : undefined;
  return { result: validation.result, blocks: validation.blocks, prior };
}
