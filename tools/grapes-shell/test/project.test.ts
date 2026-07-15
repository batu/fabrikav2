import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { applyExactAssetReplacement } from "../src/asset-replacement.ts";
import { publicationRevision, validateProjectData, validateTokenCss, verifyAssetBytes, workingRevision, type AssetManifest } from "../src/model.ts";
import { mutationRequestFailure } from "../src/server.ts";
import { MarbleProjectStore, RevisionConflictError, type StorePaths } from "../src/store.ts";

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
    tokens: path.join(root, "tokens.css"),
  };
  await Promise.all([
    cp(path.join(authoringRoot, "baseline/project.json"), paths.baseline),
    cp(path.join(authoringRoot, "working/project.json"), paths.working),
    cp(path.join(authoringRoot, "assets-manifest.json"), paths.manifest),
    cp(path.join(repositoryRoot, "games/marble_run/design/tokens.css"), paths.tokens),
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

  it("locks the canonical P1/P2 visual-repair geometry into native project data", async () => {
    const project = await sourceJson("baseline/project.json") as Record<string, unknown>;
    const confetti = findById(project, "menu.confetti");
    const completed = styleFor(project, "menu.saga.completed.4");
    const current = styleFor(project, "menu.saga.current.1");

    expect(records(confetti.components)).toHaveLength(16);
    expect(records(confetti.components).map((fleck) => (fleck.attributes as Record<string, unknown>)["data-fab-id"]))
      .toEqual(Array.from({ length: 16 }, (_, index) => `menu.confetti.${index + 1}`));
    expect(completed).toMatchObject({ width: "66px", height: "66px" });
    expect(Number.parseInt(String(completed.top), 10)).toBeGreaterThanOrEqual(300);
    expect(current).toMatchObject({ width: "150px", height: "150px", "z-index": "5" });

    expect(styleFor(project, "gameplay.background")).toMatchObject({
      "background-size": "94px 94px, 100% 100%",
      "background-repeat": "repeat, no-repeat",
    });
    expect(styleFor(project, "gameplay.placeholder")).toMatchObject({
      background: "transparent",
      border: "0",
    });
    expect(styleFor(project, "gameplay.placeholder.label").display).toBe("none");
    expect(styleFor(project, "gameplay.hint.cost")["text-shadow"]).not.toBe("0 3px 0 #203050");

    for (const screen of ["settings-menu", "settings-level"]) {
      const card = styleFor(project, `${screen}.card`);
      const ribbon = styleFor(project, `${screen}.ribbon`);
      const close = styleFor(project, `${screen}.close`);
      expect(card["object-fit"]).toBe("fill");
      expect(Number.parseInt(String(ribbon.top), 10) + Number.parseInt(String(ribbon.height), 10))
        .toBeGreaterThan(Number.parseInt(String(card.top), 10));
      expect(close).toMatchObject({ left: "306px", top: card.top });
      for (const row of ["music", "sfx", "haptics"]) {
        expect(styleFor(project, `${screen}.toggle.${row}.label`)["text-shadow"]).toBe("none");
      }
    }

    const winCard = styleFor(project, "win.card");
    const winRibbon = styleFor(project, "win.ribbon");
    const winEyebrow = styleFor(project, "win.eyebrow");
    expect(winCard["object-fit"]).toBe("fill");
    expect(Number.parseInt(String(winRibbon.top), 10) + Number.parseInt(String(winRibbon.height), 10))
      .toBeGreaterThan(Number.parseInt(String(winCard.top), 10));
    expect(Number.parseInt(String(winEyebrow.top), 10)).toBeGreaterThan(Number.parseInt(String(winRibbon.top), 10));
    expect(winEyebrow.color).toBe("#572915");
    expect(winEyebrow["text-shadow"]).not.toBe("0 3px 0 #203050");
    for (const screen of ["fail", "finale"]) {
      expect(styleFor(project, `${screen}.card`)["object-fit"]).toBe("fill");
    }
  });

  it("persists transforms, live copy, visibility, reorder, duplicate identity and asset bindings across a fresh store instance", async () => {
    const { store, paths } = await temporaryStore();
    const project = await store.readWorking();
    const before = workingRevision(project);
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

    await store.saveWorking(project, before);
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
    const before = workingRevision(project);
    findById(project, "gameplay.hint.label").content = "FREE";
    const saved = await store.saveWorking(project, before);
    const reset = await store.reset(saved.revision);

    expect(findById(reset.project, "gameplay.hint.label").content).toBe("HINT");
    expect(await readFile(paths.baseline, "utf8")).toBe(baselineBefore);
  });

  it("creates immutable revision-addressed previews directly from saved native project data", async () => {
    const { store } = await temporaryStore();
    const initial = await store.readWorking();
    const first = await store.publishWorking(workingRevision(initial));
    findById(initial, "pause.title").content = "Paused!";
    const saved = await store.saveWorking(initial, workingRevision(await store.readWorking()));
    const second = await store.publishWorking(saved.revision);

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

  it("hashes native project data plus frozen rendered dependencies and the fixed preview profile", async () => {
    const project = await sourceJson("baseline/project.json");
    const manifest = await sourceJson("assets-manifest.json") as AssetManifest;
    const { store } = await temporaryStore();
    const dependencies = await store.sourceDependenciesForTest();
    const first = publicationRevision(project, manifest, dependencies.snapshot);
    const changed = structuredClone(project) as Record<string, unknown>;
    findById(changed, "shop.restore.button.label").content = "RESTORE";
    expect(publicationRevision(changed, manifest, dependencies.snapshot)).not.toBe(first);

    const changedTokens = {
      ...structuredClone(dependencies.snapshot),
      tokens: { ...dependencies.snapshot.tokens, sha256: "f".repeat(64) },
    };
    expect(publicationRevision(project, manifest, changedTokens)).not.toBe(first);
  });

  it("fails closed on every uncurated image or CSS URL and missing page-root dimensions", async () => {
    const project = await sourceJson("baseline/project.json") as Record<string, unknown>;
    const manifest = await sourceJson("assets-manifest.json") as AssetManifest;

    for (const source of ["https://example.invalid/icon.png", "data:image/png;base64,AA==", "/marble-assets/not-curated.png"]) {
      const invalid = structuredClone(project);
      const image = findById(invalid, "menu.currency.icon");
      image.src = source;
      (image.attributes as Record<string, unknown>).src = source;
      expect(() => validateProjectData(invalid, manifest)).toThrow(/uncurated asset URL/u);
    }

    const cssRemote = structuredClone(project);
    styleFor(cssRemote, "menu.currency.group").background = "url(https://example.invalid/pixel.png)";
    expect(() => validateProjectData(cssRemote, manifest)).toThrow(/uncurated CSS URL/u);

    for (const escaped of [
      "u\\72l(\"/marble-assets/icon-coin.png\")",
      "u\\72l(\"h\\74tps://attacker.invalid/pixel.png\")",
    ]) {
      const escapedCss = structuredClone(project);
      styleFor(escapedCss, "menu.currency.group").background = escaped;
      expect(() => validateProjectData(escapedCss, manifest)).toThrow(/CSS escapes are not supported/u);
    }

    const srcsetRemote = structuredClone(project);
    (findById(srcsetRemote, "menu.currency.icon").attributes as Record<string, unknown>).srcset = "data:image/png;base64,AA== 2x";
    expect(() => validateProjectData(srcsetRemote, manifest)).toThrow(/component schema/u);

    const embeddedImage = structuredClone(project);
    findById(embeddedImage, "pause.title").content = "<img src='/marble-assets/icon-coin.png'>";
    expect(() => validateProjectData(embeddedImage, manifest)).toThrow(/component schema/u);

    for (const content of [
      "<style>.x { background: u\\72l('h\\74tps://attacker.invalid/pixel.png'); }</style>",
      "&lt;div style=&quot;background:u&#92;72l('h&#92;74tps://attacker.invalid/pixel.png')&quot;&gt;x&lt;/div&gt;",
    ]) {
      const styleMarkup = structuredClone(project);
      findById(styleMarkup, "pause.title").content = content;
      expect(() => validateProjectData(styleMarkup, manifest)).toThrow(/component schema/u);
    }

    expect(() => validateTokenCss("@import url('https://example.invalid/theme.css');", manifest)).toThrow(/uncurated/u);
    expect(() => validateTokenCss(".x { background: u\\72l('h\\74tps://attacker.invalid/pixel.png'); }", manifest))
      .toThrow(/CSS escapes are not supported/u);

    const noDimensions = structuredClone(project);
    const root = pageRoot(noDimensions, 0);
    delete root.style;
    const rootId = (root.attributes as Record<string, unknown>).id;
    const rootRule = records(noDimensions.styles).find((rule) => Array.isArray(rule.selectors) && rule.selectors.includes(`#${String(rootId)}`));
    if (rootRule) delete (rootRule.style as Record<string, unknown>).width;
    expect(() => validateProjectData(noDimensions, manifest)).toThrow(/must be 390x844/u);
  });

  it("rejects every component shape outside the explicit Marble authoring schema", async () => {
    const project = await sourceJson("baseline/project.json") as Record<string, unknown>;
    const manifest = await sourceJson("assets-manifest.json") as AssetManifest;
    const attacks: Array<[string, (component: Record<string, unknown>) => void]> = [
      ["unknown component type", (component) => { component.type = "video"; }],
      ["unknown component field", (component) => { component.metadata = { executable: true }; }],
      ["style tag", (component) => {
        component.tagName = "style";
        component.content = "body { background: u\\72l('h\\74tps://attacker.invalid/pixel.png'); }";
      }],
      ["script tag", (component) => {
        component.tagName = "script";
        component.content = "globalThis.pwned = true";
      }],
      ["component script", (component) => { component.script = "globalThis.pwned = true"; }],
      ["event handler", (component) => {
        (component.attributes as Record<string, unknown>).onclick = "globalThis.pwned = true";
      }],
      ["javascript link", (component) => {
        (component.attributes as Record<string, unknown>).href = "javascript:globalThis.pwned=true";
      }],
      ["iframe srcdoc", (component) => {
        component.tagName = "iframe";
        (component.attributes as Record<string, unknown>).srcdoc = "<p>owned</p>";
      }],
      ["entity-encoded style", (component) => {
        (component.attributes as Record<string, unknown>).style = "background:u&#92;72l(&quot;h&#92;74tps&colon;&#47;&#47;attacker.invalid/pixel.png&quot;)";
      }],
      ["poster asset", (component) => {
        (component.attributes as Record<string, unknown>).poster = "/marble-assets/icon-coin.png";
      }],
      ["background asset", (component) => {
        (component.attributes as Record<string, unknown>).background = "/marble-assets/icon-coin.png";
      }],
    ];

    const schemaFailures: string[] = [];
    for (const [label, attack] of attacks) {
      const invalid = structuredClone(project);
      attack(findById(invalid, "pause.card"));
      try {
        validateProjectData(invalid, manifest);
        schemaFailures.push(`${label}: accepted`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/component schema/u.test(message)) schemaFailures.push(`${label}: ${message}`);
      }
    }
    expect(schemaFailures).toEqual([]);
  });

  it("replaces the selected image in one model update with synchronized exact metadata", async () => {
    const manifest = await sourceJson("assets-manifest.json") as AssetManifest;
    const calls: Record<string, unknown>[] = [];
    const component = {
      getAttributes: () => ({ "data-fab-id": "menu.settings.icon", "data-fab-role": "settings-icon", src: "/marble-assets/icon-settings.png" }),
      set: (value: Record<string, unknown>) => { calls.push(value); },
    };
    const replacement = applyExactAssetReplacement(component, manifest, "/marble-assets/icon-coin.png");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      src: "/marble-assets/icon-coin.png",
      attributes: {
        src: "/marble-assets/icon-coin.png",
        "data-asset-role": "coin-icon",
        "data-asset-sha": "e77e5dbf6899c3d427d1a846bdab2bb693bb59a5693c31ea6e1ec0eda9076980",
      },
    });
    expect(replacement.role).toBe("coin-icon");
  });

  it("requires same-origin and an unguessable session capability for every mutation", () => {
    const capability = "x".repeat(43);
    const headers = { host: "127.0.0.1:5203", origin: "http://127.0.0.1:5203", "x-fabrikav2-capability": capability };
    expect(mutationRequestFailure(headers, capability)).toBeUndefined();
    expect(mutationRequestFailure({ ...headers, origin: "https://attacker.invalid" }, capability)).toMatch(/same origin/u);
    expect(mutationRequestFailure({ ...headers, "x-fabrikav2-capability": "wrong" }, capability)).toMatch(/capability/u);
    expect(mutationRequestFailure({ host: "internal:5203", "x-forwarded-host": "portal.example", "x-forwarded-proto": "https", origin: "https://portal.example", "x-fabrikav2-capability": capability }, capability)).toBeUndefined();
  });

  it("rejects stale save and reset revisions with an explicit conflict", async () => {
    const { store } = await temporaryStore();
    const initial = await store.readWorkingState();
    const changed = structuredClone(initial.project);
    findById(changed, "pause.title").content = "First tab";
    const saved = await store.saveWorking(changed, initial.revision);

    await expect(store.saveWorking(initial.project, initial.revision)).rejects.toBeInstanceOf(RevisionConflictError);
    await expect(store.reset(initial.revision)).rejects.toBeInstanceOf(RevisionConflictError);
    expect((await store.readWorkingState()).revision).toBe(saved.revision);
  });

  it("serves only revision-owned bytes and rejects publication tampering under a stale stamp", async () => {
    const { store, paths } = await temporaryStore();
    const state = await store.readWorkingState();
    const published = await store.publishWorking(state.revision);
    const project = await store.readPublicationPreview(published.revision);
    expect((findById(project, "menu.currency.icon").attributes as Record<string, unknown>).src)
      .toBe(`/api/publications/${published.revision}/assets/icon-coin.png`);
    expect(await store.readPublicationTokens(published.revision)).toContain("./assets/fonts/FredokaOne.woff2");

    const publicationRoot = path.join(paths.publications, published.revision);
    const publicationProject = path.join(publicationRoot, "project.json");
    const originalProject = await readFile(publicationProject, "utf8");
    const tampered = JSON.parse(originalProject) as Record<string, unknown>;
    findById(tampered, "pause.title").content = "tampered";
    await writeFile(publicationProject, `${JSON.stringify(tampered)}\n`);
    await expect(store.readPublication(published.revision)).rejects.toThrow(/revision integrity/u);
    await expect(store.readPublicationAsset(published.revision, "icon-coin.png")).rejects.toThrow(/revision integrity/u);

    await writeFile(publicationProject, originalProject);
    const tokenPath = path.join(publicationRoot, "tokens.css");
    const originalTokens = await readFile(tokenPath);
    await writeFile(tokenPath, Buffer.concat([originalTokens, Buffer.from("\n:root { --tampered: 1; }\n")]));
    await expect(store.readPublication(published.revision)).rejects.toThrow(/revision integrity/u);

    await writeFile(tokenPath, originalTokens);
    const assetPath = path.join(publicationRoot, "assets/icon-coin.png");
    const originalAsset = await readFile(assetPath);
    await writeFile(assetPath, Buffer.concat([originalAsset, Buffer.from([0])]));
    await expect(store.readPublication(published.revision)).rejects.toThrow(/revision integrity/u);
  });
});
