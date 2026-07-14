// Shared test helpers: resolve repo-anchored paths independent of the cwd the
// unit runner is invoked from.
import { fileURLToPath } from 'node:url';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { GENERATED_GRAPH, SCENE_AUTHORITY, SCENE_ORDER, hashGraph } from '../src/session/graph.ts';
import type { ProvenanceEvidence } from '../src/session/evidence.ts';

/** Absolute path to the repository root (three levels above this test dir). */
export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** Resolve a repo-relative path to an absolute one. */
export function repoPath(...segments: string[]): string {
  return path.join(REPO_ROOT, ...segments);
}

/** Read + JSON-parse a repo-relative file. */
export function readJson(...segments: string[]): unknown {
  return JSON.parse(readFileSync(repoPath(...segments), 'utf8'));
}

/**
 * Unit-fixture helper: bind a successful provenance-shaped seal to the exact
 * current scratch bytes. Production evidence is emitted only by the real
 * Editor protocol; tests use this deterministic fixture to exercise promotion.
 */
export async function sealScratchProvenance(scratch: string, project: string): Promise<void> {
  const authority = await hashGraph(project, SCENE_AUTHORITY);
  const generated = await hashGraph(project, GENERATED_GRAPH);
  const evidence: ProvenanceEvidence = {
    schema: 'u5.phaser.provenance/1',
    runId: 'unit-fixture',
    result: 'ok',
    serverMode: { desktop: true, unlocked: true },
    serverModeAfterRestart: { desktop: true, unlocked: true },
    port: 19_592,
    sceneOrder: SCENE_ORDER,
    generatedGraph: GENERATED_GRAPH,
    sceneAuthority: SCENE_AUTHORITY,
    compile: { generation1: generated, generation2: generated, deterministic: true },
    authority: {
      beforeCombined: authority.combined,
      afterSaveCombined: authority.combined,
      reopenCombined: authority.combined,
      stableAcrossRestart: true,
      byPathAfterSave: authority.byPath,
    },
    generated: {
      afterSaveCombined: generated.combined,
      reopenCombined: generated.combined,
      stableAcrossRestart: true,
      byPathAfterSave: generated.byPath,
    },
    restart: { endpointDownProven: true },
    startedAt: '2026-01-01T00:00:00.000Z',
    endedAt: '2026-01-01T00:00:01.000Z',
  };
  const dir = path.join(scratch, 'evidence');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'provenance-unit-fixture.json'), JSON.stringify(evidence, null, 2) + '\n');
}
