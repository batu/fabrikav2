// Scrubbed, hash-only provenance evidence (P6 §6, R13/R32). The committed record
// carries ONLY hashes, booleans, integers, canonical relative module names, and
// enum-like codes — never a license owner/account, an absolute path, or a home
// directory. `scrubText` redacts sensitive roots out of any free-text detail and
// `assertNoLeaks` fail-closes if an absolute path or home dir survives into the
// object, so a leak can never be written by construction.
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { GraphHash } from './graph.ts';

export interface ServerMode {
  desktop: boolean;
  unlocked: boolean;
}

export interface ProvenanceEvidence {
  schema: 'u5.phaser.provenance/1';
  runId: string;
  result: 'ok' | 'blocked';
  /** Present when blocked: a short, stable failure code. */
  code?: string;
  /** Present when blocked: a scrubbed one-line detail (no paths/owner). */
  detail?: string;
  serverMode: ServerMode;
  serverModeAfterRestart: ServerMode | null;
  port: number;
  sceneOrder: readonly string[];
  generatedGraph: readonly string[];
  sceneAuthority: readonly string[];
  compile: {
    generation1: GraphHash | null;
    generation2: GraphHash | null;
    deterministic: boolean;
  };
  authority: {
    beforeCombined: string | null;
    afterSaveCombined: string | null;
    reopenCombined: string | null;
    stableAcrossRestart: boolean;
    byPathAfterSave: Record<string, string> | null;
  };
  generated: {
    afterSaveCombined: string | null;
    reopenCombined: string | null;
    stableAcrossRestart: boolean;
    byPathAfterSave: Record<string, string> | null;
  };
  restart: {
    endpointDownProven: boolean;
  };
  startedAt: string;
  endedAt: string;
}

/** Redact known sensitive roots, then collapse any leftover absolute-path run. */
export function scrubText(input: string, roots: readonly string[]): string {
  let out = input;
  for (const root of roots) {
    if (root && root.length > 1) out = out.split(root).join('<path>');
  }
  // Collapse any residual absolute POSIX path (2+ segments) to a placeholder.
  out = out.replace(/(?:\/[\w.\- ]+){2,}\/?/g, '<path>');
  return out;
}

function visitStrings(value: unknown, visit: (s: string) => void): void {
  if (typeof value === 'string') visit(value);
  else if (Array.isArray(value)) for (const item of value) visitStrings(item, visit);
  else if (value && typeof value === 'object') for (const item of Object.values(value)) visitStrings(item, visit);
}

/**
 * Fail-closed leak check: throws if any string in the evidence is an absolute
 * path, contains the home directory, or contains a caller-supplied sensitive
 * root (scratch/repo/server binary). Relative module names (`src/…`) and hashes
 * (`sha256-…`) are fine.
 */
export function assertNoLeaks(evidence: unknown, extraRoots: readonly string[] = []): void {
  const home = os.homedir();
  visitStrings(evidence, (s) => {
    if (s.startsWith('/') || s.startsWith('\\') || /^[A-Za-z]:[\\/]/.test(s)) {
      throw new Error('provenance evidence leaked an absolute path');
    }
    if (home && s.includes(home)) throw new Error('provenance evidence leaked the home directory');
    for (const root of extraRoots) {
      if (root && root.length > 1 && s.includes(root)) throw new Error('provenance evidence leaked a sensitive root');
    }
  });
}

/**
 * Serialize + write the scrubbed evidence to `outputPath` (created if needed).
 * Asserts no leaks before writing, so a malformed record fails rather than
 * commits a path/owner.
 */
export async function writeEvidence(
  outputPath: string,
  evidence: ProvenanceEvidence,
  sensitiveRoots: readonly string[] = [],
): Promise<void> {
  assertNoLeaks(evidence, sensitiveRoots);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(evidence, null, 2) + '\n');
}
