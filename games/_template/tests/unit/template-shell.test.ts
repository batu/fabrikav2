import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTemplateShellController } from "../../src/core/TemplateShellController.ts";
import { createTemplateHarness } from "../../src/shell/harness.ts";
import { mountTemplateShell } from "../../src/shell/TemplateShell.ts";

function createController() {
  return createTemplateShellController({
    storageKey: "fabrikav2.template-shell.test",
    now: () => 123,
  });
}

beforeEach(() => {
  const entries = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, value),
    clear: () => entries.clear(),
  });
  document.body.innerHTML = '<div id="app"></div>';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("template shell progression flow", () => {
  it("starts only the current node, advances exactly once on win, and carries advanced progress through Next and Home", () => {
    const controller = createController();

    expect(controller.snapshot()).toMatchObject({
      surface: "menu",
      currentLevel: 2,
      completedLevels: [1],
    });
    expect(controller.selectNode(3)).toBe(false);
    expect(controller.snapshot().surface).toBe("menu");

    expect(controller.startCurrent()).toBe(true);
    expect(controller.snapshot()).toMatchObject({ surface: "level", scene: "playing", currentLevel: 2 });

    expect(controller.win()).toBe(true);
    expect(controller.win()).toBe(false);
    expect(controller.snapshot()).toMatchObject({
      surface: "win",
      scene: "complete",
      currentLevel: 3,
      completedLevels: [1, 2],
    });

    expect(controller.next()).toBe(true);
    expect(controller.snapshot()).toMatchObject({ surface: "level", scene: "playing", currentLevel: 3 });

    expect(controller.home()).toBe(true);
    expect(controller.snapshot()).toMatchObject({
      surface: "menu",
      scene: "menu",
      currentLevel: 3,
      completedLevels: [1, 2],
    });
    expect(controller.trace().map((event) => event.name)).toContain("level_complete");
  });

  it("keeps the same level and progress through Lose, Retry, and Home", () => {
    const controller = createController();

    controller.startCurrent();
    expect(controller.lose()).toBe(true);
    expect(controller.snapshot()).toMatchObject({
      surface: "fail",
      scene: "failed",
      currentLevel: 2,
      completedLevels: [1],
    });

    expect(controller.retry()).toBe(true);
    expect(controller.snapshot()).toMatchObject({ surface: "level", scene: "playing", currentLevel: 2 });
    expect(controller.home()).toBe(true);
    expect(controller.snapshot()).toMatchObject({ surface: "menu", currentLevel: 2, completedLevels: [1] });
    expect(controller.trace().map((event) => event.name)).toContain("level_fail");
  });
});

describe("template shell settings and persistence", () => {
  it("returns Back to its Home or Pause origin and emits deterministic setting traces", () => {
    const controller = createController();

    controller.openSettings();
    expect(controller.snapshot()).toMatchObject({ surface: "settings", settingsOrigin: "menu" });
    controller.setSetting("music", false);
    controller.setSetting("sfx", false);
    controller.setSetting("haptics", false);
    expect(controller.snapshot().settings).toEqual({ music: false, sfx: false, haptics: false });
    expect(controller.backFromSettings()).toBe(true);
    expect(controller.snapshot().surface).toBe("menu");

    controller.startCurrent();
    controller.pause();
    controller.openSettings();
    expect(controller.snapshot()).toMatchObject({ surface: "settings", settingsOrigin: "pause", scene: "paused" });
    expect(controller.backFromSettings()).toBe(true);
    expect(controller.snapshot()).toMatchObject({ surface: "pause", scene: "paused" });
    expect(controller.resume()).toBe(true);
    expect(controller.snapshot()).toMatchObject({ surface: "level", scene: "playing" });

    expect(controller.trace().filter((event) => event.name === "template_setting_changed")).toHaveLength(3);
  });

  it("persists only synthetic progression and settings state", () => {
    const controller = createController();
    controller.setSetting("music", false);
    controller.startCurrent();
    controller.win();
    controller.home();

    const restored = createController();
    expect(restored.snapshot()).toMatchObject({
      surface: "menu",
      currentLevel: 3,
      completedLevels: [1, 2],
      settings: { music: false, sfx: true, haptics: true },
    });
    expect(restored.trace()).toEqual([]);
  });
});

describe("template shell renderer and harness", () => {
  it("uses the state owner for rendered semantic actions and keeps locked nodes inert", () => {
    const controller = createController();
    const root = document.getElementById("app")!;
    const shell = mountTemplateShell({ mountInto: root, controller });

    const locked = shell.root.querySelector<HTMLButtonElement>('[data-fab-action="locked"]');
    expect(locked).not.toBeNull();
    locked!.click();
    expect(controller.snapshot().surface).toBe("menu");

    const play = shell.root.querySelector<HTMLButtonElement>('[data-fab-action="play"]');
    expect(play).not.toBeNull();
    expect(play!.dataset.fabInstance).toBe("menu.node.current");
    expect(
      Array.from(shell.root.querySelectorAll("[data-fab-node-state]")).map((node) => node.getAttribute("data-fab-node-state")),
    ).toEqual(["completed", "current", "locked"]);
    play!.click();
    expect(controller.snapshot()).toMatchObject({ surface: "level", scene: "playing" });

    expect(shell.root.querySelector('[data-fab-action="pause"]')).not.toBeNull();
    expect(shell.root.querySelector('[data-fab-action="test-win"]')).not.toBeNull();
    expect(shell.root.querySelector('[data-fab-action="test-lose"]')).not.toBeNull();
    expect(shell.root.querySelector('[data-fab-role="gameplay-region"]')).not.toBeNull();
    expect(shell.root.textContent).not.toContain("Shop");
    expect(shell.root.textContent).not.toContain("Ad");
  });

  it("renders every canonical state and lets the deterministic tour drive the same controller", async () => {
    const controller = createController();
    const root = document.getElementById("app")!;
    const shell = mountTemplateShell({ mountInto: root, controller });
    const harness = createTemplateHarness({
      buildVersion: "test",
      packageId: "com.fabrikav2.template",
      controller,
    });

    for (const [state, actions] of [
      ["menu", ["play", "settings"]],
      ["level", ["pause", "test-win", "test-lose"]],
      ["settings", ["settings-music", "settings-sfx", "settings-haptics", "back"]],
      ["pause", ["pause-resume", "pause-settings", "pause-quit"]],
      ["win", ["result-next", "result-menu"]],
      ["fail", ["result-retry", "result-menu"]],
    ] as const) {
      expect(await harness.driveTo!(state)).toBe(true);
      shell.render();
      expect(shell.root.dataset.fabState).toBe(state);
      for (const action of actions) {
        const element = shell.root.querySelector<HTMLElement>(`[data-fab-action="${action}"]`);
        expect(element).not.toBeNull();
        expect(element!.getAttribute("aria-label") ?? element!.textContent).not.toBe("");
      }
    }

    expect(harness.snapshot()).toMatchObject({ scene: "failed", status: "lost" });

    await harness.driveTo!("settings");
    shell.render();
    const music = shell.root.querySelector<HTMLInputElement>('[data-fab-action="settings-music"]');
    expect(music?.checked).toBe(true);
    music!.click();
    expect(controller.snapshot().settings.music).toBe(false);
    expect(harness.drainEvents!().map((event) => event.name)).toContain("level_start");
  });
});
