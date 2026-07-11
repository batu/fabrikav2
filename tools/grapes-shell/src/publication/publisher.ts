import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  canonicalizeJson,
  computeShellPublicationId,
  hashCanonicalJson,
  parseShellAssetCatalog,
  parseShellPublishedRevision,
  shellPresentationContract,
  type ShellAssetCatalog,
  type ShellAssetCatalogEntry,
  type ShellPresentationDocument,
  type ShellPresentationInstance,
  type ShellPublishedRevision,
  type ShellStateId,
} from "@fabrikav2/kernel";

import {
  ProjectValidationError,
  validateProjectFile,
  type GrapesShellProject,
} from "../shared/project.ts";
import { readSeedAsset, readSeedManifest } from "../shared/seed.ts";
import { projectSemanticLayout } from "../shared/layout.ts";
import {
  semanticAssetCss,
  semanticCopyCss,
  semanticDefaultInk,
  semanticDefaultSurface,
  semanticInstanceCss,
  semanticPlaceholderCss,
  semanticSwitchCss,
  semanticSwitchDisabledCss,
  semanticSwitchKnobCss,
  semanticSwitchKnobOnCss,
  semanticSwitchOnCss,
  semanticTitleCss,
  semanticToggleCss,
} from "../shared/visual.ts";

interface PreviewFingerprint {
  readonly renderer: string;
  readonly fonts: string;
  readonly deviceScaleFactor: number;
  readonly animations: "disabled";
  readonly loadBarrier: string;
  readonly encoder: string;
}

export interface PreviewRenderer {
  (input: {
    readonly portableDirectory: string;
    readonly states: readonly ShellStateId[];
  }): Promise<{
    readonly fingerprint: PreviewFingerprint;
    readonly pages: readonly { stateId: ShellStateId; bytes: Uint8Array }[];
  }>;
}

export interface PublishAuthoringProjectOptions {
  readonly authoringDir: string;
  readonly seedRoot: string;
  readonly expectedProjectJsonHash?: string;
  readonly expectedAssetCatalogHash?: string;
  readonly renderPreviews?: PreviewRenderer;
}

export interface PublicationResult {
  readonly publicationId: string;
  readonly reusedImmutablePublication: boolean;
  readonly previewFingerprintId?: string;
}

export interface PublicationStatus {
  readonly state: "saved-unpublished" | "published" | "invalid";
  readonly latestPublicationId?: string;
  readonly canApply: false;
}

export interface VerifyPublishedRevisionOptions {
  readonly authoringDir: string;
  readonly publicationId: string;
  readonly seedRoot: string;
}

interface PortableComponentRecord {
  readonly id: string;
  readonly parentInstanceId: string | null;
  readonly order: number;
  readonly stateId: ShellStateId;
  readonly roleId: string;
  readonly bindingId: string;
  readonly stateFamilyId: string;
  readonly actionId: string | null;
  readonly accessibility: ShellPresentationInstance["accessibility"];
  readonly presentation: ShellPresentationInstance["presentation"];
  readonly variants: ShellPresentationInstance["variants"];
}

interface PortableRecords {
  readonly format: "grapes-shell-portable-records-v1";
  readonly records: readonly PortableComponentRecord[];
}

interface PortableBundle {
  readonly pages: readonly { readonly stateId: ShellStateId; readonly filename: string; readonly html: string }[];
  readonly styles: string;
  readonly records: PortableRecords;
  readonly assetCatalog: ShellAssetCatalog;
  readonly assets: readonly ShellAssetCatalogEntry[];
}

interface LatestPointer {
  readonly publicationId: string;
}

const PUBLICATION_ID = /^sha256-[a-f0-9]{64}$/u;
const TARGET_GAME = /^[a-z][a-z0-9_]*$/u;
const TOGGLE_ROLE = "center-toggle-action";

const PORTABLE_STYLE = `
:root { color-scheme: light; font-family: ui-rounded, system-ui, sans-serif; background: #e9edf2; color: #16212b; }
* { box-sizing: border-box; }
body { margin: 0; min-width: 390px; min-height: 844px; background: #e9edf2; }
[data-shell-page] { position: relative; isolation: isolate; width: 390px; height: 844px; overflow: hidden; background: #f8fafc; }
[data-safe-guide] { position: absolute; z-index: 255; left: 0; right: 0; height: 1px; pointer-events: none; background: repeating-linear-gradient(90deg, #0f9bb8 0 5px, transparent 5px 10px); opacity: .72; }
[data-safe-guide="top"] { top: 59px; } [data-safe-guide="bottom"] { bottom: 34px; }
[data-shell-instance] { position: absolute; z-index: var(--order); left: var(--x); top: var(--y); width: var(--w); height: var(--h); ${semanticInstanceCss} }
[data-shell-instance][data-toggle="true"] { ${semanticToggleCss} }
[data-shell-instance][data-hidden="true"] { visibility: hidden; }
[data-shell-instance] img { ${semanticAssetCss} }
[data-shell-copy] { ${semanticCopyCss} }
[data-shell-title] { ${semanticTitleCss} }
[data-shell-placeholder] { ${semanticPlaceholderCss} }
[data-shell-switch] { ${semanticSwitchCss} }
[data-shell-switch]::after { ${semanticSwitchKnobCss} }
[data-shell-switch][data-toggle-state="on"] { ${semanticSwitchOnCss} }
[data-shell-switch][data-toggle-state="on"]::after { ${semanticSwitchKnobOnCss} }
[data-shell-switch][data-toggle-state="disabled"] { ${semanticSwitchDisabledCss} }
`;

function projectRoot(authoringDir: string): string {
  return path.resolve(authoringDir);
}

function targetGameFromAuthoringDir(authoringDir: string): string {
  const root = projectRoot(authoringDir);
  if (path.basename(root) !== "grapesjs" || path.basename(path.dirname(root)) !== "authoring") {
    throw new ProjectValidationError("Authoring directory must end with games/<target>/authoring/grapesjs.");
  }
  const targetGame = path.basename(path.dirname(path.dirname(root)));
  if (!TARGET_GAME.test(targetGame)) throw new ProjectValidationError(`Invalid target game "${targetGame}".`);
  return targetGame;
}

function publicationRoot(authoringDir: string): string {
  return path.join(projectRoot(authoringDir), "publications");
}

function publicationDirectory(authoringDir: string, publicationId: string): string {
  if (!PUBLICATION_ID.test(publicationId)) {
    throw new ProjectValidationError(`Invalid publication identity "${publicationId}".`);
  }
  return path.join(publicationRoot(authoringDir), publicationId);
}

function portableFilename(state: ShellStateId): string {
  return `${state}.html`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character]!;
  });
}

function escapeCssString(value: string): string {
  return value.replace(/[\\"]/gu, (character) => `\\${character}`);
}

function finite(value: number): string {
  return Number(value.toFixed(6)).toString();
}

function componentRecords(document: ShellPresentationDocument): PortableRecords {
  const records: PortableComponentRecord[] = [];
  for (const page of document.pages) {
    for (const instance of page.instances) {
      records.push({
        id: instance.id,
        parentInstanceId: instance.parentInstanceId,
        order: instance.presentation.order,
        stateId: page.stateId,
        roleId: instance.roleId,
        bindingId: instance.bindingId,
        stateFamilyId: instance.stateFamilyId,
        actionId: instance.actionId ?? null,
        accessibility: structuredClone(instance.accessibility),
        presentation: structuredClone(instance.presentation),
        variants: structuredClone(instance.variants),
      });
    }
  }
  records.sort((left, right) => left.stateId.localeCompare(right.stateId) || left.order - right.order || left.id.localeCompare(right.id));
  return { format: "grapes-shell-portable-records-v1", records };
}

function assetUses(document: ShellPresentationDocument): Set<string> {
  const used = new Set<string>();
  for (const page of document.pages) {
    for (const instance of page.instances) {
      if (instance.presentation.assetId) used.add(instance.presentation.assetId);
      for (const variant of Object.values(instance.variants)) {
        if (variant.assetId) used.add(variant.assetId);
      }
    }
  }
  return used;
}

function requiredAssets(document: ShellPresentationDocument, assets: readonly ShellAssetCatalogEntry[]): ShellAssetCatalogEntry[] {
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  return [...assetUses(document)]
    .sort()
    .map((id) => {
      const asset = byId.get(id);
      if (!asset) throw new ProjectValidationError(`Published project references unknown asset "${id}".`);
      return asset;
    });
}

// The portable bundle carries U1's canonical asset catalog, narrowed to the
// rasters the publication actually references. Re-parsing it asserts the emitted
// asset-catalog.json is a valid, canonically ordered ShellAssetCatalog.
function portableAssetCatalog(assets: readonly ShellAssetCatalogEntry[]): ShellAssetCatalog {
  const catalog: ShellAssetCatalog = {
    contractId: shellPresentationContract.contractId,
    contractVersion: shellPresentationContract.contractVersion,
    assets: [...assets]
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
      .map((asset) => structuredClone(asset)),
  };
  return parseShellAssetCatalog(catalog);
}

function humanRoleLabel(roleId: string): string {
  return roleId.split(/[.-]/u).map((part) => part.slice(0, 1).toUpperCase() + part.slice(1)).join(" ");
}

function componentMarkup(
  instance: ShellPresentationInstance,
  assetById: ReadonlyMap<string, ShellAssetCatalogEntry>,
  containerIds: ReadonlySet<string>,
): string {
  const asset = instance.presentation.assetId ? assetById.get(instance.presentation.assetId) : undefined;
  const copy = instance.presentation.copy;
  const isContainer = containerIds.has(instance.id);
  const isToggle = instance.roleId === TOGGLE_ROLE;
  const assetMarkup = asset
    ? `<img alt="" aria-hidden="true" src="../${escapeHtml(asset.path)}" data-asset-id="${escapeHtml(asset.id)}">`
    : "";

  let content = "";
  if (isContainer && copy) {
    content += `<span data-shell-title>${escapeHtml(copy)}</span>`;
  }
  if (isToggle) {
    if (copy) content += `<span data-shell-copy>${escapeHtml(copy)}</span>`;
    content += `<span data-shell-switch data-toggle-state="on"></span>`;
  } else if (copy && !isContainer) {
    content += `<span data-shell-copy>${escapeHtml(copy)}</span>`;
  } else if (!copy && !asset && !isContainer) {
    content += `<span data-shell-placeholder>${escapeHtml(humanRoleLabel(instance.roleId))}</span>`;
  }

  const containerAttr = isContainer ? ` data-container="true"` : "";
  const toggleAttr = isToggle ? ` data-toggle="true"` : "";
  const action = instance.actionId ? ` data-action-id="${escapeHtml(instance.actionId)}"` : "";
  const hidden = instance.presentation.visibility === "hidden" ? "true" : "false";
  return `<section data-shell-instance="${escapeHtml(instance.id)}" data-role="${escapeHtml(instance.roleId)}" data-binding="${escapeHtml(instance.bindingId)}" data-hidden="${hidden}"${containerAttr}${toggleAttr}${action}>${assetMarkup}${content}</section>`;
}

function componentStyle(instance: ShellPresentationInstance): string {
  const geometry = instance.presentation.geometry;
  const bounds = projectSemanticLayout(instance.roleId, geometry);
  const surface = instance.presentation.colors?.background ?? semanticDefaultSurface;
  const ink = instance.presentation.colors?.foreground ?? semanticDefaultInk;
  const declarations = [
    `--x:${finite(bounds.x)}px`,
    `--y:${finite(bounds.y)}px`,
    `--w:${finite(bounds.width)}px`,
    `--h:${finite(bounds.height)}px`,
    `--order:${instance.presentation.order}`,
    `--scale:${finite(instance.presentation.scale ?? 1)}`,
    `--opacity:${finite(instance.presentation.opacity ?? 1)}`,
    `--surface:${surface}`,
    `--ink:${ink}`,
    `--fit:${geometry.fit}`,
  ].join(";");
  return `[data-shell-instance="${escapeCssString(instance.id)}"] { ${declarations}; }`;
}

function portableStyles(document: ShellPresentationDocument): string {
  const componentRules = document.pages
    .flatMap((page) => page.instances)
    .sort((left, right) => left.id.localeCompare(right.id))
    .map(componentStyle)
    .join("\n");
  return `${PORTABLE_STYLE.trimStart()}\n${componentRules}\n`;
}

function pageMarkup(
  stateId: ShellStateId,
  instances: readonly ShellPresentationInstance[],
  assetById: ReadonlyMap<string, ShellAssetCatalogEntry>,
  containerIds: ReadonlySet<string>,
): string {
  const state = shellPresentationContract.states.find((candidate) => candidate.id === stateId);
  if (!state) throw new ProjectValidationError(`Unknown shell state "${stateId}".`);
  const components = [...instances]
    .sort((left, right) => left.presentation.order - right.presentation.order || left.id.localeCompare(right.id))
    .map((instance) => componentMarkup(instance, assetById, containerIds))
    .join("");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=390, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self'; style-src 'self'; font-src 'none'; connect-src 'none'; script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
  <title>${escapeHtml(state.label)}</title>
  <link rel="stylesheet" href="./style.css">
</head>
<body>
  <main data-shell-page="${escapeHtml(stateId)}" data-render-ready="true" aria-label="${escapeHtml(state.label)}">
    <i data-safe-guide="top" aria-hidden="true"></i><i data-safe-guide="bottom" aria-hidden="true"></i>${components}
  </main>
</body>
</html>`;
}

function createPortableBundle(document: ShellPresentationDocument, catalogAssets: readonly ShellAssetCatalogEntry[]): PortableBundle {
  const assets = requiredAssets(document, catalogAssets);
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const containerIds = new Set(
    document.pages
      .flatMap((page) => page.instances)
      .map((instance) => instance.parentInstanceId)
      .filter((id): id is string => id !== null),
  );
  const pages = document.pages.map((page) => ({
    stateId: page.stateId,
    filename: portableFilename(page.stateId),
    html: pageMarkup(page.stateId, page.instances, byId, containerIds),
  }));
  return {
    pages,
    styles: portableStyles(document),
    records: componentRecords(document),
    assetCatalog: portableAssetCatalog(assets),
    assets,
  };
}

function portableHashPayload(bundle: PortableBundle): Record<string, unknown> {
  return {
    pages: bundle.pages.map((page) => ({ stateId: page.stateId, filename: page.filename, html: page.html })),
    styles: bundle.styles,
    records: bundle.records,
    assetCatalog: bundle.assetCatalog,
  };
}

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

async function writeJson(target: string, value: unknown): Promise<void> {
  await writeFile(target, `${canonicalizeJson(value)}\n`, "utf8");
}

async function readJson(target: string): Promise<unknown> {
  return JSON.parse(await readFile(target, "utf8")) as unknown;
}

function hashBytes(bytes: Uint8Array): string {
  return `sha256-${createHash("sha256").update(bytes).digest("hex")}`;
}

async function assertDirectoryEntries(
  directory: string,
  expected: ReadonlyMap<string, "file" | "directory">,
): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  const names = entries.map((entry) => entry.name).sort();
  const expectedNames = [...expected.keys()].sort();
  if (canonicalizeJson(names) !== canonicalizeJson(expectedNames)) {
    throw new ProjectValidationError(`Immutable publication directory entries diverge at "${directory}".`);
  }
  for (const entry of entries) {
    const kind = expected.get(entry.name);
    if ((kind === "file" && !entry.isFile()) || (kind === "directory" && !entry.isDirectory())) {
      throw new ProjectValidationError(`Immutable publication entry "${entry.name}" has the wrong filesystem type.`);
    }
  }
}

async function writePortableBundle(directory: string, bundle: PortableBundle, seedRoot: string): Promise<void> {
  const portable = path.join(directory, "portable");
  const assetsDirectory = path.join(directory, "assets");
  await Promise.all([mkdir(portable, { recursive: true }), mkdir(assetsDirectory, { recursive: true })]);
  await Promise.all(
    [
      writeFile(path.join(portable, "style.css"), bundle.styles, "utf8"),
      writeJson(path.join(portable, "records.json"), bundle.records),
      writeJson(path.join(portable, "asset-catalog.json"), bundle.assetCatalog),
      ...bundle.pages.map((page) => writeFile(path.join(portable, page.filename), page.html, "utf8")),
      ...bundle.assets.map(async (asset) => writeFile(path.join(directory, asset.path), await readSeedAsset(seedRoot, asset))),
    ],
  );
}

function revisionFrom(
  publicationId: string,
  hashes: {
    projectJsonHash: string;
    portableExportHash: string;
    componentRecordsHash: string;
    assetCatalogHash: string;
  },
): ShellPublishedRevision {
  return {
    contractId: shellPresentationContract.contractId,
    contractVersion: shellPresentationContract.contractVersion,
    publicationId,
    ...hashes,
    pageCount: 6,
    states: [...shellPresentationContract.publication.requiredStates],
  };
}

function previewManifest(rendered: Awaited<ReturnType<PreviewRenderer>>) {
  return {
    fingerprint: rendered.fingerprint,
    pages: rendered.pages.map((page) => ({
      stateId: page.stateId,
      filename: `${page.stateId}.png`,
      sha256: hashBytes(page.bytes),
    })),
  };
}

async function verifyPreviewDirectory(
  directory: string,
  rendered: Awaited<ReturnType<PreviewRenderer>>,
): Promise<void> {
  const expected = previewManifest(rendered);
  await assertDirectoryEntries(
    directory,
    new Map<string, "file">([
      ["preview.json", "file"],
      ...expected.pages.map((page) => [page.filename, "file"] as const),
    ]),
  );
  const actual = await readJson(path.join(directory, "preview.json"));
  if (canonicalizeJson(actual) !== canonicalizeJson(expected)) {
    throw new ProjectValidationError("Derived preview manifest diverges for an existing renderer fingerprint.");
  }
  await Promise.all(
    expected.pages.map(async (page, index) => {
      const actualHash = hashBytes(await readFile(path.join(directory, page.filename)));
      if (actualHash !== page.sha256 || actualHash !== hashBytes(rendered.pages[index]!.bytes)) {
        throw new ProjectValidationError(`Derived preview bytes diverge for "${page.stateId}".`);
      }
    }),
  );
}

async function renderPreviews(
  authoringDir: string,
  publicationId: string,
  portableDirectory: string,
  renderer: PreviewRenderer,
): Promise<string> {
  const rendered = await renderer({
    portableDirectory,
    states: shellPresentationContract.publication.requiredStates,
  });
  const receivedStates = rendered.pages.map((page) => page.stateId);
  if (canonicalizeJson(receivedStates) !== canonicalizeJson(shellPresentationContract.publication.requiredStates)) {
    throw new ProjectValidationError("Preview renderer did not return all six canonical pages in order.");
  }
  if (rendered.pages.some((page) => page.bytes.byteLength === 0)) {
    throw new ProjectValidationError("Preview renderer returned an empty raster preview.");
  }
  const fingerprintId = await hashCanonicalJson(rendered.fingerprint);
  const root = path.join(authoringDir, "previews", publicationId);
  await mkdir(root, { recursive: true });
  const target = path.join(root, fingerprintId);
  if (await exists(target)) {
    await verifyPreviewDirectory(target, rendered);
    return fingerprintId;
  }
  const stage = await mkdtemp(path.join(root, ".stage-"));
  try {
    const manifest = previewManifest(rendered);
    await Promise.all([
      writeJson(path.join(stage, "preview.json"), manifest),
      ...rendered.pages.map((page) => writeFile(path.join(stage, `${page.stateId}.png`), page.bytes)),
    ]);
    await verifyPreviewDirectory(stage, rendered);
    await rename(stage, target);
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
  return fingerprintId;
}

async function writeLatestPointer(authoringDir: string, publicationId: string): Promise<void> {
  const target = path.join(authoringDir, "latest-published.json");
  const temporary = `${target}.tmp-${process.pid}`;
  await writeJson(temporary, { publicationId } satisfies LatestPointer);
  await rename(temporary, target);
}

async function loadProject(authoringDir: string, seedRoot: string): Promise<{ project: GrapesShellProject; catalog: ShellAssetCatalog }> {
  const [raw, catalog] = await Promise.all([
    readJson(path.join(authoringDir, "project.json")),
    readSeedManifest(seedRoot),
  ]);
  return { project: validateProjectFile(raw, catalog, targetGameFromAuthoringDir(authoringDir)), catalog };
}

export async function publishAuthoringProject(options: PublishAuthoringProjectOptions): Promise<PublicationResult> {
  const authoringDir = projectRoot(options.authoringDir);
  const { project, catalog } = await loadProject(authoringDir, options.seedRoot);
  const bundle = createPortableBundle(project.presentation, catalog.assets);
  const [projectJsonHash, portableExportHash, componentRecordsHash, assetCatalogHash, reviewedAssetCatalogHash] =
    await Promise.all([
      hashCanonicalJson(project),
      hashCanonicalJson(portableHashPayload(bundle)),
      hashCanonicalJson(bundle.records),
      hashCanonicalJson(bundle.assetCatalog),
      hashCanonicalJson(catalog),
    ]);
  // Fail closed before any publication write: the saved project AND the full
  // canonical asset inventory it was reviewed against must both match the exact
  // hashes A1 accepted. reviewedAssetCatalogHash covers the whole ShellAssetCatalog
  // vocabulary, not the used-asset subset folded into the publication identity.
  if (options.expectedProjectJsonHash && options.expectedProjectJsonHash !== projectJsonHash) {
    throw new ProjectValidationError(
      `Saved project hash ${projectJsonHash} does not match the explicitly reviewed hash ${options.expectedProjectJsonHash}.`,
    );
  }
  if (options.expectedAssetCatalogHash && options.expectedAssetCatalogHash !== reviewedAssetCatalogHash) {
    throw new ProjectValidationError(
      `Asset catalog hash ${reviewedAssetCatalogHash} does not match the explicitly reviewed hash ${options.expectedAssetCatalogHash}.`,
    );
  }
  const publicationId = await computeShellPublicationId({
    contractId: shellPresentationContract.contractId,
    contractVersion: shellPresentationContract.contractVersion,
    projectJsonHash,
    portableExportHash,
    componentRecordsHash,
    assetCatalogHash,
    pageCount: 6,
    states: [...shellPresentationContract.publication.requiredStates],
  });
  const revision = revisionFrom(publicationId, {
    projectJsonHash,
    portableExportHash,
    componentRecordsHash,
    assetCatalogHash,
  });
  await parseShellPublishedRevision(revision);

  const publications = publicationRoot(authoringDir);
  await mkdir(publications, { recursive: true });
  const target = path.join(publications, publicationId);
  let reusedImmutablePublication = await exists(target);
  if (reusedImmutablePublication) {
    await verifyPublishedRevision({ authoringDir, publicationId, seedRoot: options.seedRoot });
  } else {
    const stage = await mkdtemp(path.join(publications, ".stage-"));
    try {
      await writeJson(path.join(stage, "project.json"), project);
      await writePortableBundle(stage, bundle, options.seedRoot);
      await writeJson(path.join(stage, "publication.json"), revision);
      await verifyPublicationDirectory(stage, publicationId, options.seedRoot, project.targetGame);
      await rename(stage, target);
    } catch (error) {
      await rm(stage, { recursive: true, force: true });
      throw error;
    }
    reusedImmutablePublication = false;
  }

  const previewFingerprintId = options.renderPreviews
    ? await renderPreviews(authoringDir, publicationId, path.join(target, "portable"), options.renderPreviews)
    : undefined;
  await writeLatestPointer(authoringDir, publicationId);
  return { publicationId, reusedImmutablePublication, ...(previewFingerprintId ? { previewFingerprintId } : {}) };
}

async function verifyPublicationDirectory(
  root: string,
  publicationId: string,
  seedRoot: string,
  expectedTargetGame: string,
): Promise<void> {
  if (!PUBLICATION_ID.test(publicationId)) {
    throw new ProjectValidationError(`Invalid publication identity "${publicationId}".`);
  }
  await assertDirectoryEntries(
    root,
    new Map([
      ["assets", "directory"],
      ["portable", "directory"],
      ["project.json", "file"],
      ["publication.json", "file"],
    ]),
  );

  const revision = await readJson(path.join(root, "publication.json"));
  await parseShellPublishedRevision(revision);
  const [projectRaw, catalog] = await Promise.all([
    readJson(path.join(root, "project.json")),
    readSeedManifest(seedRoot),
  ]);
  const project = validateProjectFile(projectRaw, catalog, expectedTargetGame);
  const bundle = createPortableBundle(project.presentation, catalog.assets);
  const portableDirectory = path.join(root, "portable");

  await assertDirectoryEntries(
    portableDirectory,
    new Map<string, "file">([
      ["asset-catalog.json", "file"],
      ["records.json", "file"],
      ["style.css", "file"],
      ...bundle.pages.map((page) => [page.filename, "file"] as const),
    ]),
  );
  await assertDirectoryEntries(
    path.join(root, "assets"),
    new Map<string, "file">(
      bundle.assets.map((asset) => [path.basename(asset.path), "file"] as const),
    ),
  );

  const [actualRecords, actualAssetCatalog, actualStyles, actualPages] = await Promise.all([
    readJson(path.join(portableDirectory, "records.json")),
    readJson(path.join(portableDirectory, "asset-catalog.json")),
    readFile(path.join(portableDirectory, "style.css"), "utf8"),
    Promise.all(
      bundle.pages.map(async (page) => ({
        stateId: page.stateId,
        filename: page.filename,
        html: await readFile(path.join(portableDirectory, page.filename), "utf8"),
      })),
    ),
  ]);
  if (canonicalizeJson(actualRecords) !== canonicalizeJson(bundle.records)) {
    throw new ProjectValidationError("Portable records are mixed or diverge from the immutable project AST.");
  }
  if (canonicalizeJson(actualAssetCatalog) !== canonicalizeJson(bundle.assetCatalog)) {
    throw new ProjectValidationError("Portable asset catalog diverges from the validated project and U2 seed manifest.");
  }
  if (actualStyles !== bundle.styles || canonicalizeJson(actualPages) !== canonicalizeJson(bundle.pages)) {
    throw new ProjectValidationError("Portable HTML or styles diverge from deterministic regeneration.");
  }
  await Promise.all(
    bundle.assets.map(async (asset) => {
      const actualHash = hashBytes(await readFile(path.join(root, asset.path)));
      if (actualHash !== asset.sha256) {
        throw new ProjectValidationError(`Published asset bytes diverge for "${asset.id}".`);
      }
    }),
  );

  const [projectJsonHash, portableExportHash, componentRecordsHash, assetCatalogHash] = await Promise.all([
    hashCanonicalJson(project),
    hashCanonicalJson(portableHashPayload(bundle)),
    hashCanonicalJson(bundle.records),
    hashCanonicalJson(bundle.assetCatalog),
  ]);
  const typedRevision = revision as ShellPublishedRevision;
  if (
    typedRevision.projectJsonHash !== projectJsonHash ||
    typedRevision.portableExportHash !== portableExportHash ||
    typedRevision.componentRecordsHash !== componentRecordsHash ||
    typedRevision.assetCatalogHash !== assetCatalogHash
  ) {
    throw new ProjectValidationError("Immutable publication hashes diverge from its saved project or portable export.");
  }
  const expectedPublicationId = await computeShellPublicationId({
    contractId: shellPresentationContract.contractId,
    contractVersion: shellPresentationContract.contractVersion,
    projectJsonHash,
    portableExportHash,
    componentRecordsHash,
    assetCatalogHash,
    pageCount: 6,
    states: [...shellPresentationContract.publication.requiredStates],
  });
  if (typedRevision.publicationId !== publicationId || expectedPublicationId !== publicationId) {
    throw new ProjectValidationError("Publication directory identity diverges from deterministic content identity.");
  }
}

export async function verifyPublishedRevision(options: VerifyPublishedRevisionOptions): Promise<void> {
  const root = publicationDirectory(options.authoringDir, options.publicationId);
  await verifyPublicationDirectory(
    root,
    options.publicationId,
    options.seedRoot,
    targetGameFromAuthoringDir(options.authoringDir),
  );
}

export async function publicationStatus(options: {
  readonly authoringDir: string;
  readonly seedRoot: string;
}): Promise<PublicationStatus> {
  const authoringDir = projectRoot(options.authoringDir);
  const pointerPath = path.join(authoringDir, "latest-published.json");
  let latestPublicationId: string | undefined;
  try {
    const pointer = (await readJson(pointerPath)) as LatestPointer;
    if (typeof pointer.publicationId !== "string") throw new ProjectValidationError("Invalid latest publication pointer.");
    await verifyPublishedRevision({ authoringDir, publicationId: pointer.publicationId, seedRoot: options.seedRoot });
    latestPublicationId = pointer.publicationId;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      return { state: "invalid", canApply: false };
    }
  }
  let project: GrapesShellProject;
  try {
    project = (await loadProject(authoringDir, options.seedRoot)).project;
  } catch {
    return { state: "invalid", ...(latestPublicationId ? { latestPublicationId } : {}), canApply: false };
  }
  if (!latestPublicationId) return { state: "saved-unpublished", canApply: false };
  const revision = (await readJson(
    path.join(publicationRoot(authoringDir), latestPublicationId, "publication.json"),
  )) as ShellPublishedRevision;
  const projectJsonHash = await hashCanonicalJson(project);
  if (revision.projectJsonHash !== projectJsonHash) {
    return { state: "saved-unpublished", latestPublicationId, canApply: false };
  }
  return { state: "published", latestPublicationId, canApply: false };
}
