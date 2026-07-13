import {
  canonicalizeJson,
  createDefaultShellPresentationV2,
  parseShellPresentationV2,
  shellPresentationContractV2,
  type ShellAssetCatalog,
  type ShellFitMode,
  type ShellPresentationDocumentV2,
  type ShellPresentationInstance,
  type ShellRect,
  type ShellStateIdV2,
  type ShellVisualPresentation,
} from "@fabrikav2/kernel";

import { normalizeSemanticLayout } from "./layout.ts";

const PROJECT_FORMAT = "grapes-shell-project-v2";
const PROJECT_VERSION = 2;
export const GRAPES_TARGET_GAME = "shell_proof_grapes";
const TARGET_GAME = /^[a-z][a-z0-9_]*$/u;

interface ConstrainedGrapesComponent {
  readonly id: string;
  readonly prototypeInstanceId: string;
  readonly parentInstanceId: string | null;
  readonly stateId: ShellStateIdV2;
  readonly roleId: string;
  readonly bindingId: string;
  readonly stateFamilyId: string;
  readonly actionId?: string;
  readonly accessibility: ShellPresentationInstance["accessibility"];
  readonly presentation: ShellPresentationInstance["presentation"];
  readonly variants: ShellPresentationInstance["variants"];
}

interface ConstrainedGrapesPage {
  readonly id: string;
  readonly name: string;
  readonly components: readonly ConstrainedGrapesComponent[];
}

export interface ConstrainedGrapesProject {
  readonly format: "grapesjs-constrained-project-v2";
  readonly pages: readonly ConstrainedGrapesPage[];
}

export interface GrapesShellProject {
  readonly format: typeof PROJECT_FORMAT;
  readonly version: typeof PROJECT_VERSION;
  readonly targetGame: string;
  readonly presentation: ShellPresentationDocumentV2;
  readonly grapesjs: ConstrainedGrapesProject;
}

export interface DuplicateResult {
  readonly project: GrapesShellProject;
  readonly instanceId: string;
}

export type ReorderDirection = "forward" | "backward";

export class ProjectValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectValidationError";
  }
}

const UNSAFE_KEYS = new Set([
  "script",
  "scripts",
  "html",
  "css",
  "style",
  "styles",
  "url",
  "href",
  "src",
  "attributes",
  "handler",
  "handlers",
  "function",
  "expression",
]);
const UNSAFE_STRING = /(?:javascript|data|blob|file)\s*:|https?:\/\/|<\/?(?:script|svg)\b|\bon[a-z]+\s*=/iu;

export function asProjectRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ProjectValidationError(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(value: Record<string, unknown>, expected: readonly string[], path: string): void {
  const allowed = new Set(expected);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new ProjectValidationError(`${path}.${key} is unsupported.`);
  }
  for (const key of expected) {
    if (!(key in value)) throw new ProjectValidationError(`${path}.${key} is required.`);
  }
}

function assertInertJson(value: unknown, path = "$", depth = 0, count = { value: 0 }): void {
  if (depth > 48) throw new ProjectValidationError(`${path} exceeds the maximum JSON depth.`);
  count.value += 1;
  if (count.value > 10_000) throw new ProjectValidationError("Project JSON exceeds the maximum node count.");
  if (typeof value === "string") {
    if (UNSAFE_STRING.test(value) || value.includes("../") || value.includes("\\")) {
      throw new ProjectValidationError(`${path} contains an unsafe URL, path, or active markup.`);
    }
    return;
  }
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertInertJson(entry, `${path}[${index}]`, depth + 1, count));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (UNSAFE_KEYS.has(key) || /^on[a-z]/iu.test(key)) {
      throw new ProjectValidationError(`${path}.${key} is unsupported in a constrained project.`);
    }
    assertInertJson(child, `${path}.${key}`, depth + 1, count);
  }
}

function pageName(stateId: ShellStateIdV2): string {
  return shellPresentationContractV2.states.find((state) => state.id === stateId)?.label ?? stateId;
}

export function createConstrainedGrapesProject(document: ShellPresentationDocumentV2): ConstrainedGrapesProject {
  return {
    format: "grapesjs-constrained-project-v2",
    pages: document.pages.map((page) => ({
      id: page.editorPageId,
      name: pageName(page.stateId),
      components: page.instances.map((instance) => ({
        id: instance.id,
        prototypeInstanceId: instance.prototypeInstanceId,
        parentInstanceId: instance.parentInstanceId,
        stateId: page.stateId,
        roleId: instance.roleId,
        bindingId: instance.bindingId,
        stateFamilyId: instance.stateFamilyId,
        ...(instance.actionId ? { actionId: instance.actionId } : {}),
        accessibility: structuredClone(instance.accessibility),
        presentation: structuredClone(instance.presentation),
        variants: structuredClone(instance.variants),
      })),
    })),
  };
}

function rebuild(presentation: ShellPresentationDocumentV2, targetGame: string): GrapesShellProject {
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    targetGame,
    presentation,
    grapesjs: createConstrainedGrapesProject(presentation),
  };
}

// Starter raster assignments. Every ID resolves through U1's canonical asset
// catalog and targets the slot its semantic role owns (role.assetSlotId ===
// asset.slotId); slots with no curated raster (title, hero, gameplay, modal,
// toggle) intentionally start without an asset.
function assignStarterAssets(document: ShellPresentationDocumentV2): ShellPresentationDocumentV2 {
  const assets: Record<string, string> = {
    "menu.currency": "counter-frame.primary-currency",
    "menu.settings": "icon-control.settings",
    "menu.shop": "icon-control.shop",
    "menu.play": "button-surface.primary",
    "menu.node.completed": "progression-node.completed",
    "menu.node.current": "progression-node.current",
    "menu.node.locked": "progression-node.locked",
    "level.currency": "counter-frame.primary-currency",
    "level.pause": "icon-control.pause",
    "level.test-win": "button-surface.test-win",
    "level.test-lose": "button-surface.test-lose",
    "shop.back": "icon-control.back",
    "shop.currency": "counter-frame.primary-currency",
    "shop.currency.secondary": "counter-frame.primary-currency",
    "shop.restore": "button-surface.secondary",
    "settings.back": "icon-control.back",
    "pause.resume": "button-surface.primary",
    "pause.settings": "button-surface.secondary",
    "pause.home": "button-surface.secondary",
    "win.next": "button-surface.primary",
    "win.claim": "button-surface.primary",
    "win.home": "button-surface.secondary",
    "win.claim-double": "button-surface.secondary",
    "fail.retry": "button-surface.primary",
    "fail.currency": "counter-frame.primary-currency",
    "fail.continue-coins": "button-surface.secondary",
    "fail.bundle": "button-surface.secondary",
  };
  const clone = structuredClone(document);
  for (const page of clone.pages) {
    for (const instance of page.instances) {
      const assetId = assets[instance.id];
      if (assetId) instance.presentation.assetId = assetId;
    }
  }
  return clone;
}

// Neutral-seed projection of the rewired U1 shell. U1's contract wires
// menu.shop / menu.play / menu.settings under the menu.nav dock and defines the
// win/fail result panels, but its default geometry still anchors Shop/Settings
// as top-right icons and its default copy omits the concrete reward, balance,
// cost, and price a player must read. These overrides seat the dock trio on the
// menu.nav bar and surface those required source-grounded facts. They restyle
// nothing (no colors, no fonts) and stay inside each role's geometry caps, safe
// bounds, and copy limits; normalizeSemanticLayout re-derives the closed-AST
// geometry from the target bounds so editor and portable project identically.
interface SeedBounds {
  readonly bounds: ShellRect;
  readonly fit: ShellFitMode;
}

// The menu.nav dock bar projects to x[19.5, 370.5], y[719.88, 794.98]. Shop sits
// at the leading edge, Play is centered and dominant, Settings at the trailing
// edge — all seated on that bar so the phone reads as a real bottom dock.
const DOCK_LAYOUT: Readonly<Record<string, SeedBounds>> = {
  "menu.shop": { bounds: { x: 30, y: 729, width: 56, height: 56 }, fit: "contain" },
  "menu.play": { bounds: { x: 100, y: 727, width: 190, height: 60 }, fit: "cover" },
  "menu.settings": { bounds: { x: 304, y: 729, width: 56, height: 56 }, fit: "contain" },
};

// Source-grounded win/fail facts, taken from the U1 Find-the-Dog shell reference
// (games/shell_proof_grapes/evidence/2026-07-13-ftd-structure-rewire) and the
// shell_proof_phaser copy/product source: the win reward readout, the fail coin
// balance, the continue coin cost, the rewarded-ad double-claim, and the priced
// rescue bundle. The rescue bundle is a single leaf action, so — unlike the
// two-line phaser button (fail.bundle label + fail.bundle.sub outcome) — its one
// editable copy field must carry all three facts the player reads: the bundle
// name, its price ($4.99 from proofShopCatalog rescue_bundle), and the outcome it
// grants (fail.bundle.sub = "Continue this level"). A middot separates the facts
// so they read as distinct on one line.
const SEED_COPY: Readonly<Record<string, string>> = {
  "win.reward": "5 Coins earned",
  "win.claim-double": "Claim 2x · Watch ad",
  "fail.currency": "25 Coins",
  "fail.continue-coins": "Continue · 10 Coins",
  "fail.bundle": "Rescue bundle · $4.99 · Continue this level",
};

function authorNeutralSeedProjection(document: ShellPresentationDocumentV2): ShellPresentationDocumentV2 {
  const clone = structuredClone(document);
  for (const page of clone.pages) {
    for (const instance of page.instances) {
      const dock = DOCK_LAYOUT[instance.id];
      if (dock) instance.presentation.geometry = normalizeSemanticLayout(instance.roleId, dock.bounds, dock.fit);
      const copy = SEED_COPY[instance.id];
      if (copy !== undefined) instance.presentation.copy = copy;
    }
  }
  return clone;
}

export function createStarterProject(targetGame = GRAPES_TARGET_GAME): GrapesShellProject {
  if (!TARGET_GAME.test(targetGame)) throw new ProjectValidationError(`Invalid target game "${targetGame}".`);
  return rebuild(authorNeutralSeedProjection(assignStarterAssets(createDefaultShellPresentationV2())), targetGame);
}

export function validateProjectFile(
  value: unknown,
  assetCatalog: ShellAssetCatalog,
  expectedTargetGame?: string,
): GrapesShellProject {
  assertInertJson(value);
  const root = asProjectRecord(value, "$");
  assertExactKeys(root, ["format", "version", "targetGame", "presentation", "grapesjs"], "$");
  if (root.format !== PROJECT_FORMAT) throw new ProjectValidationError("Project format is not supported.");
  if (root.version !== PROJECT_VERSION) throw new ProjectValidationError("Project version is not supported.");
  if (typeof root.targetGame !== "string" || !TARGET_GAME.test(root.targetGame)) {
    throw new ProjectValidationError("Project targetGame is invalid.");
  }
  if (expectedTargetGame && root.targetGame !== expectedTargetGame) {
    throw new ProjectValidationError(
      `Project targets game "${root.targetGame}" instead of requested game "${expectedTargetGame}".`,
    );
  }

  // U1 is the only asset authority: it validates the closed AST and, given the
  // canonical catalog, enforces that every referenced raster exists and targets
  // the slot its semantic role owns (role.assetSlotId === asset.slotId).
  try {
    parseShellPresentationV2(root.presentation, { assetCatalog });
  } catch (error) {
    throw new ProjectValidationError(error instanceof Error ? error.message : "Closed AST validation failed.");
  }

  const expected = createConstrainedGrapesProject(root.presentation as ShellPresentationDocumentV2);
  if (canonicalizeJson(root.grapesjs) !== canonicalizeJson(expected)) {
    throw new ProjectValidationError("GrapesJS data diverges from the canonical closed presentation AST.");
  }
  return rebuild(root.presentation as ShellPresentationDocumentV2, root.targetGame);
}

function findInstance(document: ShellPresentationDocumentV2, instanceId: string): { pageIndex: number; instanceIndex: number } {
  for (const [pageIndex, page] of document.pages.entries()) {
    const instanceIndex = page.instances.findIndex((instance) => instance.id === instanceId);
    if (instanceIndex >= 0) return { pageIndex, instanceIndex };
  }
  throw new ProjectValidationError(`Unknown semantic instance "${instanceId}".`);
}

function nextDuplicateId(document: ShellPresentationDocumentV2, sourceId: string): string {
  const existing = new Set(document.pages.flatMap((page) => page.instances.map((instance) => instance.id)));
  let index = 1;
  while (existing.has(`${sourceId}.copy-${index}`)) index += 1;
  return `${sourceId}.copy-${index}`;
}

export function duplicateInstance(project: GrapesShellProject, instanceId: string): DuplicateResult {
  const document = structuredClone(project.presentation);
  const { pageIndex, instanceIndex } = findInstance(document, instanceId);
  const page = document.pages[pageIndex]!;
  const source = page.instances[instanceIndex]!;
  const order = Math.max(...page.instances.map((instance) => instance.presentation.order), -1) + 1;
  const copiedId = nextDuplicateId(document, source.id);
  page.instances.push({
    ...structuredClone(source),
    id: copiedId,
    presentation: { ...structuredClone(source.presentation), order },
  });
  assignHierarchyOrder(page, siblingInstances(document, pageIndex, source.parentInstanceId), source.parentInstanceId);
  return { project: rebuild(document, project.targetGame), instanceId: copiedId };
}

export function updateInstancePresentation(
  project: GrapesShellProject,
  instanceId: string,
  update: Partial<ShellVisualPresentation>,
  assetCatalog: ShellAssetCatalog,
): GrapesShellProject {
  const document = structuredClone(project.presentation);
  const { pageIndex, instanceIndex } = findInstance(document, instanceId);
  const instance = document.pages[pageIndex]!.instances[instanceIndex]!;
  instance.presentation = { ...instance.presentation, ...structuredClone(update) };
  const candidate = rebuild(document, project.targetGame);
  return validateProjectFile(candidate, assetCatalog);
}

function siblingInstances(
  document: ShellPresentationDocumentV2,
  pageIndex: number,
  parentInstanceId: string | null,
): ShellPresentationInstance[] {
  return document.pages[pageIndex]!.instances
    .filter((instance) => instance.parentInstanceId === parentInstanceId)
    .sort((left, right) => left.presentation.order - right.presentation.order || left.id.localeCompare(right.id));
}

export function canReorderInstance(
  project: GrapesShellProject,
  instanceId: string,
  direction: ReorderDirection,
): boolean {
  const { pageIndex, instanceIndex } = findInstance(project.presentation, instanceId);
  const instance = project.presentation.pages[pageIndex]!.instances[instanceIndex]!;
  const siblings = siblingInstances(project.presentation, pageIndex, instance.parentInstanceId);
  const index = siblings.findIndex((candidate) => candidate.id === instanceId);
  const targetIndex = direction === "forward" ? index + 1 : index - 1;
  return index >= 0 && targetIndex >= 0 && targetIndex < siblings.length;
}

function assignHierarchyOrder(
  page: ShellPresentationDocumentV2["pages"][number],
  siblingOverride: readonly ShellPresentationInstance[],
  parentInstanceId: string | null,
): void {
  const children = new Map<string | null, ShellPresentationInstance[]>();
  for (const instance of page.instances) {
    const group = children.get(instance.parentInstanceId) ?? [];
    group.push(instance);
    children.set(instance.parentInstanceId, group);
  }
  for (const group of children.values()) {
    group.sort((left, right) => left.presentation.order - right.presentation.order || left.id.localeCompare(right.id));
  }
  children.set(parentInstanceId, [...siblingOverride]);

  let nextOrder = 0;
  const visit = (instance: ShellPresentationInstance): void => {
    instance.presentation.order = nextOrder;
    nextOrder += 1;
    for (const child of children.get(instance.id) ?? []) visit(child);
  };
  for (const root of children.get(null) ?? []) visit(root);
}

export function reorderInstance(
  project: GrapesShellProject,
  instanceId: string,
  direction: ReorderDirection,
  assetCatalog: ShellAssetCatalog,
): GrapesShellProject {
  const { pageIndex, instanceIndex } = findInstance(project.presentation, instanceId);
  const instance = project.presentation.pages[pageIndex]!.instances[instanceIndex]!;
  const siblings = siblingInstances(project.presentation, pageIndex, instance.parentInstanceId);
  const siblingIndex = siblings.findIndex((candidate) => candidate.id === instanceId);
  const targetIndex = direction === "forward" ? siblingIndex + 1 : siblingIndex - 1;
  if (siblingIndex < 0 || targetIndex < 0 || targetIndex >= siblings.length) return project;

  const reorderedIds = siblings.map((sibling) => sibling.id);
  [reorderedIds[siblingIndex], reorderedIds[targetIndex]] = [reorderedIds[targetIndex]!, reorderedIds[siblingIndex]!];
  const document = structuredClone(project.presentation);
  const page = document.pages[pageIndex]!;
  const byId = new Map(page.instances.map((candidate) => [candidate.id, candidate]));
  assignHierarchyOrder(page, reorderedIds.map((id) => byId.get(id)!), instance.parentInstanceId);
  return validateProjectFile(rebuild(document, project.targetGame), assetCatalog);
}
