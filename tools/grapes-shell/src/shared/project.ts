import {
  canonicalizeJson,
  createDefaultShellPresentation,
  parseShellPresentation,
  shellPresentationContract,
  type ShellPresentationDocument,
  type ShellPresentationInstance,
  type ShellStateId,
  type ShellVisualPresentation,
} from "@fabrikav2/kernel";

const PROJECT_FORMAT = "grapes-shell-project-v1";
const PROJECT_VERSION = 1;
const TARGET_GAME = /^[a-z][a-z0-9_]*$/u;

export interface SeedAsset {
  readonly id: string;
  readonly file: string;
  readonly source: { readonly pack: string; readonly path: string };
  readonly dimensions: { readonly width: number; readonly height: number };
  readonly alpha: "required";
  readonly compatibleRoles: readonly string[];
  readonly sha256: string;
}

export interface SeedManifest {
  readonly schemaVersion: number;
  readonly seedKind: string;
  readonly canonicalStates: readonly ShellStateId[];
  readonly sources: readonly {
    readonly id: string;
    readonly license: string;
    readonly licenseSha256: string;
  }[];
  readonly assets: readonly SeedAsset[];
}

interface ConstrainedGrapesComponent {
  readonly id: string;
  readonly prototypeInstanceId: string;
  readonly parentInstanceId: string | null;
  readonly stateId: ShellStateId;
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
  readonly format: "grapesjs-constrained-project-v1";
  readonly pages: readonly ConstrainedGrapesPage[];
}

export interface GrapesShellProject {
  readonly format: typeof PROJECT_FORMAT;
  readonly version: typeof PROJECT_VERSION;
  readonly targetGame: string;
  readonly presentation: ShellPresentationDocument;
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

function withoutAssets(document: unknown): unknown {
  const clone = structuredClone(document) as {
    pages?: Array<{ instances?: Array<{ presentation?: Record<string, unknown>; variants?: Record<string, Record<string, unknown>> }> }>;
  };
  for (const page of clone.pages ?? []) {
    for (const instance of page.instances ?? []) {
      delete instance.presentation?.assetId;
      for (const variant of Object.values(instance.variants ?? {})) delete variant.assetId;
    }
  }
  return clone;
}

function assetUses(document: ShellPresentationDocument): Array<{ instance: ShellPresentationInstance; visual: ShellVisualPresentation }> {
  const uses: Array<{ instance: ShellPresentationInstance; visual: ShellVisualPresentation }> = [];
  for (const page of document.pages) {
    for (const instance of page.instances) {
      uses.push({ instance, visual: instance.presentation });
      for (const visual of Object.values(instance.variants)) uses.push({ instance, visual });
    }
  }
  return uses;
}

function validateManifestAssetUses(document: ShellPresentationDocument, manifest: SeedManifest): void {
  const byId = new Map(manifest.assets.map((asset) => [asset.id, asset]));
  const roleSlots = new Map(shellPresentationContract.roles.map((role) => [role.id, role.assetSlotId]));
  for (const { instance, visual } of assetUses(document)) {
    if (!visual.assetId) continue;
    const asset = byId.get(visual.assetId);
    if (!asset) throw new ProjectValidationError(`Unknown curated asset "${visual.assetId}".`);
    if (!asset.compatibleRoles.includes(instance.roleId)) {
      throw new ProjectValidationError(
        `Asset "${visual.assetId}" is not compatible with semantic role "${instance.roleId}" (${String(roleSlots.get(instance.roleId))}).`,
      );
    }
  }
}

function pageName(stateId: ShellStateId): string {
  return shellPresentationContract.states.find((state) => state.id === stateId)?.label ?? stateId;
}

export function createConstrainedGrapesProject(document: ShellPresentationDocument): ConstrainedGrapesProject {
  return {
    format: "grapesjs-constrained-project-v1",
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

function rebuild(presentation: ShellPresentationDocument, targetGame: string): GrapesShellProject {
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    targetGame,
    presentation,
    grapesjs: createConstrainedGrapesProject(presentation),
  };
}

function assignStarterAssets(document: ShellPresentationDocument): ShellPresentationDocument {
  const assets: Record<string, string> = {
    "menu.hero": "hero.placeholder",
    "menu.currency": "currency.primary",
    "menu.settings": "icon.settings",
    "menu.play": "action.primary",
    "menu.node.completed": "node.completed",
    "menu.node.current": "node.current",
    "menu.node.locked": "node.locked",
    "level.currency": "currency.primary",
    "level.pause": "icon.pause",
    "level.gameplay-region": "hero.placeholder",
    "level.test-win": "action.test-win",
    "level.test-lose": "action.test-lose",
    "settings.panel": "divider.panel",
    "settings.music": "toggle.off",
    "settings.sfx": "toggle.off",
    "settings.haptics": "toggle.off",
    "settings.back": "action.primary",
    "pause.panel": "divider.panel",
    "pause.resume": "action.primary",
    "pause.settings": "action.secondary",
    "pause.home": "action.secondary",
    "win.panel": "result.win",
    "win.next": "action.primary",
    "win.home": "action.secondary",
    "fail.panel": "result.fail",
    "fail.retry": "action.primary",
    "fail.home": "action.secondary",
  };
  const clone = structuredClone(document);
  for (const page of clone.pages) {
    for (const instance of page.instances) {
      const assetId = assets[instance.id];
      if (assetId) instance.presentation.assetId = assetId;
      if (instance.roleId === "center-toggle-action") {
        instance.variants.on = { ...instance.variants.on, assetId: "toggle.on" };
        instance.variants.off = { ...instance.variants.off, assetId: "toggle.off" };
      }
    }
  }
  return clone;
}

export function createStarterProject(targetGame = "shell_proof"): GrapesShellProject {
  if (!TARGET_GAME.test(targetGame)) throw new ProjectValidationError(`Invalid target game "${targetGame}".`);
  return rebuild(assignStarterAssets(createDefaultShellPresentation()), targetGame);
}

export function validateProjectFile(
  value: unknown,
  manifest: SeedManifest,
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

  try {
    parseShellPresentation(withoutAssets(root.presentation));
  } catch (error) {
    throw new ProjectValidationError(error instanceof Error ? error.message : "Closed AST validation failed.");
  }
  validateManifestAssetUses(root.presentation as ShellPresentationDocument, manifest);

  const expected = createConstrainedGrapesProject(root.presentation as ShellPresentationDocument);
  if (canonicalizeJson(root.grapesjs) !== canonicalizeJson(expected)) {
    throw new ProjectValidationError("GrapesJS data diverges from the canonical closed presentation AST.");
  }
  return rebuild(root.presentation as ShellPresentationDocument, root.targetGame);
}

function findInstance(document: ShellPresentationDocument, instanceId: string): { pageIndex: number; instanceIndex: number } {
  for (const [pageIndex, page] of document.pages.entries()) {
    const instanceIndex = page.instances.findIndex((instance) => instance.id === instanceId);
    if (instanceIndex >= 0) return { pageIndex, instanceIndex };
  }
  throw new ProjectValidationError(`Unknown semantic instance "${instanceId}".`);
}

function nextDuplicateId(document: ShellPresentationDocument, sourceId: string): string {
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
  manifest: SeedManifest,
): GrapesShellProject {
  const document = structuredClone(project.presentation);
  const { pageIndex, instanceIndex } = findInstance(document, instanceId);
  const instance = document.pages[pageIndex]!.instances[instanceIndex]!;
  instance.presentation = { ...instance.presentation, ...structuredClone(update) };
  const candidate = rebuild(document, project.targetGame);
  return validateProjectFile(candidate, manifest);
}

function siblingInstances(
  document: ShellPresentationDocument,
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
  page: ShellPresentationDocument["pages"][number],
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
  manifest: SeedManifest,
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
  return validateProjectFile(rebuild(document, project.targetGame), manifest);
}
