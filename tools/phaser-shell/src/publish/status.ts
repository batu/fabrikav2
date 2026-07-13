// Read a publication's committed state and return a typed outcome (U5, KTD-H).
// `status` is read-only: it inspects a publication directory and reports whether
// it is a well-formed immutable publication, re-verifying the manifest digest
// against the on-disk bytes so a tampered publication is detected.
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { sha256, canonicalJson, type FileHash } from './manifest.ts';

export interface StatusResult {
  exists: boolean;
  publicationId: string | null;
  /** 'ready' | 'absent' | 'tampered' | 'invalid'. */
  outcome: 'ready' | 'absent' | 'tampered' | 'invalid';
  detail: string;
}

async function hashTree(dir: string, rel = ''): Promise<FileHash[]> {
  const out: FileHash[] = [];
  for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const abs = path.join(dir, entry.name);
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await hashTree(abs, relPath)));
    else {
      const bytes = await readFile(abs);
      out.push({ path: relPath, sha256: sha256(bytes), bytes: bytes.length });
    }
  }
  return out;
}

/** Inspect a publication directory and report a typed status. */
export async function status(dir: string): Promise<StatusResult> {
  const manifestPath = path.join(dir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    return { exists: false, publicationId: null, outcome: 'absent', detail: 'no manifest.json' };
  }
  let manifest: { publicationId?: string; digest?: string };
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch (error) {
    return { exists: true, publicationId: null, outcome: 'invalid', detail: `manifest.json is not valid JSON: ${(error as Error).message}` };
  }
  // Re-hash every file except manifest.json and re-derive the digest.
  const files = (await hashTree(dir)).filter((f) => f.path !== 'manifest.json');
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const recomputed = sha256(canonicalJson(sorted.map((f) => ({ path: f.path, sha256: f.sha256, bytes: f.bytes }))));
  if (recomputed !== manifest.digest) {
    return {
      exists: true,
      publicationId: manifest.publicationId ?? null,
      outcome: 'tampered',
      detail: 'manifest digest does not match the on-disk publication bytes',
    };
  }
  return {
    exists: true,
    publicationId: manifest.publicationId ?? null,
    outcome: 'ready',
    detail: 'immutable publication verified against its manifest',
  };
}
