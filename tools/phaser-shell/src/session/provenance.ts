// Real-Editor provenance capture (P6 §6, KTD-I). This is the executable seam the
// vendor-gated GUI leg runs: from an explicit unique scratch OUTSIDE the repo it
// starts the loopback-only licensed editor, gates on desktop+unlocked mode,
// deletes the entire declared generated graph and invokes Workbench CompileProject
// TWICE, byte-compares the complete graph (deterministic-regen proof), opens+saves
// all seven scenes in canonical order, then FULLY terminates (proving the loopback
// endpoint is down), restarts/reopens the same scratch, and re-verifies the scene
// authority + generated graph are byte-stable. It emits scrubbed hash-only evidence.
//
// It is a TOOL: one call runs the fixed measurement protocol and always RETURNS a
// typed result — it never loops, self-directs, or fakes a pass. Any unavailability
// (no license, web-mode server, no browser, nondeterministic regen, drift) is a
// typed `blocked` with a scrubbed reason, and the CLI maps that to a nonzero exit.
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import type { ChildProcess } from 'node:child_process';
import { resolveScratch, resolveOutput, REPO_ROOT, PathBlocked, type ScratchLayout } from './paths.ts';
import {
  GENERATED_GRAPH,
  SCENE_AUTHORITY,
  SCENE_ORDER,
  SCENE_FILES,
  allExist,
  deleteGraph,
  hashGraph,
  type GraphHash,
} from './graph.ts';
import {
  startEditorServer,
  stopEditorServer,
  getServerMode,
  resolveServerBin,
  ServerBlocked,
} from './editorServer.ts';
import { openWorkbench, closeWorkbench, compileProject, openAndSaveScene, WorkbenchBlocked, type Workbench } from './workbench.ts';
import { scrubText, writeEvidence, type ProvenanceEvidence } from './evidence.ts';

export interface CaptureOptions {
  /** Explicit scratch root (outside the repo) minted by `reset`. */
  scratch: string | undefined;
  /** Evidence output path; defaults to `<scratch>/evidence/provenance-<runId>.json`. */
  output?: string;
  /** Loopback port for the editor server. */
  port?: number;
  /** Override the editor server binary (else env `PHASER_EDITOR_SERVER` → install path). */
  serverBin?: string;
}

export interface CaptureResult {
  result: 'ok' | 'blocked';
  code?: string;
  evidencePath: string;
  evidence: ProvenanceEvidence;
}

const DEFAULT_PORT = 19_592;
const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Poll until the whole generated graph exists, up to `timeoutMs`. */
async function waitForGraph(projectDir: string, timeoutMs = 30_000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await allExist(projectDir, GENERATED_GRAPH)) return true;
    await delay(250);
  }
  return false;
}

/**
 * Run the provenance protocol. Returns a typed ok/blocked result and always
 * writes the scrubbed hash-only evidence file (best-effort on hard failures).
 */
export async function captureProvenance(opts: CaptureOptions): Promise<CaptureResult> {
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const port = opts.port ?? DEFAULT_PORT;
  const startedAt = new Date().toISOString();

  // Mutable evidence draft; every field is hash/bool/int/relative-name only.
  const ev: ProvenanceEvidence = {
    schema: 'u5.phaser.provenance/1',
    runId,
    result: 'blocked',
    serverMode: { desktop: false, unlocked: false },
    serverModeAfterRestart: null,
    port,
    sceneOrder: SCENE_ORDER,
    generatedGraph: GENERATED_GRAPH,
    sceneAuthority: SCENE_AUTHORITY,
    compile: { generation1: null, generation2: null, deterministic: false },
    authority: { beforeCombined: null, afterSaveCombined: null, reopenCombined: null, stableAcrossRestart: false, byPathAfterSave: null },
    generated: { afterSaveCombined: null, reopenCombined: null, stableAcrossRestart: false, byPathAfterSave: null },
    restart: { endpointDownProven: false },
    startedAt,
    endedAt: startedAt,
  };

  // Guard the scratch before spawning anything (fail-closed, GUI-free).
  let layout: ScratchLayout;
  try {
    layout = resolveScratch(opts.scratch);
  } catch (err) {
    const code = err instanceof PathBlocked ? err.code : 'scratch-invalid';
    // The scratch is unusable, so default the evidence OUTSIDE the repo (tmpdir);
    // an explicit `--out` is still honored by resolveOutput.
    return finalize(ev, resolveOutput(opts.output, os.tmpdir(), runId), code, message(err), sensitiveRoots(opts));
  }

  const output = resolveOutput(opts.output, layout.scratch, runId);
  const serverBin = resolveServerBin(opts.serverBin);
  const roots = sensitiveRoots({ ...opts, scratch: layout.scratch }, layout.project, layout.plugins, serverBin);

  let server: ChildProcess | null = null;
  let wb: Workbench | null = null;
  try {
    // Scene authority before any edit.
    ev.authority.beforeCombined = (await hashGraph(layout.project, SCENE_AUTHORITY)).combined;

    // Start loopback-only server + gate on desktop+unlocked mode.
    server = await startEditorServer({ projectDir: layout.project, port, pluginsDir: layout.plugins, serverBin });
    ev.serverMode = await getServerMode(port);
    if (!ev.serverMode.desktop || !ev.serverMode.unlocked) {
      return finalize(ev, output, 'server-mode', 'editor is not a desktop, unlocked (licensed) session', roots);
    }

    wb = await openWorkbench(port);

    // Deterministic-regen proof: delete the whole graph, CompileProject, twice.
    const gen1 = await regenerate(layout.project, wb);
    if (!gen1) return finalize(ev, output, 'graph-incomplete', 'first CompileProject did not produce the complete generated graph', roots);
    ev.compile.generation1 = gen1;

    const gen2 = await regenerate(layout.project, wb);
    if (!gen2) return finalize(ev, output, 'graph-incomplete', 'second CompileProject did not produce the complete generated graph', roots);
    ev.compile.generation2 = gen2;

    ev.compile.deterministic = gen1.combined === gen2.combined;
    if (!ev.compile.deterministic) {
      return finalize(ev, output, 'compile-nondeterministic', 'the two CompileProject runs produced a different generated graph', roots);
    }

    // Open + save all seven scenes in canonical order.
    for (const sceneFile of SCENE_FILES) {
      await openAndSaveScene(wb.page, sceneFile);
    }
    const authorityAfterSave = await hashGraph(layout.project, SCENE_AUTHORITY);
    const generatedAfterSave = await hashGraph(layout.project, GENERATED_GRAPH);
    ev.authority.afterSaveCombined = authorityAfterSave.combined;
    ev.authority.byPathAfterSave = authorityAfterSave.byPath;
    ev.generated.afterSaveCombined = generatedAfterSave.combined;
    ev.generated.byPathAfterSave = generatedAfterSave.byPath;

    // Fully terminate and PROVE the loopback endpoint is down.
    await closeWorkbench(wb);
    wb = null;
    const down = await stopEditorServer(server, port);
    server = null;
    ev.restart.endpointDownProven = down;
    if (!down) return finalize(ev, output, 'endpoint-not-down', 'the loopback endpoint did not go down after termination', roots);

    // Restart + reopen the SAME scratch, re-gate, and re-verify byte stability.
    server = await startEditorServer({ projectDir: layout.project, port, pluginsDir: layout.plugins, serverBin });
    ev.serverModeAfterRestart = await getServerMode(port);
    if (!ev.serverModeAfterRestart.desktop || !ev.serverModeAfterRestart.unlocked) {
      return finalize(ev, output, 'server-mode-restart', 'the restarted editor is not a desktop, unlocked session', roots);
    }
    wb = await openWorkbench(port);

    const authorityReopen = await hashGraph(layout.project, SCENE_AUTHORITY);
    const generatedReopen = await hashGraph(layout.project, GENERATED_GRAPH);
    ev.authority.reopenCombined = authorityReopen.combined;
    ev.generated.reopenCombined = generatedReopen.combined;
    ev.authority.stableAcrossRestart = authorityReopen.combined === authorityAfterSave.combined;
    ev.generated.stableAcrossRestart = generatedReopen.combined === generatedAfterSave.combined;
    if (!ev.authority.stableAcrossRestart) return finalize(ev, output, 'authority-drift', 'the scene authority changed across restart/reopen', roots);
    if (!ev.generated.stableAcrossRestart) return finalize(ev, output, 'generated-drift', 'the generated graph changed across restart/reopen', roots);

    ev.result = 'ok';
    ev.code = undefined;
    ev.detail = undefined;
    return finalize(ev, output, undefined, undefined, roots);
  } catch (err) {
    const code =
      err instanceof ServerBlocked || err instanceof WorkbenchBlocked || err instanceof PathBlocked
        ? err.code
        : 'session-error';
    return finalize(ev, output, code, message(err), roots);
  } finally {
    await closeWorkbench(wb);
    if (server) {
      try {
        await stopEditorServer(server, port);
      } catch {
        /* best-effort */
      }
    }
  }
}

/** Delete the graph, CompileProject, wait for the complete graph, hash it. */
async function regenerate(projectDir: string, wb: Workbench): Promise<GraphHash | null> {
  await deleteGraph(projectDir);
  await compileProject(wb.page);
  if (!(await waitForGraph(projectDir))) return null;
  await delay(1_000); // let the last write settle
  return hashGraph(projectDir, GENERATED_GRAPH);
}

/** Sensitive roots redacted from every scrubbed detail + asserted absent. */
function sensitiveRoots(opts: CaptureOptions, project?: string, plugins?: string, serverBin?: string): string[] {
  const roots = [REPO_ROOT, os.homedir()];
  if (opts.scratch) roots.push(opts.scratch);
  if (project) roots.push(project);
  if (plugins) roots.push(plugins);
  if (serverBin) roots.push(serverBin);
  return roots.filter(Boolean);
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Stamp result/code/detail, scrub, write, and return. */
async function finalize(
  ev: ProvenanceEvidence,
  output: string,
  code: string | undefined,
  detail: string | undefined,
  roots: readonly string[],
): Promise<CaptureResult> {
  ev.endedAt = new Date().toISOString();
  if (code) {
    ev.result = 'blocked';
    ev.code = code;
    ev.detail = detail ? scrubText(detail, roots) : undefined;
  }
  await writeEvidence(output, ev, roots);
  return { result: ev.result, code: ev.code, evidencePath: output, evidence: ev };
}
