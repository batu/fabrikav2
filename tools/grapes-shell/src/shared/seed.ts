import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";

import {
  canonicalizeJson,
  parseShellAssetCatalogDocument,
  shellPresentationContractV2,
  type ShellAssetCatalog,
  type ShellAssetCatalogEntry,
} from "@fabrikav2/kernel";

import { asProjectRecord, ProjectValidationError } from "./project.ts";

const HASH = /^[a-f0-9]{64}$/u;
const SAFE_ASSET_PATH = /^assets\/[a-z0-9][a-z0-9._-]*\.(?:png|jpe?g|webp)$/u;
const PNG_MAGIC = "89504e470d0a1a0a";
const SEED_MANIFEST = "kenney-seed.manifest.json";

function isWithinRoot(root: string, candidate: string): boolean {
  const relativeToRoot = path.relative(root, candidate);
  return (
    relativeToRoot === "" ||
    (!relativeToRoot.startsWith(`..${path.sep}`) && relativeToRoot !== ".." && !path.isAbsolute(relativeToRoot))
  );
}

async function readSeedFile(seedRoot: string, relative: string, kind: "manifest" | "asset"): Promise<Buffer> {
  if (kind === "asset" && !SAFE_ASSET_PATH.test(relative)) {
    throw new ProjectValidationError(`Unsafe seed asset path "${relative}".`);
  }

  const lexicalRoot = path.resolve(seedRoot);
  const lexicalEntry = path.resolve(lexicalRoot, relative);
  const label = kind === "manifest" ? "Seed manifest" : `Seed asset "${relative}"`;
  if (!isWithinRoot(lexicalRoot, lexicalEntry)) {
    throw new ProjectValidationError(`${label} path escapes its root.`);
  }

  const realRoot = await realpath(lexicalRoot);
  const entry = await lstat(lexicalEntry);
  if (entry.isSymbolicLink()) {
    throw new ProjectValidationError(`${label} must not be a symbolic link.`);
  }
  if (!entry.isFile()) {
    throw new ProjectValidationError(`${label} must be a regular file.`);
  }

  const realEntry = await realpath(lexicalEntry);
  if (!isWithinRoot(realRoot, realEntry)) {
    throw new ProjectValidationError(`${label} resolves outside the real seed root.`);
  }
  if (realEntry !== path.resolve(realRoot, relative)) {
    throw new ProjectValidationError(`${label} resolves through a symbolic link.`);
  }

  let handle;
  try {
    handle = await open(realEntry, constants.O_RDONLY | constants.O_NOFOLLOW);
    if (!(await handle.stat()).isFile()) {
      throw new ProjectValidationError(`${label} must be a regular file.`);
    }
    return await handle.readFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ELOOP") {
      throw new ProjectValidationError(`${label} must not be a symbolic link.`);
    }
    throw error;
  } finally {
    await handle?.close();
  }
}

// The U2 seed manifest embeds U1's canonical asset catalog as the single asset
// authority. This reader validates that catalog through the kernel, checks its
// provenance sources, and proves the retained raster bytes on disk still match
// the catalog identities. It returns the ShellAssetCatalog itself so the editor,
// project loader, and publisher all consume one vocabulary.
export async function readSeedManifest(seedRoot: string): Promise<ShellAssetCatalog> {
  const raw = JSON.parse((await readSeedFile(seedRoot, SEED_MANIFEST, "manifest")).toString("utf8")) as unknown;
  const root = asProjectRecord(raw, "seed manifest");
  if (root.schemaVersion !== 2 || root.seedKind !== "behavior-neutral-semantic-fixtures") {
    throw new ProjectValidationError("Unsupported Kenney seed manifest.");
  }
  if (!Array.isArray(root.canonicalStates) || !Array.isArray(root.sources)) {
    throw new ProjectValidationError("Seed manifest is missing required collections.");
  }
  if (canonicalizeJson(root.canonicalStates) !== canonicalizeJson(shellPresentationContractV2.publication.requiredStates)) {
    throw new ProjectValidationError("Seed manifest canonical states diverge from the U1 shell contract.");
  }

  const sourceIds = root.sources.map((value, index) => {
    const source = asProjectRecord(value, `sources[${index}]`);
    if (
      typeof source.id !== "string" ||
      source.license !== "CC0-1.0" ||
      typeof source.licenseSha256 !== "string" ||
      !HASH.test(source.licenseSha256)
    ) {
      throw new ProjectValidationError(`sources[${index}] does not carry complete CC0 provenance.`);
    }
    return source.id;
  });
  if (new Set(sourceIds).size !== sourceIds.length) {
    throw new ProjectValidationError("Seed manifest declares duplicate provenance sources.");
  }

  let catalog: ShellAssetCatalog;
  try {
    catalog = parseShellAssetCatalogDocument(root.assetCatalog);
  } catch (error) {
    throw new ProjectValidationError(error instanceof Error ? error.message : "Embedded asset catalog is invalid.");
  }

  const declaredSources = new Set(sourceIds);
  for (const asset of catalog.assets) {
    if (!declaredSources.has(asset.provenance.sourceId)) {
      throw new ProjectValidationError(`Asset "${asset.id}" cites unknown provenance source "${asset.provenance.sourceId}".`);
    }
  }

  await Promise.all(
    catalog.assets.map(async (asset) => {
      const bytes = await readSeedFile(seedRoot, asset.path, "asset");
      if (`sha256-${createHash("sha256").update(bytes).digest("hex")}` !== asset.sha256) {
        throw new ProjectValidationError(`Seed asset bytes do not match the catalog hash for "${asset.id}".`);
      }
      if (bytes.byteLength !== asset.bytes) {
        throw new ProjectValidationError(`Seed asset byte length diverges from the catalog for "${asset.id}".`);
      }
      if (asset.mimeType === "image/png" && bytes.subarray(0, 8).toString("hex") !== PNG_MAGIC) {
        throw new ProjectValidationError(`Seed asset "${asset.id}" is not a PNG raster.`);
      }
    }),
  );

  return catalog;
}

export async function readSeedAsset(seedRoot: string, asset: Pick<ShellAssetCatalogEntry, "path">): Promise<Uint8Array> {
  return readSeedFile(seedRoot, asset.path, "asset");
}
