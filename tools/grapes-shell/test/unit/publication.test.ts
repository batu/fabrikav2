import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { hashCanonicalJson } from "@fabrikav2/kernel";

import { createStarterProject, updateInstancePresentation, validateProjectFile } from "../../src/shared/project.ts";
import { readSeedManifest } from "../../src/shared/seed.ts";
import {
  publicationStatus,
  publishAuthoringProject,
  verifyPublishedRevision,
  type PreviewRenderer,
} from "../../src/publication/publisher.ts";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const repositoryRoot = path.resolve(workspaceRoot, "../..");
const seedRoot = path.join(repositoryRoot, "games/shell_proof_grapes/design");
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function previewRenderer(fingerprint: string): PreviewRenderer {
  return async ({ states }) => ({
    fingerprint: {
      renderer: `test-renderer-${fingerprint}`,
      fonts: "pinned-test-font-v1",
      deviceScaleFactor: 1,
      animations: "disabled",
      loadBarrier: "test-barrier",
      encoder: "test-png",
    },
    pages: states.map((state) => ({ stateId: state, bytes: new TextEncoder().encode(`${fingerprint}:${state}`) })),
  });
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "grapes-shell-publication-"));
  temporaryRoots.push(root);
  const authoringDir = path.join(root, "games/shell_proof_grapes/authoring/grapesjs");
  const manifest = await readSeedManifest(seedRoot);
  await mkdir(authoringDir, { recursive: true });
  await writeFile(path.join(authoringDir, "project.json"), JSON.stringify(createStarterProject()), "utf8");
  return { authoringDir, manifest };
}

describe("immutable GrapesJS publication", () => {
  it("rejects a cross-game project before creating publication state", async () => {
    const { authoringDir } = await fixture();
    await writeFile(path.join(authoringDir, "project.json"), JSON.stringify(createStarterProject("another_game")), "utf8");

    await expect(publishAuthoringProject({ authoringDir, seedRoot })).rejects.toThrow(/targets game/i);
    await expect(access(path.join(authoringDir, "publications"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("publishes a complete canonical project/export pair and keeps its ID stable when previews regenerate", async () => {
    const { authoringDir } = await fixture();
    const first = await publishAuthoringProject({ authoringDir, seedRoot, renderPreviews: previewRenderer("first") });
    const second = await publishAuthoringProject({ authoringDir, seedRoot, renderPreviews: previewRenderer("second") });

    expect(first.publicationId).toMatch(/^sha256-[a-f0-9]{64}$/);
    expect(second.publicationId).toBe(first.publicationId);
    expect(second.reusedImmutablePublication).toBe(true);

    const revision = JSON.parse(
      await readFile(path.join(authoringDir, "publications", first.publicationId, "publication.json"), "utf8"),
    ) as {
      pageCount: number;
      states: string[];
      rendererProfile: string;
      editorSources: Array<{ kind: string; sha256: string }>;
      assetCatalogHash: string;
    };
    expect(revision.pageCount).toBe(7);
    expect(revision.states).toEqual(["menu", "level", "shop", "settings", "pause", "win", "fail"]);
    expect(revision.rendererProfile).toBe("dom-css");
    expect(revision.editorSources.map((source) => source.kind)).toEqual([
      "component-records",
      "portable-export",
      "project-json",
    ]);
    expect(revision.editorSources.every((source) => /^sha256-[a-f0-9]{64}$/u.test(source.sha256))).toBe(true);
    expect(revision.assetCatalogHash).toMatch(/^sha256-[a-f0-9]{64}$/u);
    const portableRoot = path.join(authoringDir, "publications", first.publicationId, "portable");
    const [menuHtml, styles] = await Promise.all([
      readFile(path.join(portableRoot, "menu.html"), "utf8"),
      readFile(path.join(portableRoot, "style.css"), "utf8"),
    ]);
    expect(menuHtml).not.toMatch(/\sstyle\s*=/iu);
    expect(styles).toContain('[data-shell-instance="menu.play"]');
    await expect(verifyPublishedRevision({ authoringDir, publicationId: first.publicationId, seedRoot })).resolves.toBeUndefined();
  });

  it("keeps dirty and saved-unpublished state ineligible for apply and never replaces a valid pointer with an invalid project", async () => {
    const { authoringDir, manifest } = await fixture();
    const published = await publishAuthoringProject({ authoringDir, seedRoot, renderPreviews: previewRenderer("stable") });
    const changed = updateInstancePresentation(createStarterProject(), "menu.play", { copy: "Begin" }, manifest);
    await writeFile(path.join(authoringDir, "project.json"), JSON.stringify(changed), "utf8");

    await expect(publicationStatus({ authoringDir, seedRoot })).resolves.toMatchObject({
      state: "saved-unpublished",
      canApply: false,
    });

    const unsafe = JSON.parse(await readFile(path.join(authoringDir, "project.json"), "utf8")) as {
      grapesjs: { pages: Array<Record<string, unknown>> };
    };
    unsafe.grapesjs.pages[0]!.href = "https://attacker.invalid";
    await writeFile(path.join(authoringDir, "project.json"), JSON.stringify(unsafe), "utf8");

    await expect(publishAuthoringProject({ authoringDir, seedRoot, renderPreviews: previewRenderer("blocked") })).rejects.toThrow(
      /unsafe|unsupported/i,
    );
    await expect(publicationStatus({ authoringDir, seedRoot })).resolves.toMatchObject({
      latestPublicationId: published.publicationId,
      canApply: false,
    });
  });

  it("classifies a dangling latest-published pointer (deleted publication directory) as invalid", async () => {
    const { authoringDir } = await fixture();
    const published = await publishAuthoringProject({ authoringDir, seedRoot, renderPreviews: previewRenderer("stable") });

    // Remove the immutable publication the pointer references, leaving it dangling.
    // A fully-missing publication is corruption, not a clean pre-publish state, so
    // status must surface it as invalid rather than saved-unpublished.
    await rm(path.join(authoringDir, "publications", published.publicationId), { recursive: true, force: true });

    await expect(publicationStatus({ authoringDir, seedRoot })).resolves.toMatchObject({
      state: "invalid",
      canApply: false,
    });
  });

  it("binds the reviewed asset-catalog hash and fails closed on divergence before any write", async () => {
    const { authoringDir, manifest } = await fixture();
    const projectJsonHash = await hashCanonicalJson(validateProjectFile(createStarterProject(), manifest, "shell_proof_grapes"));
    const assetCatalogHash = await hashCanonicalJson(manifest);

    // The project hash matches, but the reviewed asset inventory does not: fail closed.
    await expect(
      publishAuthoringProject({
        authoringDir,
        seedRoot,
        expectedProjectJsonHash: projectJsonHash,
        expectedAssetCatalogHash: `sha256-${"0".repeat(64)}`,
        renderPreviews: previewRenderer("catalog"),
      }),
    ).rejects.toThrow(/asset catalog hash/i);
    await expect(access(path.join(authoringDir, "publications"))).rejects.toMatchObject({ code: "ENOENT" });

    // Both reviewed hashes matching publishes the immutable record.
    const published = await publishAuthoringProject({
      authoringDir,
      seedRoot,
      expectedProjectJsonHash: projectJsonHash,
      expectedAssetCatalogHash: assetCatalogHash,
      renderPreviews: previewRenderer("catalog"),
    });
    expect(published.publicationId).toMatch(/^sha256-[a-f0-9]{64}$/);
  });

  it("binds unused reviewed replacements into publication identity and copies the full catalog", async () => {
    const { authoringDir, manifest } = await fixture();
    const first = await publishAuthoringProject({ authoringDir, seedRoot });
    const firstCatalog = JSON.parse(
      await readFile(path.join(authoringDir, "publications", first.publicationId, "portable", "asset-catalog.json"), "utf8"),
    ) as { assets: Array<{ id: string }> };
    expect(firstCatalog.assets).toHaveLength(manifest.assets.length);

    const changedRoot = await mkdtemp(path.join(os.tmpdir(), "grapes-shell-catalog-identity-"));
    temporaryRoots.push(changedRoot);
    const changedSeedRoot = path.join(changedRoot, "design");
    await cp(seedRoot, changedSeedRoot, { recursive: true });
    const changedManifestPath = path.join(changedSeedRoot, "kenney-seed.manifest.json");
    const changedManifest = JSON.parse(await readFile(changedManifestPath, "utf8")) as {
      assetCatalog: { assets: Array<{ id: string; description: string }> };
    };
    const usedAssets = new Set(
      createStarterProject().presentation.pages.flatMap((page) => page.instances.flatMap((instance) => [
        instance.presentation.assetId,
        ...Object.values(instance.variants).map((variant) => variant.assetId),
      ])).filter((id): id is string => Boolean(id)),
    );
    const unused = changedManifest.assetCatalog.assets.find((asset) => !usedAssets.has(asset.id));
    expect(unused).toBeDefined();
    unused!.description = `${unused!.description} Reviewed alternate.`;
    await writeFile(changedManifestPath, JSON.stringify(changedManifest, null, 2), "utf8");

    const second = await publishAuthoringProject({ authoringDir, seedRoot: changedSeedRoot });
    expect(second.publicationId).not.toBe(first.publicationId);
  });

  it("rejects mixed or divergent portable records instead of treating a tampered pair as portable evidence", async () => {
    const { authoringDir } = await fixture();
    const published = await publishAuthoringProject({ authoringDir, seedRoot, renderPreviews: previewRenderer("records") });
    const recordsPath = path.join(authoringDir, "publications", published.publicationId, "portable", "records.json");
    const records = JSON.parse(await readFile(recordsPath, "utf8")) as {
      records: Array<{ prototypeInstanceId: string; presentation: { copy?: string } }>;
    };
    records.records[0]!.prototypeInstanceId = "diverged.prototype";
    await writeFile(recordsPath, JSON.stringify(records), "utf8");

    await expect(verifyPublishedRevision({ authoringDir, publicationId: published.publicationId, seedRoot })).rejects.toThrow(
      /mixed|diverg|canonical/i,
    );
  });

  it("rejects swapped asset bytes and extra files in an immutable publication", async () => {
    const { authoringDir } = await fixture();
    const published = await publishAuthoringProject({ authoringDir, seedRoot, renderPreviews: previewRenderer("assets") });
    const publication = path.join(authoringDir, "publications", published.publicationId);
    const catalog = JSON.parse(await readFile(path.join(publication, "portable", "asset-catalog.json"), "utf8")) as {
      assets: Array<{ path: string }>;
    };
    await writeFile(path.join(publication, catalog.assets[0]!.path), "tampered-raster-bytes", "utf8");

    await expect(verifyPublishedRevision({ authoringDir, publicationId: published.publicationId, seedRoot })).rejects.toThrow(
      /asset bytes diverge/i,
    );

    await writeFile(path.join(publication, "assets", "unexpected.png"), "extra", "utf8");
    await expect(verifyPublishedRevision({ authoringDir, publicationId: published.publicationId, seedRoot })).rejects.toThrow(
      /directory entries diverge/i,
    );
  });

  it("regenerates portable pages and confines publication identities before reading disk", async () => {
    const { authoringDir } = await fixture();
    const published = await publishAuthoringProject({ authoringDir, seedRoot, renderPreviews: previewRenderer("pages") });
    const menuPath = path.join(authoringDir, "publications", published.publicationId, "portable", "menu.html");
    await writeFile(menuPath, `${await readFile(menuPath, "utf8")}<!-- diverged -->`, "utf8");

    await expect(verifyPublishedRevision({ authoringDir, publicationId: published.publicationId, seedRoot })).rejects.toThrow(
      /html|styles|regeneration|diverge/i,
    );
    await expect(verifyPublishedRevision({ authoringDir, publicationId: "../outside", seedRoot })).rejects.toThrow(
      /invalid publication identity/i,
    );
  });

  it("rejects tampered derived previews when the same renderer fingerprint is reused", async () => {
    const { authoringDir } = await fixture();
    const renderer = previewRenderer("repeatable");
    const published = await publishAuthoringProject({ authoringDir, seedRoot, renderPreviews: renderer });
    const preview = path.join(
      authoringDir,
      "previews",
      published.publicationId,
      published.previewFingerprintId!,
      "menu.png",
    );
    await writeFile(preview, "tampered-preview", "utf8");

    await expect(publishAuthoringProject({ authoringDir, seedRoot, renderPreviews: renderer })).rejects.toThrow(
      /preview bytes|preview manifest|diverge/i,
    );
  });
});
