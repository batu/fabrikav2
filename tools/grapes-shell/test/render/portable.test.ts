import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { shellPresentationContract } from "@fabrikav2/kernel";

import { publishAuthoringProject } from "../../src/publication/publisher.ts";
import { renderPortablePreviews } from "../../src/publication/preview.ts";
import { createStarterProject } from "../../src/shared/project.ts";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const repositoryRoot = path.resolve(workspaceRoot, "../..");
const seedRoot = path.join(repositoryRoot, "games/_template/design");
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("portable publication renderer", () => {
  it("renders all six local portable pages with scripts and HTTP networking disabled", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "grapes-shell-render-"));
    temporaryRoots.push(root);
    const authoringDir = path.join(root, "games/shell_proof/authoring/grapesjs");
    await mkdir(authoringDir, { recursive: true });
    await writeFile(path.join(authoringDir, "project.json"), JSON.stringify(createStarterProject()), "utf8");

    const result = await publishAuthoringProject({ authoringDir, seedRoot, renderPreviews: renderPortablePreviews });
    const manifestPath = path.join(authoringDir, "previews", result.publicationId, result.previewFingerprintId!, "preview.json");
    const manifest = JSON.parse(await (await import("node:fs/promises")).readFile(manifestPath, "utf8")) as {
      fingerprint: { deviceScaleFactor: number; animations: string; loadBarrier: string; encoder: string };
      pages: Array<{ stateId: string; filename: string; sha256: string }>;
    };

    expect(manifest.pages.map((page) => page.stateId)).toEqual(["menu", "level", "settings", "pause", "win", "fail"]);
    expect(manifest.pages.every((page) => page.filename.endsWith(".png") && /^sha256-[a-f0-9]{64}$/.test(page.sha256))).toBe(true);
    expect(manifest.fingerprint).toMatchObject({
      renderer: expect.stringMatching(/^playwright-chromium-/),
      deviceScaleFactor: 1,
      animations: "disabled",
      loadBarrier: "portable-html-safety-images-fonts-and-render-marker",
      encoder: "playwright-png",
    });
  });

  it("rejects executable or networked portable markup before launching a browser", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "grapes-shell-render-unsafe-"));
    temporaryRoots.push(root);
    const authoringDir = path.join(root, "games/shell_proof/authoring/grapesjs");
    await mkdir(authoringDir, { recursive: true });
    await writeFile(path.join(authoringDir, "project.json"), JSON.stringify(createStarterProject()), "utf8");
    const result = await publishAuthoringProject({ authoringDir, seedRoot });
    const portableDirectory = path.join(authoringDir, "publications", result.publicationId, "portable");
    const menu = path.join(portableDirectory, "menu.html");
    await writeFile(menu, `${await (await import("node:fs/promises")).readFile(menu, "utf8")}<img src="https://attacker.invalid/x.png">`, "utf8");

    await expect(renderPortablePreviews({
      portableDirectory,
      states: shellPresentationContract.publication.requiredStates,
    })).rejects.toThrow(/executable|networked/i);
  });
});
