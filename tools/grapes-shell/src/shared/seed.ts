import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { canonicalizeJson, shellPresentationContract } from "@fabrikav2/kernel";

import { asProjectRecord, ProjectValidationError, type SeedAsset, type SeedManifest } from "./project.ts";

const HASH = /^[a-f0-9]{64}$/u;
const SAFE_FILE = /^assets\/[a-z0-9-]+\.png$/u;

function resolveSeedPath(seedRoot: string, relative: string): string {
  if (!SAFE_FILE.test(relative)) throw new ProjectValidationError(`Unsafe seed asset path "${relative}".`);
  const resolved = path.resolve(seedRoot, relative);
  const relativeToRoot = path.relative(seedRoot, resolved);
  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    throw new ProjectValidationError(`Seed asset path escapes its root: "${relative}".`);
  }
  return resolved;
}

function parseAsset(value: unknown, index: number): SeedAsset {
  const asset = asProjectRecord(value, `assets[${index}]`);
  const id = asset.id;
  const file = asset.file;
  const dimensions = asProjectRecord(asset.dimensions, `assets[${index}].dimensions`);
  const source = asProjectRecord(asset.source, `assets[${index}].source`);
  if (typeof id !== "string" || !/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u.test(id)) {
    throw new ProjectValidationError(`assets[${index}].id is not a semantic asset ID.`);
  }
  if (typeof file !== "string" || !SAFE_FILE.test(file)) throw new ProjectValidationError(`assets[${index}].file is unsafe.`);
  if (asset.alpha !== "required") throw new ProjectValidationError(`assets[${index}].alpha must be required.`);
  if (!Array.isArray(asset.compatibleRoles) || !asset.compatibleRoles.every((role) => typeof role === "string")) {
    throw new ProjectValidationError(`assets[${index}].compatibleRoles is invalid.`);
  }
  if (typeof asset.sha256 !== "string" || !HASH.test(asset.sha256)) {
    throw new ProjectValidationError(`assets[${index}].sha256 is invalid.`);
  }
  if (
    typeof dimensions.width !== "number" ||
    typeof dimensions.height !== "number" ||
    !Number.isInteger(dimensions.width) ||
    !Number.isInteger(dimensions.height) ||
    dimensions.width <= 0 ||
    dimensions.height <= 0
  ) {
    throw new ProjectValidationError(`assets[${index}].dimensions are invalid.`);
  }
  if (typeof source.pack !== "string" || typeof source.path !== "string") {
    throw new ProjectValidationError(`assets[${index}].source is invalid.`);
  }
  return {
    id,
    file,
    source: { pack: source.pack, path: source.path },
    dimensions: { width: dimensions.width, height: dimensions.height },
    alpha: "required",
    compatibleRoles: [...asset.compatibleRoles],
    sha256: asset.sha256,
  };
}

export async function readSeedManifest(seedRoot: string): Promise<SeedManifest> {
  const raw = JSON.parse(await readFile(path.join(seedRoot, "kenney-seed.manifest.json"), "utf8")) as unknown;
  const root = asProjectRecord(raw, "seed manifest");
  if (root.schemaVersion !== 1 || root.seedKind !== "behavior-neutral-semantic-fixtures") {
    throw new ProjectValidationError("Unsupported Kenney seed manifest.");
  }
  if (!Array.isArray(root.canonicalStates) || !Array.isArray(root.assets) || !Array.isArray(root.sources)) {
    throw new ProjectValidationError("Seed manifest is missing required collections.");
  }
  if (canonicalizeJson(root.canonicalStates) !== canonicalizeJson(shellPresentationContract.publication.requiredStates)) {
    throw new ProjectValidationError("Seed manifest canonical states diverge from the U1 shell contract.");
  }
  const assets = root.assets.map(parseAsset);
  if (new Set(assets.map((asset) => asset.id)).size !== assets.length) {
    throw new ProjectValidationError("Seed manifest contains duplicate asset identities.");
  }
  if (new Set(assets.map((asset) => asset.file)).size !== assets.length) {
    throw new ProjectValidationError("Seed manifest contains duplicate asset files.");
  }
  const roleIds = new Set(shellPresentationContract.roles.map((role) => role.id));
  for (const asset of assets) {
    if (
      asset.compatibleRoles.length === 0 ||
      new Set(asset.compatibleRoles).size !== asset.compatibleRoles.length ||
      asset.compatibleRoles.some((role) => !roleIds.has(role))
    ) {
      throw new ProjectValidationError(`Seed asset "${asset.id}" has unknown, empty, or duplicate compatible roles.`);
    }
  }
  await Promise.all(
    assets.map(async (asset) => {
      const bytes = await readFile(resolveSeedPath(seedRoot, asset.file));
      if (createHash("sha256").update(bytes).digest("hex") !== asset.sha256) {
        throw new ProjectValidationError(`Seed asset bytes do not match manifest hash for "${asset.id}".`);
      }
      if (bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
        throw new ProjectValidationError(`Seed asset "${asset.id}" is not a PNG raster.`);
      }
    }),
  );
  const sources = root.sources.map((value, index) => {
    const source = asProjectRecord(value, `sources[${index}]`);
    if (typeof source.id !== "string" || source.license !== "CC0-1.0" || typeof source.licenseSha256 !== "string" || !HASH.test(source.licenseSha256)) {
      throw new ProjectValidationError(`sources[${index}] does not carry complete CC0 provenance.`);
    }
    return { id: source.id, license: source.license, licenseSha256: source.licenseSha256 };
  });
  const sourceIds = new Set(sources.map((source) => source.id));
  if (sourceIds.size !== sources.length || assets.some((asset) => !sourceIds.has(asset.source.pack))) {
    throw new ProjectValidationError("Seed manifest asset provenance references an unknown or duplicate source pack.");
  }
  return {
    schemaVersion: 1,
    seedKind: "behavior-neutral-semantic-fixtures",
    canonicalStates: root.canonicalStates as SeedManifest["canonicalStates"],
    sources,
    assets,
  };
}

export async function readSeedAsset(seedRoot: string, asset: SeedAsset): Promise<Uint8Array> {
  return readFile(resolveSeedPath(seedRoot, asset.file));
}
