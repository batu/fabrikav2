import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  SHELL_CONTRACT_V2_ID,
  SHELL_CONTRACT_V2_VERSION,
  canonicalizeJson,
  computeShellProjectionIdV2,
  hashShellContractById,
  parseProjectionRevisionV2,
  parseShellAssetIdentityDocument,
  type ShellAssetCatalog,
  type ShellAssetIdentityProjection,
  type ShellProjectionArtifact,
  type ShellProjectionRevisionV2,
  type ShellPresentationDocumentV2,
} from "@fabrikav2/kernel";

import { verifyPublishedRevision } from "../publication/publisher.ts";
import type { GrapesShellProject } from "../shared/project.ts";

export type ApplicationOutcome =
  | "applied"
  | "no-op"
  | "blocked-drift"
  | "invalid-revision"
  | "unsupported-intent";

export class ApplicationError extends Error {
  constructor(
    readonly outcome: Exclude<ApplicationOutcome, "applied" | "no-op">,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ApplicationError";
  }
}

export interface ApplicationResult {
  readonly outcome: ApplicationOutcome;
  readonly publicationId: string;
  readonly projectionId: string;
  readonly revisionPath: string;
  readonly artifactCount: number;
}

export interface ApplicationOptions {
  readonly authoringDir: string;
  readonly seedRoot: string;
  readonly publicationId: string;
}

interface CandidateProjection {
  readonly revision: ShellProjectionRevisionV2;
  readonly files: ReadonlyMap<string, Uint8Array>;
}

function invalidRevision(error: unknown): ApplicationError {
  if (error instanceof ApplicationError) return error;
  return new ApplicationError(
    "invalid-revision",
    error instanceof Error ? error.message : "Published revision is invalid.",
    { cause: error },
  );
}

function blockedDrift(error: unknown): ApplicationError {
  if (error instanceof ApplicationError) return error;
  return new ApplicationError(
    "blocked-drift",
    error instanceof Error ? error.message : "Selected projection has drifted.",
    { cause: error },
  );
}

const HASH_ID = /^sha256-[a-f0-9]{64}$/u;
const SAFE_ASSET_NAME = /^[a-z0-9][a-z0-9._-]*\.(?:png|jpe?g|webp)$/u;
const encoder = new TextEncoder();

function hashBytes(bytes: Uint8Array): string {
  return `sha256-${createHash("sha256").update(bytes).digest("hex")}`;
}

function jsonBytes(value: unknown): Uint8Array {
  return encoder.encode(`${canonicalizeJson(value)}\n`);
}

function tsDefaultBytes(value: unknown): Uint8Array {
  return encoder.encode(`export default ${canonicalizeJson(value)} as const;\n`);
}

function byCodeUnit(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function gameRootFromAuthoring(authoringDir: string): string {
  const root = path.resolve(authoringDir);
  if (path.basename(root) !== "grapesjs" || path.basename(path.dirname(root)) !== "authoring") {
    throw new Error("Authoring directory must end with games/<target>/authoring/grapesjs.");
  }
  return path.dirname(path.dirname(root));
}

function designRoot(options: ApplicationOptions): string {
  return path.join(gameRootFromAuthoring(options.authoringDir), "design");
}

function publicationRoot(options: ApplicationOptions): string {
  if (!HASH_ID.test(options.publicationId)) throw new Error("Invalid publication identity.");
  return path.join(path.resolve(options.authoringDir), "publications", options.publicationId);
}

async function readJson(target: string): Promise<unknown> {
  return JSON.parse(await readFile(target, "utf8")) as unknown;
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

function usedAssets(document: ShellPresentationDocumentV2): ReadonlyMap<string, string> {
  const uses = new Map<string, string>();
  for (const page of document.pages) {
    for (const instance of page.instances) {
      if (instance.presentation.assetId) uses.set(instance.id, instance.presentation.assetId);
    }
  }
  return uses;
}

function copyProjection(document: ShellPresentationDocumentV2): Record<string, string> {
  const entries = document.pages
    .flatMap((page) => page.instances)
    .filter((instance) => instance.presentation.copy !== undefined)
    .sort((left, right) => byCodeUnit(left.id, right.id))
    .map((instance) => [instance.id, instance.presentation.copy!] as const);
  return Object.fromEntries(entries) as Record<string, string>;
}

function tokensProjection(document: ShellPresentationDocumentV2): string {
  const rules = document.pages
    .flatMap((page) => page.instances)
    .sort((left, right) => byCodeUnit(left.id, right.id))
    .map((instance) => {
      const values = [
        `--fab-editor-order:${instance.presentation.order}`,
        `--fab-editor-visibility:${instance.presentation.visibility}`,
        instance.presentation.colors?.background
          ? `--fab-editor-surface:${instance.presentation.colors.background}`
          : undefined,
        instance.presentation.colors?.foreground
          ? `--fab-editor-ink:${instance.presentation.colors.foreground}`
          : undefined,
      ].filter((value): value is string => value !== undefined);
      return `[data-fab-instance="${instance.id}"]{${values.join(";")};}`;
    });
  return `/* Generated from immutable GrapesJS authority. */\n${rules.join("\n")}\n`;
}

function assetModuleBytes(assetPaths: ReadonlyMap<string, string>): Uint8Array {
  const lines = [...assetPaths.entries()]
    .sort(([left], [right]) => byCodeUnit(left, right))
    .map(([instanceId, assetPath]) =>
      `  ${JSON.stringify(instanceId)}: new URL(${JSON.stringify(`./${assetPath}`)}, import.meta.url).href,`,
    );
  return encoder.encode(`const assets = {\n${lines.join("\n")}\n} as const;\nexport default assets;\n`);
}

async function candidateFiles(options: ApplicationOptions): Promise<ReadonlyMap<string, Uint8Array>> {
  const root = publicationRoot(options);
  const [projectRaw, catalogRaw] = await Promise.all([
    readJson(path.join(root, "project.json")),
    readJson(path.join(root, "portable", "asset-catalog.json")),
  ]);
  const project = projectRaw as GrapesShellProject;
  const catalog = catalogRaw as ShellAssetCatalog;
  const assetById = new Map(catalog.assets.map((asset) => [asset.id, asset]));
  const uses = usedAssets(project.presentation);
  const instanceAssetPaths = new Map<string, string>();
  const identityAssets: ShellAssetIdentityProjection["assets"][number][] = [];
  const files = new Map<string, Uint8Array>();

  for (const [instanceId, assetId] of [...uses.entries()].sort(([left], [right]) => byCodeUnit(left, right))) {
    const asset = assetById.get(assetId);
    if (!asset) throw new Error(`Publication references unknown asset "${assetId}".`);
    const filename = path.basename(asset.path);
    if (!SAFE_ASSET_NAME.test(filename) || asset.path !== `assets/${filename}`) {
      throw new Error(`Unsafe projection asset path "${asset.path}".`);
    }
    const artifactPath = `assets/${filename}`;
    const bytes = await readFile(path.join(root, asset.path));
    if (hashBytes(bytes) !== asset.sha256) throw new Error(`Published asset bytes diverge for "${assetId}".`);
    files.set(artifactPath, bytes);
    instanceAssetPaths.set(instanceId, artifactPath);
    identityAssets.push({
      instanceId,
      slotId: asset.slotId,
      assetId,
      path: artifactPath,
      sha256: asset.sha256,
    });
  }

  const assetIdentity: ShellAssetIdentityProjection = {
    contractId: SHELL_CONTRACT_V2_ID,
    contractVersion: SHELL_CONTRACT_V2_VERSION,
    sourcePublicationId: options.publicationId,
    assets: identityAssets,
  };
  parseShellAssetIdentityDocument(assetIdentity);
  files.set("asset-identity.json", jsonBytes(assetIdentity));
  files.set("assets.ts", assetModuleBytes(instanceAssetPaths));
  files.set("copy.ts", tsDefaultBytes(copyProjection(project.presentation)));
  files.set("presentation.ts", tsDefaultBytes(project.presentation));
  files.set("tokens.css", encoder.encode(tokensProjection(project.presentation)));
  return new Map([...files.entries()].sort(([left], [right]) => byCodeUnit(left, right)));
}

async function buildCandidate(options: ApplicationOptions): Promise<CandidateProjection> {
  let files: ReadonlyMap<string, Uint8Array>;
  try {
    await verifyPublishedRevision(options);
    const firstRead = await candidateFiles(options);
    await verifyPublishedRevision(options);
    const secondRead = await candidateFiles(options);
    const firstDigest = canonicalizeJson(
      [...firstRead.entries()].map(([artifactPath, bytes]) => [artifactPath, hashBytes(bytes), bytes.byteLength]),
    );
    const secondDigest = canonicalizeJson(
      [...secondRead.entries()].map(([artifactPath, bytes]) => [artifactPath, hashBytes(bytes), bytes.byteLength]),
    );
    if (firstDigest !== secondDigest) {
      throw new Error("Published revision changed while its projection was being derived.");
    }
    files = secondRead;
  } catch (error) {
    throw invalidRevision(error);
  }
  const artifacts: ShellProjectionArtifact[] = [...files.entries()].map(([artifactPath, bytes]) => ({
    path: artifactPath,
    sha256: hashBytes(bytes),
    bytes: bytes.byteLength,
  }));
  const base = {
    contractId: SHELL_CONTRACT_V2_ID,
    contractVersion: SHELL_CONTRACT_V2_VERSION,
    rendererProfile: "dom-css" as const,
    compatibilityHash: await hashShellContractById(SHELL_CONTRACT_V2_ID),
    sourcePublicationId: options.publicationId,
    artifacts,
  };
  const projectionId = await computeShellProjectionIdV2(base);
  const revision = await parseProjectionRevisionV2({
    ...base,
    projectionId,
    revisionPath: `design/revisions/${projectionId}`,
  });
  return { revision, files };
}

async function verifyDirectory(directory: string, candidate: CandidateProjection): Promise<void> {
  const expectedPaths = [...candidate.files.keys()];
  const actualPaths: string[] = [];
  async function walk(current: string, prefix = ""): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(path.join(current, entry.name), relative);
      else if (entry.isFile()) actualPaths.push(relative);
      else throw new Error(`Projection contains unsupported entry "${relative}".`);
    }
  }
  await walk(directory);
  actualPaths.sort(byCodeUnit);
  if (canonicalizeJson(actualPaths) !== canonicalizeJson(expectedPaths)) {
    throw new Error("Selected projection artifact set diverges from deterministic regeneration.");
  }
  await Promise.all(
    expectedPaths.map(async (artifactPath) => {
      const expected = candidate.files.get(artifactPath)!;
      const actual = await readFile(path.join(directory, artifactPath));
      if (hashBytes(actual) !== hashBytes(expected) || actual.byteLength !== expected.byteLength) {
        throw new Error(`Selected projection artifact drift at "${artifactPath}".`);
      }
    }),
  );
}

async function selectedRevision(options: ApplicationOptions): Promise<ShellProjectionRevisionV2 | undefined> {
  const pointerPath = path.join(designRoot(options), "revision.json");
  if (!(await exists(pointerPath))) return undefined;
  try {
    const revision = await parseProjectionRevisionV2(await readJson(pointerPath));
    if (revision.rendererProfile !== "dom-css") {
      throw new ApplicationError("unsupported-intent", `Unsupported renderer profile "${revision.rendererProfile}".`);
    }
    const pinned = await buildCandidate({ ...options, publicationId: revision.sourcePublicationId });
    if (pinned.revision.projectionId !== revision.projectionId || canonicalizeJson(pinned.revision) !== canonicalizeJson(revision)) {
      throw new Error("Selected projection pointer diverges from deterministic regeneration.");
    }
    await verifyDirectory(path.join(gameRootFromAuthoring(options.authoringDir), revision.revisionPath), pinned);
    return revision;
  } catch (error) {
    if (error instanceof ApplicationError && error.outcome === "unsupported-intent") throw error;
    throw blockedDrift(error);
  }
}

export async function assertSelectedProjection(
  options: Omit<ApplicationOptions, "publicationId">,
): Promise<ShellProjectionRevisionV2> {
  const pointerPath = path.join(gameRootFromAuthoring(options.authoringDir), "design", "revision.json");
  if (!(await exists(pointerPath))) {
    throw new ApplicationError("invalid-revision", "No selected projection exists.");
  }
  let publicationId: string;
  try {
    const revision = await parseProjectionRevisionV2(await readJson(pointerPath));
    publicationId = revision.sourcePublicationId;
  } catch (error) {
    throw blockedDrift(error);
  }
  return (await selectedRevision({ ...options, publicationId }))!;
}

export async function preflightPublication(options: ApplicationOptions): Promise<ApplicationResult> {
  const selected = await selectedRevision(options);
  const candidate = await buildCandidate(options);
  const outcome: ApplicationOutcome = selected?.projectionId === candidate.revision.projectionId ? "no-op" : "applied";
  return {
    outcome,
    publicationId: options.publicationId,
    projectionId: candidate.revision.projectionId,
    revisionPath: candidate.revision.revisionPath,
    artifactCount: candidate.revision.artifacts.length,
  };
}

async function writeCandidate(directory: string, candidate: CandidateProjection): Promise<void> {
  for (const [artifactPath, bytes] of candidate.files) {
    const target = path.join(directory, artifactPath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
  await verifyDirectory(directory, candidate);
}

export async function applyPublication(options: ApplicationOptions): Promise<ApplicationResult> {
  const selected = await selectedRevision(options);
  const candidate = await buildCandidate(options);
  const result: ApplicationResult = {
    outcome: selected?.projectionId === candidate.revision.projectionId ? "no-op" : "applied",
    publicationId: options.publicationId,
    projectionId: candidate.revision.projectionId,
    revisionPath: candidate.revision.revisionPath,
    artifactCount: candidate.revision.artifacts.length,
  };
  if (result.outcome === "no-op") return result;

  const root = designRoot(options);
  const revisions = path.join(root, "revisions");
  const target = path.join(gameRootFromAuthoring(options.authoringDir), candidate.revision.revisionPath);
  await mkdir(revisions, { recursive: true });
  if (await exists(target)) {
    await verifyDirectory(target, candidate);
  } else {
    const stage = await mkdtemp(path.join(revisions, ".stage-"));
    try {
      await writeCandidate(stage, candidate);
      await rename(stage, target);
    } catch (error) {
      await rm(stage, { recursive: true, force: true });
      throw error;
    }
  }

  const pointer = path.join(root, "revision.json");
  const temporary = `${pointer}.tmp-${process.pid}`;
  await writeFile(temporary, jsonBytes(candidate.revision));
  await rename(temporary, pointer);
  return result;
}

export async function readSelectedProjection(options: Omit<ApplicationOptions, "publicationId">): Promise<{
  readonly state: "absent" | "selected" | "drifted";
  readonly projectionId?: string;
  readonly publicationId?: string;
}> {
  try {
    const pointerPath = path.join(gameRootFromAuthoring(options.authoringDir), "design", "revision.json");
    if (!(await exists(pointerPath))) return { state: "absent" };
    const raw = await readJson(pointerPath);
    const revision = await parseProjectionRevisionV2(raw);
    await selectedRevision({ ...options, publicationId: revision.sourcePublicationId });
    return { state: "selected", projectionId: revision.projectionId, publicationId: revision.sourcePublicationId };
  } catch {
    return { state: "drifted" };
  }
}
