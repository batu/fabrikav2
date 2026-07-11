import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  canReorderInstance,
  createStarterProject,
  createConstrainedGrapesProject,
  duplicateInstance,
  reorderInstance,
  updateInstancePresentation,
  validateProjectFile,
} from "../../src/shared/project.ts";
import { readSeedManifest } from "../../src/shared/seed.ts";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const repositoryRoot = path.resolve(workspaceRoot, "../..");
const seedRoot = path.join(repositoryRoot, "games/_template/design");

async function manifest() {
  return readSeedManifest(seedRoot);
}

describe("constrained GrapesJS project", () => {
  it("validates a six-page starter project against U2's exact semantic asset manifest", async () => {
    const project = createStarterProject();
    const seed = await manifest();

    const parsed = validateProjectFile(project, seed);

    expect(parsed.presentation.pages.map((page) => page.stateId)).toEqual([
      "menu",
      "level",
      "settings",
      "pause",
      "win",
      "fail",
    ]);
    expect(parsed.presentation.pages.flatMap((page) => page.instances).some((instance) => instance.presentation.assetId)).toBe(true);
    expect(parsed.targetGame).toBe("shell_proof");
    expect(() => validateProjectFile(project, seed, "another_game")).toThrow(/targets game/i);
  });

  it("duplicates with a new stable identity while retaining the original runtime binding", async () => {
    const project = createStarterProject();
    const duplicate = duplicateInstance(project, "menu.currency");
    const seed = await manifest();
    const parsed = validateProjectFile(duplicate.project, seed);
    const page = parsed.presentation.pages.find((candidate) => candidate.stateId === "menu");
    const copy = page?.instances.find((instance) => instance.id === duplicate.instanceId);
    const original = page?.instances.find((instance) => instance.id === "menu.currency");

    expect(duplicate.instanceId).not.toBe("menu.currency");
    expect(copy?.bindingId).toBe(original?.bindingId);
    expect(copy?.prototypeInstanceId).toBe(original?.prototypeInstanceId);
  });

  it("keeps a duplicated child inside its semantic parent subtree", async () => {
    const seed = await manifest();
    const duplicate = duplicateInstance(createStarterProject(), "menu.node.current");
    const parsed = validateProjectFile(duplicate.project, seed);
    const page = parsed.presentation.pages.find((candidate) => candidate.stateId === "menu")!;
    const progression = page.instances.find((instance) => instance.id === "menu.progression-map")!;
    const copy = page.instances.find((instance) => instance.id === duplicate.instanceId)!;
    const children = page.instances
      .filter((instance) => instance.parentInstanceId === progression.id)
      .sort((left, right) => left.presentation.order - right.presentation.order);

    expect(copy.parentInstanceId).toBe(progression.id);
    expect(children.at(-1)?.id).toBe(copy.id);
    expect(children[0]!.presentation.order).toBe(progression.presentation.order + 1);
    expect(children.every((child, index) => child.presentation.order === progression.presentation.order + index + 1)).toBe(true);
  });

  it("fails closed before load when raw Grapes data carries executable fields or diverges from the AST", async () => {
    const seed = await manifest();
    const malicious = createStarterProject() as unknown as Record<string, unknown>;
    const grapes = malicious.grapesjs as { pages: Array<Record<string, unknown>> };
    grapes.pages[0]!.script = "fetch('https://attacker.invalid')";

    expect(() => validateProjectFile(malicious, seed)).toThrow(/script|unsafe|unsupported/i);

    const divergent = createStarterProject() as unknown as Record<string, unknown>;
    const pages = (divergent.grapesjs as { pages: Array<{ components: Array<Record<string, unknown>> }> }).pages;
    pages[0]!.components[0]!.copy = "Different portable component";

    expect(() => validateProjectFile(divergent, seed)).toThrow(/diverge|canonical/i);

    const source = createStarterProject();
    const presentation = structuredClone(source.presentation);
    presentation.pages[0]!.instances[0]!.presentation.copy = "..\\untrusted-copy";
    const pathEscape = { ...source, presentation, grapesjs: createConstrainedGrapesProject(presentation) };

    expect(() => validateProjectFile(pathEscape, seed)).toThrow(/unsafe|path/i);
  });

  it("uses only the committed U2 manifest as its asset vocabulary", async () => {
    const seed = await manifest();
    const raw = JSON.parse(await readFile(path.join(seedRoot, "kenney-seed.manifest.json"), "utf8")) as {
      assets: Array<{ id: string }>;
    };

    expect(seed.assets.map((asset) => asset.id)).toEqual(raw.assets.map((asset) => asset.id));
  });

  it("accepts only U1 color channels for palette edits", async () => {
    const seed = await manifest();
    const project = createStarterProject();
    const updated = updateInstancePresentation(
      project,
      "menu.play",
      { colors: { ...project.presentation.pages[0]!.instances.find((instance) => instance.id === "menu.play")!.presentation.colors, background: "#ff3355" } },
      seed,
    );

    expect(updated.presentation.pages[0]!.instances.find((instance) => instance.id === "menu.play")!.presentation.colors?.background).toBe("#ff3355");
    expect(() => updateInstancePresentation(project, "menu.play", { colors: { surface: "#ff3355" } }, seed)).toThrow(
      /unsupported color channel/i,
    );
  });

  it("reorders sibling subtrees while keeping every child above its semantic parent", async () => {
    const seed = await manifest();
    const initial = createStarterProject();
    const originalOrder = initial.presentation.pages
      .find((candidate) => candidate.stateId === "menu")!
      .instances.find((instance) => instance.id === "menu.play")!.presentation.order;
    const reordered = reorderInstance(initial, "menu.play", "backward", seed);
    const page = reordered.presentation.pages.find((candidate) => candidate.stateId === "menu")!;
    const play = page.instances.find((instance) => instance.id === "menu.play")!;
    const progression = page.instances.find((instance) => instance.id === "menu.progression-map")!;
    const progressionChildren = page.instances.filter((instance) => instance.parentInstanceId === progression.id);

    expect(play.presentation.order).toBeLessThan(originalOrder);
    expect(play.presentation.order).toBeLessThan(progression.presentation.order);
    expect(progressionChildren.every((child) => child.presentation.order > progression.presentation.order)).toBe(true);
    expect(validateProjectFile(reordered, seed).presentation.pages).toHaveLength(6);
  });

  it("never reorders a child across its parent boundary", async () => {
    const seed = await manifest();
    const project = createStarterProject();

    expect(canReorderInstance(project, "menu.node.completed", "backward")).toBe(false);
    expect(reorderInstance(project, "menu.node.completed", "backward", seed)).toBe(project);

    const reordered = reorderInstance(project, "menu.node.current", "backward", seed);
    const page = reordered.presentation.pages.find((candidate) => candidate.stateId === "menu")!;
    const progression = page.instances.find((instance) => instance.id === "menu.progression-map")!;
    const completed = page.instances.find((instance) => instance.id === "menu.node.completed")!;
    const current = page.instances.find((instance) => instance.id === "menu.node.current")!;

    expect(current.presentation.order).toBeLessThan(completed.presentation.order);
    expect(current.presentation.order).toBeGreaterThan(progression.presentation.order);
    expect(current.parentInstanceId).toBe(progression.id);
  });

  it("does not allocate or dirty a project when a layer is already at its boundary", async () => {
    const seed = await manifest();
    const project = createStarterProject();

    expect(reorderInstance(project, "menu.title", "backward", seed)).toBe(project);
  });
});
