// R6/AE2: invalid catalog IDs and missing required bindings block publication
// with typed results, and a blocked publication performs no writes.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - plain .mjs helpers without type declarations
import { checkScene, checkDefaultProject } from "../scripts/publish-check.mjs";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - plain .mjs helpers without type declarations
import { projectManifest, manifestHash } from "../scripts/lib.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const load = (rel: string) => JSON.parse(readFileSync(join(root, rel), "utf8"));

const catalog = load("catalog/catalog.json");
const pack = load("editor-project/public/assets/asset-pack.json");
const freshScene = () => load("editor-project/src/scenes/Probe.scene");

function firstAssetObj(scene: ReturnType<typeof freshScene>) {
  let hit: Record<string, unknown> | undefined;
  const walk = (list: Record<string, unknown>[]) => {
    for (const o of list ?? []) {
      if (o["Semantic.fabRole"] === "asset") hit ??= o;
      walk((o.list as Record<string, unknown>[]) ?? []);
    }
  };
  walk(scene.displayList);
  if (!hit) throw new Error("no asset-role object in scene");
  return hit;
}

describe("typed publication gate (R6)", () => {
  it("the committed probe project publishes clean", () => {
    expect(checkDefaultProject()).toEqual({ result: "ok", blocks: [] });
  });

  it("an invalid catalog id blocks with blocked-invalid-catalog-id", () => {
    const scene = freshScene();
    firstAssetObj(scene)["Semantic.fabBinding"] = "asset:cat.badge.nonexistent";
    const verdict = checkScene(scene, catalog, pack);
    expect(verdict.result).toBe("blocked");
    expect(verdict.blocks.map((b: { code: string }) => b.code)).toContain("blocked-invalid-catalog-id");
  });

  it("a missing required binding blocks with blocked-missing-binding", () => {
    const scene = freshScene();
    firstAssetObj(scene)["Semantic.fabBinding"] = "";
    const verdict = checkScene(scene, catalog, pack);
    expect(verdict.result).toBe("blocked");
    expect(verdict.blocks.map((b: { code: string }) => b.code)).toContain("blocked-missing-binding");
  });

  it("a missing semantic id blocks with blocked-missing-semantic-id", () => {
    const scene = freshScene();
    firstAssetObj(scene)["Semantic.fabSemanticId"] = "";
    const verdict = checkScene(scene, catalog, pack);
    expect(verdict.result).toBe("blocked");
    expect(verdict.blocks.map((b: { code: string }) => b.code)).toContain("blocked-missing-semantic-id");
  });

  it("a duplicate (semanticId, variant) pair blocks", () => {
    const scene = freshScene();
    const [a, b] = scene.displayList as Record<string, unknown>[];
    b["Semantic.fabSemanticId"] = a["Semantic.fabSemanticId"];
    b["Semantic.fabVariant"] = a["Semantic.fabVariant"] ?? "";
    const verdict = checkScene(scene, catalog, pack);
    expect(verdict.result).toBe("blocked");
    expect(verdict.blocks.map((b2: { code: string }) => b2.code)).toContain("blocked-duplicate-semantic-id");
  });

  it("a texture key missing from the asset pack blocks", () => {
    const scene = freshScene();
    firstAssetObj(scene)["texture"] = { key: "ghost_texture" };
    const verdict = checkScene(scene, catalog, pack);
    expect(verdict.result).toBe("blocked");
    expect(verdict.blocks.map((b: { code: string }) => b.code)).toContain("blocked-unknown-texture");
  });

  it("a blocked publication writes nothing (prior outputs untouched)", () => {
    const before = manifestHash(projectManifest());
    const scene = freshScene();
    firstAssetObj(scene)["Semantic.fabBinding"] = "asset:cat.badge.nonexistent";
    const verdict = checkScene(scene, catalog, pack);
    expect(verdict.result).toBe("blocked");
    expect(manifestHash(projectManifest())).toBe(before);
  });
});
