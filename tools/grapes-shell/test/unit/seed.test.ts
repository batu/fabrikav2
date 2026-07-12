import { cp, copyFile, mkdir, mkdtemp, rename, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { readSeedAsset, readSeedManifest } from "../../src/shared/seed.ts";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const repositoryRoot = path.resolve(workspaceRoot, "../..");
const canonicalSeedRoot = path.join(repositoryRoot, "games/shell_proof_grapes/design");
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function copiedSeed() {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "grapes-shell-seed-"));
  const seedRoot = path.join(temporaryRoot, "design");
  temporaryRoots.push(temporaryRoot);
  await cp(canonicalSeedRoot, seedRoot, { recursive: true });
  return { temporaryRoot, seedRoot };
}

describe("confined GrapesJS seed reads", () => {
  it("loads the committed manifest and regular asset bytes", async () => {
    const catalog = await readSeedManifest(canonicalSeedRoot);
    const asset = catalog.assets[0]!;

    await expect(readSeedAsset(canonicalSeedRoot, asset)).resolves.toHaveLength(asset.bytes);
  });

  it("rejects a seed manifest symlink even when its target is valid", async () => {
    const { seedRoot, temporaryRoot } = await copiedSeed();
    const manifestPath = path.join(seedRoot, "kenney-seed.manifest.json");
    const outsideManifest = path.join(temporaryRoot, "outside-manifest.json");
    await copyFile(manifestPath, outsideManifest);
    await rm(manifestPath);
    await symlink(outsideManifest, manifestPath);

    await expect(readSeedManifest(seedRoot)).rejects.toThrow(/manifest.*symbolic link/i);
  });

  it("rejects an asset symlink that escapes the real seed root", async () => {
    const catalog = await readSeedManifest(canonicalSeedRoot);
    const asset = catalog.assets[0]!;
    const { seedRoot, temporaryRoot } = await copiedSeed();
    const assetPath = path.join(seedRoot, asset.path);
    const outsideAsset = path.join(temporaryRoot, "outside.png");
    await copyFile(assetPath, outsideAsset);
    await rm(assetPath);
    await symlink(outsideAsset, assetPath);

    await expect(readSeedAsset(seedRoot, asset)).rejects.toThrow(/asset.*symbolic link|escapes.*root/i);
    await expect(readSeedManifest(seedRoot)).rejects.toThrow(/asset.*symbolic link|escapes.*root/i);
  });

  it("rejects an asset reached through a symlinked intermediate directory", async () => {
    const catalog = await readSeedManifest(canonicalSeedRoot);
    const asset = catalog.assets[0]!;
    const { seedRoot } = await copiedSeed();
    const assetsDirectory = path.join(seedRoot, "assets");
    const realAssetsDirectory = path.join(seedRoot, "real-assets");
    await rename(assetsDirectory, realAssetsDirectory);
    await symlink("real-assets", assetsDirectory, "dir");

    await expect(readSeedAsset(seedRoot, asset)).rejects.toThrow(/resolves through a symbolic link/i);
    await expect(readSeedManifest(seedRoot)).rejects.toThrow(/resolves through a symbolic link/i);
  });

  it("rejects non-regular asset entries before reading them", async () => {
    const catalog = await readSeedManifest(canonicalSeedRoot);
    const asset = catalog.assets[0]!;
    const { seedRoot } = await copiedSeed();
    const assetPath = path.join(seedRoot, asset.path);
    await rm(assetPath);
    await mkdir(assetPath);

    await expect(readSeedAsset(seedRoot, asset)).rejects.toThrow(/asset.*regular file/i);
    await expect(readSeedManifest(seedRoot)).rejects.toThrow(/asset.*regular file/i);
  });
});
