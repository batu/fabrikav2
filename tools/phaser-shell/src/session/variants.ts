// Deterministic P0/A/B authoring variants driven through the installed Phaser
// Editor's own workbench + scene model. Every variant starts from an independent
// reset scratch outside the repository. Canonical authoring bytes are read-only.
import type { ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { resetToScratch, type ScratchResult } from '../reset.ts';
import { captureProvenance } from './provenance.ts';
import { SCENE_AUTHORITY, hashGraph } from './graph.ts';
import {
  getServerMode,
  resolveServerBin,
  startEditorServer,
  stopEditorServer,
  ServerBlocked,
} from './editorServer.ts';
import { closeConnectedCdpBrowser, closeWorkbench, openWorkbench, WorkbenchBlocked, type Workbench } from './workbench.ts';
import { assertNoLeaks, scrubText, type ProvenanceEvidence, type ServerMode } from './evidence.ts';
import { PathBlocked, REPO_ROOT, resolveScratch } from './paths.ts';

export const VARIANT_ORDER = ['p0', 'a', 'b'] as const;
export type VariantId = (typeof VARIANT_ORDER)[number];
export type EditBundleId = Exclude<VariantId, 'p0'>;

type TextEdit = {
  scene: `${string}.scene`;
  semanticId: string;
  property: 'text';
  value: string;
};

type PositionEdit = {
  scene: `${string}.scene`;
  semanticId: string;
  property: 'x' | 'y';
  value: number;
};

type TextureEdit = {
  scene: `${string}.scene`;
  semanticId: string;
  property: 'texture';
  value: { key: string; frame?: string | number };
};

export type VariantEdit = TextEdit | PositionEdit | TextureEdit;

const EDIT_BUNDLES: Readonly<Record<EditBundleId, readonly VariantEdit[]>> = {
  a: [
    { scene: 'Menu.scene', semanticId: 'menu.title', property: 'text', value: 'Morning Shell' },
    { scene: 'Menu.scene', semanticId: 'menu.title', property: 'x', value: 207 },
  ],
  b: [
    {
      scene: 'Menu.scene',
      semanticId: 'menu.settings',
      property: 'texture',
      value: { key: 'icon_control_confirm' },
    },
    { scene: 'Menu.scene', semanticId: 'menu.settings', property: 'x', value: 358.4 },
  ],
};

/** Ordered matched-edit bundles: B is explicitly A followed by the second bundle. */
export function bundleOrderForVariant(variant: VariantId): EditBundleId[] {
  if (variant === 'p0') return [];
  if (variant === 'a') return ['a'];
  return ['a', 'b'];
}

export interface VariantStage {
  bundle: EditBundleId;
  edits: VariantEdit[];
}

/** The actual ordered workbench stages; B is two saves, A first and B second. */
export function stagesForVariant(variant: VariantId): VariantStage[] {
  return bundleOrderForVariant(variant).map((bundle) => ({
    bundle,
    edits: structuredClone(EDIT_BUNDLES[bundle]) as VariantEdit[],
  }));
}

/** Return a defensive copy so callers cannot mutate the declared recipe. */
export function recipeForVariant(variant: VariantId): VariantEdit[] {
  return stagesForVariant(variant).flatMap((stage) => stage.edits);
}

export interface VariantFact {
  scene: string;
  semanticId: string;
  property: VariantEdit['property'];
  expected: VariantEdit['value'];
  observed: unknown;
  matches: boolean;
}

export interface VariantEvidence {
  schema: 'u5.phaser.variant/1';
  variant: VariantId;
  result: 'ok' | 'blocked';
  code?: string;
  detail?: string;
  p0Hash: string;
  bundleOrder: readonly EditBundleId[];
  recipe: readonly VariantEdit[];
  port: number;
  editServerMode: ServerMode | null;
  editEndpointDownProven: boolean;
  authority: {
    fresh: string | null;
    afterEditor: string | null;
    final: string | null;
  };
  bundleCheckpoints: ReadonlyArray<{
    bundle: EditBundleId;
    authority: string;
    facts: readonly VariantFact[];
  }>;
  factsAfterEditor: readonly VariantFact[];
  factsAfterRestart: readonly VariantFact[];
  provenance: ProvenanceEvidence | null;
}

export interface VariantRunOptions {
  variant: VariantId;
  scratch: string;
  project: string;
  p0Hash: string;
  port: number;
  serverBin?: string;
}

export interface VariantRunResult {
  variant: VariantId;
  result: 'ok' | 'blocked';
  code?: string;
  scratch: string;
  project: string;
  p0Hash: string;
  evidencePath: string;
  evidence: VariantEvidence;
}

export type MakeScratch = () => Promise<ScratchResult>;
export type ExecuteVariant = (options: VariantRunOptions) => Promise<VariantRunResult>;

export interface VariantMatrixOptions {
  portBase?: number;
  serverBin?: string;
  /** Test seam; production defaults to a unique `resetToScratch()` call. */
  makeScratch?: MakeScratch;
  /** Test seam; production defaults to the real Editor runner. */
  execute?: ExecuteVariant;
}

/**
 * Mint and execute P0, A, and B sequentially. They intentionally never share a
 * scratch or a live Editor singleton, preventing state inheritance by design.
 */
export async function runVariantMatrix(options: VariantMatrixOptions = {}): Promise<VariantRunResult[]> {
  const makeScratch = options.makeScratch ?? (() => resetToScratch());
  const execute = options.execute ?? runEditorVariant;
  const portBase = options.portBase ?? 19_610;
  const results: VariantRunResult[] = [];

  for (const [index, variant] of VARIANT_ORDER.entries()) {
    const fresh = await makeScratch();
    results.push(await execute({
      variant,
      scratch: fresh.scratch,
      project: fresh.project,
      p0Hash: fresh.p0Hash,
      port: portBase + index,
      serverBin: options.serverBin,
    }));
  }
  return results;
}

/**
 * Apply one declared variant through real Editor model operations, then delegate
 * compile-twice + restart/reopen hashing to the proven provenance driver.
 */
export async function runEditorVariant(options: VariantRunOptions): Promise<VariantRunResult> {
  const recipe = recipeForVariant(options.variant);
  const runId = randomUUID().slice(0, 8);
  let evidencePath = path.join(os.tmpdir(), `u5-variant-${options.variant}-${runId}.json`);
  const evidence: VariantEvidence = {
    schema: 'u5.phaser.variant/1',
    variant: options.variant,
    result: 'blocked',
    p0Hash: options.p0Hash,
    bundleOrder: bundleOrderForVariant(options.variant),
    recipe,
    port: options.port,
    editServerMode: null,
    editEndpointDownProven: false,
    authority: { fresh: null, afterEditor: null, final: null },
    bundleCheckpoints: [],
    factsAfterEditor: [],
    factsAfterRestart: [],
    provenance: null,
  };

  let server: ChildProcess | null = null;
  let workbench: Workbench | null = null;
  let project = options.project;
  let scratch = options.scratch;
  let roots: string[] = [REPO_ROOT, os.homedir(), scratch, project];

  try {
    const layout = resolveScratch(scratch);
    scratch = layout.scratch;
    project = layout.project;
    roots = [REPO_ROOT, os.homedir(), scratch, project, layout.plugins];
    if (path.resolve(options.project) !== project) {
      throw new VariantBlocked('scratch-project-mismatch', 'the project is not the resolved reset scratch project');
    }
    evidencePath = path.join(scratch, 'evidence', `variant-${options.variant}.json`);
    evidence.authority.fresh = (await hashGraph(project, SCENE_AUTHORITY)).combined;

    if (recipe.length > 0) {
      const serverBin = resolveServerBin(options.serverBin);
      roots.push(serverBin);
      server = await startEditorServer({
        projectDir: project,
        pluginsDir: layout.plugins,
        port: options.port,
        serverBin,
      });
      evidence.editServerMode = await getServerMode(options.port);
      if (!evidence.editServerMode.desktop || !evidence.editServerMode.unlocked) {
        throw new VariantBlocked('server-mode', 'the editor is not a desktop, unlocked session');
      }

      workbench = await openWorkbench(options.port);
      const cumulative: VariantEdit[] = [];
      for (const stage of stagesForVariant(options.variant)) {
        await applyRecipeThroughWorkbench(workbench.page, stage.edits);
        cumulative.push(...stage.edits);
        const facts = await readVariantFacts(project, cumulative);
        assertFacts(facts);
        evidence.bundleCheckpoints = [
          ...evidence.bundleCheckpoints,
          {
            bundle: stage.bundle,
            authority: (await hashGraph(project, SCENE_AUTHORITY)).combined,
            facts,
          },
        ];
      }
      await closeWorkbench(workbench);
      workbench = null;
      evidence.editEndpointDownProven = await stopEditorServer(server, options.port);
      server = null;
      if (!evidence.editEndpointDownProven) {
        throw new VariantBlocked('endpoint-not-down', 'the edit-session loopback endpoint did not go down');
      }
    }

    evidence.authority.afterEditor = (await hashGraph(project, SCENE_AUTHORITY)).combined;
    evidence.factsAfterEditor = await readVariantFacts(project, recipe);
    assertFacts(evidence.factsAfterEditor);
    if (options.variant === 'p0' && evidence.authority.afterEditor !== evidence.authority.fresh) {
      throw new VariantBlocked('p0-mutated', 'P0 changed before provenance capture');
    }
    if (options.variant !== 'p0' && evidence.authority.afterEditor === evidence.authority.fresh) {
      throw new VariantBlocked('variant-noop', 'the Editor operations did not change scene authority');
    }

    const provenancePath = path.join(scratch, 'evidence', `provenance-${options.variant}.json`);
    const provenance = await captureProvenance({
      scratch,
      output: provenancePath,
      port: options.port,
      serverBin: options.serverBin,
    });
    evidence.provenance = provenance.evidence;
    if (provenance.result !== 'ok') {
      throw new VariantBlocked(provenance.code ?? 'provenance-blocked', 'the compile/restart provenance protocol blocked');
    }

    evidence.authority.final = (await hashGraph(project, SCENE_AUTHORITY)).combined;
    evidence.factsAfterRestart = await readVariantFacts(project, recipe);
    assertFacts(evidence.factsAfterRestart);
    if (evidence.authority.final !== evidence.authority.afterEditor) {
      throw new VariantBlocked('variant-authority-drift', 'scene authority drifted across compile/save/restart/reopen');
    }
    if (options.variant === 'p0' && evidence.authority.final !== evidence.authority.fresh) {
      throw new VariantBlocked('p0-mutated', 'P0 changed across the Editor provenance protocol');
    }
    if (!provenance.evidence.compile.deterministic
      || !provenance.evidence.authority.stableAcrossRestart
      || !provenance.evidence.generated.stableAcrossRestart
      || !provenance.evidence.restart.endpointDownProven) {
      throw new VariantBlocked('provenance-incomplete', 'compile/restart evidence was not complete');
    }

    evidence.result = 'ok';
    await writeVariantEvidence(evidencePath, evidence, roots);
    return result(options, scratch, project, evidencePath, evidence);
  } catch (error) {
    evidence.result = 'blocked';
    evidence.code = blockCode(error);
    evidence.detail = scrubText(errorMessage(error), roots);
    await writeVariantEvidence(evidencePath, evidence, roots);
    return result(options, scratch, project, evidencePath, evidence);
  } finally {
    await closeWorkbench(workbench);
    await closeConnectedCdpBrowser();
    if (server) {
      try {
        await stopEditorServer(server, options.port);
      } catch {
        // The typed blocked result has already captured the primary failure.
      }
    }
  }
}

class VariantBlocked extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'VariantBlocked';
  }
}

/** Open each affected scene, add native undo/model operations, save, and close. */
async function applyRecipeThroughWorkbench(page: Page, recipe: readonly VariantEdit[]): Promise<void> {
  const byScene = new Map<string, VariantEdit[]>();
  for (const edit of recipe) {
    const edits = byScene.get(edit.scene) ?? [];
    edits.push(edit);
    byScene.set(edit.scene, edits);
  }

  for (const [sceneFile, edits] of byScene) {
    const sceneLiteral = JSON.stringify(sceneFile);
    const editsLiteral = JSON.stringify(edits);
    await page.evaluate(
      `(async () => {
        const FileUtils = globalThis.colibri.ui.ide.FileUtils;
        const root = FileUtils.getRoot();
        const find = (file) => {
          if (file.getName() === ${sceneLiteral}) return file;
          for (const child of (file.getFiles?.() ?? [])) {
            const hit = find(child);
            if (hit) return hit;
          }
          return null;
        };
        const file = find(root);
        if (!file) throw new Error('scene not found: ' + ${sceneLiteral});
        const editor = await globalThis.colibri.Platform.getWorkbench().openEditor(file);
        if (!editor?.isGameReadyPromise) throw new Error('scene readiness API unavailable: ' + ${sceneLiteral});
        await editor.isGameReadyPromise();
        await editor.isGameReadyPromise();
      })()`,
    );
    await page.waitForFunction(
      `globalThis.colibri.Platform.getWorkbench().getActiveEditor()?.getInput?.()?.getName?.() === ${sceneLiteral}`,
      undefined,
      { timeout: 30_000 },
    );
    await page.waitForFunction(
      `(() => {
        const wb = globalThis.colibri.Platform.getWorkbench();
        const editor = wb.getEditors().find((candidate) => candidate.getInput?.()?.getName?.() === ${sceneLiteral});
        return Boolean(editor?.getScene?.() && ${editsLiteral}.every((edit) => editor.getScene().getByEditorId(edit.semanticId)));
      })()`,
      undefined,
      { timeout: 30_000 },
    );

    await page.evaluate(
      `(async () => {
        const edits = ${editsLiteral};
        const wb = globalThis.colibri.Platform.getWorkbench();
        const editor = wb.getEditors().find((candidate) => candidate.getInput?.()?.getName?.() === ${sceneLiteral});
        if (!editor) throw new Error('opened scene editor disappeared: ' + ${sceneLiteral});
        await editor.isGameReadyPromise();
        const objects = globalThis.phasereditor2d?.scene?.ui?.sceneobjects;
        if (!objects?.SimpleOperation) throw new Error('Editor SimpleOperation API is unavailable');

        for (const edit of edits) {
          const object = editor.getScene().getByEditorId(edit.semanticId);
          if (!object) throw new Error('semantic object not found: ' + edit.semanticId);
          let property;
          if (edit.property === 'text') property = objects.TextContentComponent?.text;
          else if (edit.property === 'x') property = objects.TransformComponent?.x;
          else if (edit.property === 'y') property = objects.TransformComponent?.y;
          else if (edit.property === 'texture') {
            property = objects.TextureComponent?.texture;
            const asset = editor.getSceneMaker().getPackFinder().findAssetPackItem(edit.value.key);
            if (!asset) throw new Error('texture asset not found: ' + edit.value.key);
          }
          if (!property || !object.getEditorSupport().hasProperty(property)) {
            throw new Error('unsupported Editor property ' + edit.property + ' on ' + edit.semanticId);
          }
          await editor.getUndoManager().add(new objects.SimpleOperation(editor, [object], property, edit.value));
          const observed = property.getValue(object);
          if (JSON.stringify(observed) !== JSON.stringify(edit.value)) {
            throw new Error('Editor operation did not apply ' + edit.property + ' on ' + edit.semanticId);
          }
        }

        await editor.save();
        wb.getActiveWindow().getEditorArea().closeEditors([editor]);
      })()`,
    );
    await page.waitForTimeout(750);
  }
}

/** Parse post-save scene authority only to assert that real Editor edits persisted. */
export async function readVariantFacts(project: string, recipe: readonly VariantEdit[]): Promise<VariantFact[]> {
  const sceneCache = new Map<string, { displayList?: Array<Record<string, unknown>> }>();
  const facts: VariantFact[] = [];
  for (const edit of recipe) {
    let scene = sceneCache.get(edit.scene);
    if (!scene) {
      scene = JSON.parse(await readFile(path.join(project, 'src', 'scenes', edit.scene), 'utf8')) as {
        displayList?: Array<Record<string, unknown>>;
      };
      sceneCache.set(edit.scene, scene);
    }
    const object = scene.displayList?.find((candidate) =>
      candidate['Semantic.fabSemanticId'] === edit.semanticId || candidate.id === edit.semanticId);
    const observed = edit.property === 'texture' ? object?.texture : object?.[edit.property];
    facts.push({
      scene: edit.scene,
      semanticId: edit.semanticId,
      property: edit.property,
      expected: edit.value,
      observed,
      matches: JSON.stringify(observed) === JSON.stringify(edit.value),
    });
  }
  return facts;
}

function assertFacts(facts: readonly VariantFact[]): void {
  const mismatch = facts.find((fact) => !fact.matches);
  if (mismatch) {
    throw new VariantBlocked(
      'variant-fact-mismatch',
      `saved ${mismatch.scene} does not contain ${mismatch.semanticId}.${mismatch.property}`,
    );
  }
}

async function writeVariantEvidence(
  output: string,
  evidence: VariantEvidence,
  sensitiveRoots: readonly string[],
): Promise<void> {
  assertNoLeaks(evidence, sensitiveRoots);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
}

function result(
  options: VariantRunOptions,
  scratch: string,
  project: string,
  evidencePath: string,
  evidence: VariantEvidence,
): VariantRunResult {
  return {
    variant: options.variant,
    result: evidence.result,
    code: evidence.code,
    scratch,
    project,
    p0Hash: options.p0Hash,
    evidencePath,
    evidence,
  };
}

function blockCode(error: unknown): string {
  if (error instanceof VariantBlocked
    || error instanceof ServerBlocked
    || error instanceof WorkbenchBlocked
    || error instanceof PathBlocked) {
    return error.code;
  }
  return 'variant-session-error';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
