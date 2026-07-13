import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { hashCanonicalJson } from "@fabrikav2/kernel";

import { loadBrowserProject, saveBrowserProject } from "../../src/editor/app.ts";
import { editorAssetCatalog } from "../../src/editor/seed.ts";
import { createStarterProject } from "../../src/shared/project.ts";
import { readSeedManifest } from "../../src/shared/seed.ts";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const repositoryRoot = path.resolve(workspaceRoot, "../..");
const seedRoot = path.join(repositoryRoot, "games/shell_proof_grapes/design");

describe("editor browser persistence", () => {
  it("distinguishes a fresh starter from a saved browser draft and reloads the exact target", () => {
    const fresh = loadBrowserProject(() => null);
    expect(fresh).toMatchObject({ status: "unsaved", feedbackTone: "neutral" });

    let serialized = "";
    expect(saveBrowserProject(createStarterProject("shell_proof_grapes"), (value) => { serialized = value; })).toBe(true);
    const reloaded = loadBrowserProject(() => serialized);

    expect(reloaded.status).toBe("saved-unpublished");
    expect(reloaded.project.targetGame).toBe("shell_proof_grapes");
    expect(reloaded.project.presentation.pages).toHaveLength(7);
  });

  it("fails visibly to an unsaved starter for corrupt, invalid, or unavailable storage", () => {
    const corrupt = loadBrowserProject(() => "{not-json");
    const wrongTarget = loadBrowserProject(() => JSON.stringify(createStarterProject("another_game")));
    const unavailable = loadBrowserProject(() => { throw new Error("blocked"); });

    for (const result of [corrupt, wrongTarget, unavailable]) {
      expect(result.status).toBe("unsaved");
      expect(result.feedbackTone).toBe("error");
      expect(result.project.targetGame).toBe("shell_proof_grapes");
    }
  });

  it("reports a failed storage write without claiming the draft was saved", () => {
    expect(saveBrowserProject(createStarterProject(), () => { throw new Error("quota"); })).toBe(false);
  });

  it("stamps saved drafts with an explicit revision so the migration boundary is real", () => {
    let serialized = "";
    saveBrowserProject(createStarterProject("shell_proof_grapes"), (value) => { serialized = value; });
    const stored = JSON.parse(serialized) as { draftRevision?: unknown; project?: { format?: string } };

    expect(typeof stored.draftRevision).toBe("string");
    expect(stored.project?.format).toBe("grapes-shell-project-v2");
    // The saved shape is a wrapper, not a bare project — a bare project has no
    // draftRevision, which is exactly what the load path treats as orphaned.
    expect((stored as { format?: string }).format).toBeUndefined();
  });

  it("orphans a legacy bare-project draft that predates the revision boundary", () => {
    // Pre-repair drafts were persisted as the bare GrapesShellProject, with no
    // revision stamp. They must not reload as "saved" and bypass the current seed.
    const legacy = loadBrowserProject(() => JSON.stringify(createStarterProject("shell_proof_grapes")));

    expect(legacy.status).toBe("unsaved");
    expect(legacy.feedbackTone).toBe("error");
    expect(legacy.feedback).toMatch(/earlier editor revision/i);
    expect(legacy.project.targetGame).toBe("shell_proof_grapes");
  });

  it("orphans a stored draft stamped with a superseded editor revision", () => {
    const stale = loadBrowserProject(() =>
      JSON.stringify({ draftRevision: "u3-pre-repair-0000", project: createStarterProject("shell_proof_grapes") }),
    );

    expect(stale.status).toBe("unsaved");
    expect(stale.feedbackTone).toBe("error");
    expect(stale.feedback).toMatch(/superseded editor revision/i);
    expect(stale.feedback).toContain("u3-pre-repair-0000");
    expect(stale.project.targetGame).toBe("shell_proof_grapes");
  });

  it("hashes the bundled editor asset catalog identically to the seed catalog the publisher enforces", async () => {
    // The A1 snapshot/verdict binds hashCanonicalJson(editorAssetCatalog); publish
    // enforces hashCanonicalJson(readSeedManifest(...)). If these diverged, every
    // accepted A1 verdict would fail closed at publish.
    const [browserHash, seedHash] = await Promise.all([
      hashCanonicalJson(editorAssetCatalog),
      hashCanonicalJson(await readSeedManifest(seedRoot)),
    ]);
    expect(browserHash).toMatch(/^sha256-[a-f0-9]{64}$/u);
    expect(browserHash).toBe(seedHash);
  });
});
