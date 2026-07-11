import { describe, expect, it } from "vitest";

import { loadBrowserProject, saveBrowserProject } from "../../src/editor/app.ts";
import { createStarterProject } from "../../src/shared/project.ts";

describe("editor browser persistence", () => {
  it("distinguishes a fresh starter from a saved browser draft and reloads the exact target", () => {
    const fresh = loadBrowserProject(() => null);
    expect(fresh).toMatchObject({ status: "unsaved", feedbackTone: "neutral" });

    let serialized = "";
    expect(saveBrowserProject(createStarterProject("shell_proof"), (value) => { serialized = value; })).toBe(true);
    const reloaded = loadBrowserProject(() => serialized);

    expect(reloaded.status).toBe("saved-unpublished");
    expect(reloaded.project.targetGame).toBe("shell_proof");
    expect(reloaded.project.presentation.pages).toHaveLength(6);
  });

  it("fails visibly to an unsaved starter for corrupt, invalid, or unavailable storage", () => {
    const corrupt = loadBrowserProject(() => "{not-json");
    const wrongTarget = loadBrowserProject(() => JSON.stringify(createStarterProject("another_game")));
    const unavailable = loadBrowserProject(() => { throw new Error("blocked"); });

    for (const result of [corrupt, wrongTarget, unavailable]) {
      expect(result.status).toBe("unsaved");
      expect(result.feedbackTone).toBe("error");
      expect(result.project.targetGame).toBe("shell_proof");
    }
  });

  it("reports a failed storage write without claiming the draft was saved", () => {
    expect(saveBrowserProject(createStarterProject(), () => { throw new Error("quota"); })).toBe(false);
  });
});
