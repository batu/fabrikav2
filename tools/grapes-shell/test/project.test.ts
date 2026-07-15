import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { publicationRevision, validateProjectData, verifyAssetBytes, type AssetManifest } from "../src/model.ts";
import { MarbleProjectStore, type StorePaths } from "../src/store.ts";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(workspaceRoot, "../..");
const authoringRoot = path.join(repositoryRoot, "games/marble_run/authoring/grapesjs");
const assetRoot = path.join(repositoryRoot, "games/marble_run/design/assets");
const temporaryRoots: string[] = [];

async function sourceJson(relative: string): Promise<unknown> {
  return JSON.parse(await readFile(path.join(authoringRoot, relative), "utf8")) as unknown;
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value as Record<string, unknown>[] : [];
}

function findById(project: Record<string, unknown>, id: string): Record<string, unknown> {
  const pending = [...records(project.pages)];
  while (pending.length > 0) {
    const current = pending.shift()!;
    if ((current.attributes as Record<string, unknown> | undefined)?.["data-fab-id"] === id) return current;
    if (current.component) pending.push(current.component as Record<string, unknown>);
    for (const frame of records(current.frames)) if (frame.component) pending.push(frame.component as Record<string, unknown>);
    pending.push(...records(current.components));
  }
  throw new Error(`Missing ${id}`);
}

function pageRoot(project: Record<string, unknown>, index: number): Record<string, unknown> {
  const page = records(project.pages)[index]!;
  if (page.component) return page.component as Record<string, unknown>;
  return records(page.frames)[0]!.component as Record<string, unknown>;
}

function styleFor(project: Record<string, unknown>, semanticId: string): Record<string, unknown> {
  const component = findById(project, semanticId);
  if (component.style && typeof component.style === "object") return component.style as Record<string, unknown>;
  const grapeId = (component.attributes as Record<string, unknown>).id;
  const rule = records(project.styles).find((candidate) => Array.isArray(candidate.selectors) && candidate.selectors.includes(`#${String(grapeId)}`));
  if (!rule?.style || typeof rule.style !== "object") throw new Error(`Missing style rule for ${semanticId}`);
  return rule.style as Record<string, unknown>;
}

function suffixSemanticIds(component: Record<string, unknown>, suffix: string): void {
  const attributes = component.attributes as Record<string, unknown> | undefined;
  if (typeof attributes?.["data-fab-id"] === "string") attributes["data-fab-id"] = `${attributes["data-fab-id"]}${suffix}`;
  for (const child of records(component.components)) suffixSemanticIds(child, suffix);
}

async function temporaryStore(): Promise<{ store: MarbleProjectStore; paths: StorePaths }> {
  const root = await mkdtemp(path.join(tmpdir(), "marble-grapes-store-"));
  temporaryRoots.push(root);
  const paths: StorePaths = {
    baseline: path.join(root, "baseline.json"),
    working: path.join(root, "working.json"),
    publications: path.join(root, "publications"),
    latest: path.join(root, "latest.json"),
    manifest: path.join(root, "assets.json"),
    assetRoot,
  };
  await Promise.all([
    cp(path.join(authoringRoot, "baseline/project.json"), paths.baseline),
    cp(path.join(authoringRoot, "working/project.json"), paths.working),
    cp(path.join(authoringRoot, "assets-manifest.json"), paths.manifest),
  ]);
  return { store: new MarbleProjectStore(paths), paths };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("native Marble Run GrapesJS authority", () => {
  it("contains exactly nine native Pages at 390x844 with meaningful unique semantic layers", async () => {
    const project = await sourceJson("baseline/project.json");
    const manifest = await sourceJson("assets-manifest.json") as AssetManifest;
    const validated = validateProjectData(project, manifest);
    const pages = validated.pages as Record<string, unknown>[];

    expect(pages.map((page) => page.id)).toEqual([
      "menu", "gameplay-hud", "pause", "settings-menu", "settings-level", "win", "fail", "finale", "shop",
    ]);
    expect(findById(validated, "menu.currency.group")).toBeTruthy();
    expect(findById(validated, "gameplay.lives")).toBeTruthy();
    expect(findById(validated, "settings-level.restart.group")).toBeTruthy();
    expect(findById(validated, "win.reward.amount")).toBeTruthy();
    expect(findById(validated, "fail.watch.group")).toBeTruthy();
    expect(findById(validated, "finale.awesome.group")).toBeTruthy();
    expect(findById(validated, "shop.restore.button")).toBeTruthy();
  });

  it("proves every curated binding still points to the exact current Marble source bytes", async () => {
    await expect(verifyAssetBytes(assetRoot, await sourceJson("assets-manifest.json") as AssetManifest)).resolves.toBeUndefined();
  });

  it("persists transforms, live copy, visibility, reorder, duplicate identity and asset bindings across a fresh store instance", async () => {
    const { store, paths } = await temporaryStore();
    const project = await store.readWorking();
    Object.assign(styleFor(project, "menu.currency.group"), { left: "23px", width: "88px" });
    findById(project, "menu.currency.value").content = "250";
    Object.assign(styleFor(project, "menu.settings.group"), { display: "none" });
    const component = pageRoot(project, 0);
    const layers = component.components as Record<string, unknown>[];
    const source = structuredClone(findById(project, "menu.currency.group"));
    suffixSemanticIds(source, ".copy-1");
    (source.attributes as Record<string, unknown>)["data-fab-label"] = "Currency counter copy";
    layers.push(source);
    layers.unshift(layers.splice(layers.findIndex((layer) => (layer.attributes as Record<string, unknown> | undefined)?.["data-fab-id"] === "menu.settings.group"), 1)[0]!);

    await store.saveWorking(project);
    const afterRestart = await new MarbleProjectStore(paths).readWorking();
    expect(styleFor(afterRestart, "menu.currency.group").left).toBe("23px");
    expect(findById(afterRestart, "menu.currency.value").content).toBe("250");
    expect(styleFor(afterRestart, "menu.settings.group").display).toBe("none");
    expect(findById(afterRestart, "menu.currency.group.copy-1")).toBeTruthy();
    expect((findById(afterRestart, "menu.currency.icon").attributes as Record<string, unknown>).src).toBe("/marble-assets/icon-coin.png");
  });

  it("restores the protected baseline without modifying it", async () => {
    const { store, paths } = await temporaryStore();
    const baselineBefore = await readFile(paths.baseline, "utf8");
    const project = await store.readWorking();
    findById(project, "gameplay.hint.label").content = "FREE";
    await store.saveWorking(project);
    const reset = await store.reset();

    expect(findById(reset, "gameplay.hint.label").content).toBe("HINT");
    expect(await readFile(paths.baseline, "utf8")).toBe(baselineBefore);
  });

  it("creates immutable revision-addressed previews directly from saved native project data", async () => {
    const { store } = await temporaryStore();
    const initial = await store.readWorking();
    const first = await store.publish(initial);
    findById(initial, "pause.title").content = "Paused!";
    await store.saveWorking(initial);
    const second = await store.publish(initial);

    expect(first.revision).toMatch(/^sha256-[a-f0-9]{64}$/u);
    expect(second.revision).not.toBe(first.revision);
    expect(second.previewUrl).toContain(second.revision);
    expect(findById(await store.readPublication(first.revision), "pause.title").content).toBe("Paused");
    expect(findById(await store.readPublication(second.revision), "pause.title").content).toBe("Paused!");
  });

  it("fails closed on page loss, duplicate identity and wrong asset hash metadata", async () => {
    const project = await sourceJson("baseline/project.json") as Record<string, unknown>;
    const manifest = await sourceJson("assets-manifest.json") as AssetManifest;
    const missingPage = structuredClone(project);
    (missingPage.pages as unknown[]).pop();
    expect(() => validateProjectData(missingPage, manifest)).toThrow(/Pages must be exactly/u);

    const duplicate = structuredClone(project);
    (findById(duplicate, "menu.settings.group").attributes as Record<string, unknown>)["data-fab-id"] = "menu.currency.group";
    expect(() => validateProjectData(duplicate, manifest)).toThrow(/Duplicate semantic instance id/u);

    const wrongHash = structuredClone(project);
    (findById(wrongHash, "win.crown").attributes as Record<string, unknown>)["data-asset-sha"] = "0".repeat(64);
    expect(() => validateProjectData(wrongHash, manifest)).toThrow(/Asset hash metadata diverges/u);
  });

  it("hashes only native project data, exact assets and the fixed preview profile", async () => {
    const project = await sourceJson("baseline/project.json");
    const manifest = await sourceJson("assets-manifest.json") as AssetManifest;
    const first = publicationRevision(project, manifest);
    const changed = structuredClone(project) as Record<string, unknown>;
    findById(changed, "shop.restore.button.label").content = "RESTORE";
    expect(publicationRevision(changed, manifest)).not.toBe(first);
  });
});
