// The DECLARED generated-module graph and scene authority for the real-Editor
// provenance protocol (U5, KTD-I / P6 §6).
//
// The seven shell scenes' order is the single canonical kernel state order
// (never a second hardcoded list — see the trace-the-seams lesson): the editor
// generates one `.ts` per `.scene` plus the `Semantic` user-component `.ts`. The
// scene AUTHORITY (the editable bytes) is the seven `.scene` files plus the
// `Semantic.components` definition. The provenance leg deletes the whole
// declared generated graph before each CompileProject and byte-compares the
// complete graph across the two runs; it never regenerates headlessly (U2
// finding 2 — the compiler lives only in the workbench client).
import { createHash } from 'node:crypto';
import { readFile, rm, access } from 'node:fs/promises';
import path from 'node:path';
import { STATE_IDS } from '../authoring/extractV2.ts';

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** The seven scene basenames in canonical kernel state order (Menu…Fail). */
export const SCENE_ORDER: readonly string[] = STATE_IDS.map(cap);

/** The complete declared generated-module graph, project-root-relative. */
export const GENERATED_GRAPH: readonly string[] = [
  ...SCENE_ORDER.map((name) => `src/scenes/${name}.ts`),
  'src/components/Semantic.ts',
];

/** The editable scene authority (`.scene` + the `Semantic` component), relative. */
export const SCENE_AUTHORITY: readonly string[] = [
  ...SCENE_ORDER.map((name) => `src/scenes/${name}.scene`),
  'src/components/Semantic.components',
];

/** The seven scene file names in canonical order (what the workbench opens/saves). */
export const SCENE_FILES: readonly string[] = SCENE_ORDER.map((name) => `${name}.scene`);

export interface GraphHash {
  /** `sha256-…` over `${rel}\0${bytes}` for every path, in declared order. */
  combined: string;
  /** Per-path `sha256-…` content hash, keyed by project-relative path. */
  byPath: Record<string, string>;
}

/**
 * Combine already-read `(rel, bytes)` pairs into the canonical graph hash: a
 * per-path `sha256-…` content hash plus a `combined` `sha256-…` over
 * `${rel}\0${bytes}` for every entry IN THE GIVEN ORDER. This is the single
 * preimage definition; both the async {@link hashGraph} and the sync loader in
 * `loadProject.ts` do their own (async vs symlink-rejecting) I/O and then call
 * this, so the two paths can never drift.
 */
export function combineGraphHash(entries: Iterable<readonly [string, Buffer]>): GraphHash {
  const byPath: Record<string, string> = {};
  const combined = createHash('sha256');
  for (const [rel, bytes] of entries) {
    byPath[rel] = `sha256-${createHash('sha256').update(bytes).digest('hex')}`;
    combined.update(`${rel}\0`).update(bytes);
  }
  return { combined: `sha256-${combined.digest('hex')}`, byPath };
}

/** Content hash the complete file set at `relPaths` under `projectDir`. */
export async function hashGraph(projectDir: string, relPaths: readonly string[]): Promise<GraphHash> {
  const entries: [string, Buffer][] = [];
  for (const rel of relPaths) {
    entries.push([rel, await readFile(path.join(projectDir, rel))]);
  }
  return combineGraphHash(entries);
}

/** True when every declared path exists under `projectDir`. */
export async function allExist(projectDir: string, relPaths: readonly string[]): Promise<boolean> {
  for (const rel of relPaths) {
    try {
      await access(path.join(projectDir, rel));
    } catch {
      return false;
    }
  }
  return true;
}

/** Delete every declared generated-graph file (missing files are ignored). */
export async function deleteGraph(projectDir: string, relPaths: readonly string[] = GENERATED_GRAPH): Promise<void> {
  for (const rel of relPaths) {
    await rm(path.join(projectDir, rel), { force: true });
  }
}
