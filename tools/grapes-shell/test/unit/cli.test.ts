import { access, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../../src/shared/cli.ts";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const repositoryRoot = path.resolve(workspaceRoot, "../..");
const seedRoot = path.join(repositoryRoot, "games/_template/design");
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("grapes-shell CLI", () => {
  it("uses one structured response per one-shot command and never exposes apply before U4", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "grapes-shell-cli-"));
    temporaryRoots.push(root);
    const output: string[] = [];
    const emit = (line: string) => output.push(line);
    const common = ["--game", "shell_proof", "--root", root, "--seed-root", seedRoot];

    await expect(runCli(["init", ...common], { emit })).resolves.toBe(0);
    expect(JSON.parse(output.pop()!)).toMatchObject({ ok: true, operation: "init", pages: 6 });

    await expect(runCli(["status", ...common], { emit })).resolves.toBe(0);
    expect(JSON.parse(output.pop()!)).toMatchObject({
      ok: true,
      operation: "status",
      status: { state: "saved-unpublished", canApply: false },
    });

    await expect(runCli(["validate", ...common], { emit })).resolves.toBe(0);
    expect(JSON.parse(output.pop()!)).toMatchObject({
      ok: true,
      operation: "validate",
      projectHash: expect.stringMatching(/^sha256-[a-f0-9]{64}$/u),
    });

    await expect(runCli(["publish", ...common], { emit })).resolves.toBe(1);
    expect(JSON.parse(output.pop()!)).toMatchObject({ ok: false, error: expect.stringMatching(/expected-project-hash/i) });

    await expect(
      runCli(["publish", ...common, "--expected-project-hash", `sha256-${"0".repeat(64)}`], { emit }),
    ).resolves.toBe(1);
    expect(JSON.parse(output.pop()!)).toMatchObject({ ok: false, error: expect.stringMatching(/reviewed hash/i) });
    await expect(
      access(path.join(root, "games/shell_proof/authoring/grapesjs/publications")),
    ).rejects.toMatchObject({ code: "ENOENT" });

    await expect(runCli(["apply", ...common], { emit })).resolves.toBe(1);
    expect(JSON.parse(output.pop()!)).toMatchObject({ ok: false, error: expect.stringMatching(/unsupported/i) });
  });
});
