import { access, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../../src/shared/cli.ts";
import type { PreviewRenderer } from "../../src/publication/publisher.ts";

const previewRenderer: PreviewRenderer = async ({ states }) => ({
  fingerprint: {
    renderer: "cli-test-renderer",
    fonts: "pinned-test-font-v1",
    deviceScaleFactor: 1,
    animations: "disabled",
    loadBarrier: "test-barrier",
    encoder: "test-png",
  },
  pages: states.map((state) => ({ stateId: state, bytes: new TextEncoder().encode(`cli:${state}`) })),
});

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const repositoryRoot = path.resolve(workspaceRoot, "../..");
const seedRoot = path.join(repositoryRoot, "games/shell_proof_grapes/design");
const temporaryRoots: string[] = [];

async function snapshotTree(root: string): Promise<ReadonlyArray<readonly [string, string, number]>> {
  const snapshot: Array<readonly [string, string, number]> = [];
  async function walk(directory: string, prefix = ""): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(target, relative);
      else if (entry.isFile()) snapshot.push([relative, await readFile(target, "utf8"), (await stat(target)).mtimeMs]);
    }
  }
  await walk(root);
  return snapshot.sort(([left], [right]) => left.localeCompare(right));
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("grapes-shell CLI", () => {
  it("publishes, preflights, applies, and no-ops one explicit immutable revision", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "grapes-shell-cli-"));
    temporaryRoots.push(root);
    const output: string[] = [];
    const emit = (line: string) => output.push(line);
    const common = ["--game", "shell_proof_grapes", "--root", root, "--seed-root", seedRoot];

    await expect(runCli(["init", ...common], { emit })).resolves.toBe(0);
    expect(JSON.parse(output.pop()!)).toMatchObject({ ok: true, operation: "init", pages: 7 });

    await expect(runCli(["status", ...common], { emit })).resolves.toBe(0);
    expect(JSON.parse(output.pop()!)).toMatchObject({
      ok: true,
      operation: "status",
      status: { state: "saved-unpublished", canApply: false },
    });

    await expect(runCli(["validate", ...common], { emit })).resolves.toBe(0);
    const validated = JSON.parse(output.pop()!) as { projectHash: string; assetCatalogHash: string };
    expect(validated).toMatchObject({
      ok: true,
      operation: "validate",
      projectHash: expect.stringMatching(/^sha256-[a-f0-9]{64}$/u),
      assetCatalogHash: expect.stringMatching(/^sha256-[a-f0-9]{64}$/u),
    });

    const zeroHash = `sha256-${"0".repeat(64)}`;
    const publications = path.join(root, "games/shell_proof_grapes/authoring/grapesjs/publications");

    // publish demands BOTH reviewed hashes before it will touch the filesystem.
    await expect(runCli(["publish", ...common], { emit })).resolves.toBe(1);
    expect(JSON.parse(output.pop()!)).toMatchObject({ ok: false, error: expect.stringMatching(/expected-project-hash/i) });

    await expect(
      runCli(["publish", ...common, "--expected-project-hash", validated.projectHash], { emit }),
    ).resolves.toBe(1);
    expect(JSON.parse(output.pop()!)).toMatchObject({ ok: false, error: expect.stringMatching(/expected-asset-catalog-hash/i) });

    // A divergent reviewed asset-catalog hash fails closed even when the project hash matches.
    await expect(
      runCli(
        ["publish", ...common, "--expected-project-hash", validated.projectHash, "--expected-asset-catalog-hash", zeroHash],
        { emit, renderPreviews: previewRenderer },
      ),
    ).resolves.toBe(1);
    expect(JSON.parse(output.pop()!)).toMatchObject({ ok: false, error: expect.stringMatching(/asset catalog hash/i) });
    await expect(access(publications)).rejects.toMatchObject({ code: "ENOENT" });

    // A divergent project hash also fails closed before any write.
    await expect(
      runCli(
        ["publish", ...common, "--expected-project-hash", zeroHash, "--expected-asset-catalog-hash", validated.assetCatalogHash],
        { emit, renderPreviews: previewRenderer },
      ),
    ).resolves.toBe(1);
    expect(JSON.parse(output.pop()!)).toMatchObject({ ok: false, error: expect.stringMatching(/reviewed hash/i) });
    await expect(access(publications)).rejects.toMatchObject({ code: "ENOENT" });

    // Both reviewed hashes matching publishes the immutable content-addressed record.
    await expect(
      runCli(
        [
          "publish",
          ...common,
          "--expected-project-hash",
          validated.projectHash,
          "--expected-asset-catalog-hash",
          validated.assetCatalogHash,
        ],
        { emit, renderPreviews: previewRenderer },
      ),
    ).resolves.toBe(0);
    const published = JSON.parse(output.pop()!) as { publicationId: string };
    expect(published).toMatchObject({
      ok: true,
      operation: "publish",
      publicationId: expect.stringMatching(/^sha256-[a-f0-9]{64}$/u),
    });

    await expect(runCli(["preflight", ...common, "--publication-id", published.publicationId], { emit })).resolves.toBe(0);
    expect(JSON.parse(output.pop()!)).toMatchObject({
      ok: true,
      operation: "preflight",
      outcome: "applied",
      publicationId: published.publicationId,
      projectionId: expect.stringMatching(/^sha256-[a-f0-9]{64}$/u),
    });

    await expect(runCli(["apply", ...common], { emit })).resolves.toBe(1);
    expect(JSON.parse(output.pop()!)).toMatchObject({ ok: false, error: expect.stringMatching(/publication-id/i) });

    await expect(runCli(["apply", ...common, "--publication-id", published.publicationId], { emit })).resolves.toBe(0);
    const firstApply = JSON.parse(output.pop()!) as { projectionId: string };
    expect(firstApply).toMatchObject({
      ok: true,
      operation: "apply",
      outcome: "applied",
      publicationId: published.publicationId,
      projectionId: expect.stringMatching(/^sha256-[a-f0-9]{64}$/u),
    });

    const selectedRoot = path.join(root, "games/shell_proof_grapes/design");
    const beforeNoOp = await snapshotTree(selectedRoot);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await expect(runCli(["apply", ...common, "--publication-id", published.publicationId], { emit })).resolves.toBe(0);
    expect(JSON.parse(output.pop()!)).toMatchObject({
      ok: true,
      operation: "apply",
      outcome: "no-op",
      projectionId: firstApply.projectionId,
    });
    expect(await snapshotTree(selectedRoot)).toEqual(beforeNoOp);

    const pointer = JSON.parse(
      await readFile(path.join(root, "games/shell_proof_grapes/design/revision.json"), "utf8"),
    ) as { projectionId: string };
    expect(pointer.projectionId).toBe(firstApply.projectionId);

    await expect(runCli(["preflight", ...common, "--publication-id", zeroHash], { emit })).resolves.toBe(1);
    expect(JSON.parse(output.pop()!)).toMatchObject({ ok: false, outcome: "invalid-revision" });

    const copyPath = path.join(selectedRoot, "revisions", firstApply.projectionId, "copy.ts");
    await writeFile(copyPath, "// tampered\n", "utf8");
    const pointerBeforeBlockedApply = await readFile(path.join(selectedRoot, "revision.json"), "utf8");

    await expect(runCli(["status", ...common], { emit })).resolves.toBe(0);
    expect(JSON.parse(output.pop()!)).toMatchObject({
      ok: true,
      operation: "status",
      status: { application: { state: "drifted" }, canApply: false },
    });

    await expect(runCli(["apply", ...common, "--publication-id", published.publicationId], { emit })).resolves.toBe(1);
    expect(JSON.parse(output.pop()!)).toMatchObject({ ok: false, outcome: "blocked-drift" });
    expect(await readFile(path.join(selectedRoot, "revision.json"), "utf8")).toBe(pointerBeforeBlockedApply);
  });
});
