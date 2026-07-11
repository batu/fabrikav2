import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { maybeRunInsituTour } from "@fabrikav2/testkit/testing";
import { createTemplateShellController } from "../../src/core/TemplateShellController.ts";
import { createTemplateHarness } from "../../src/shell/harness.ts";
import { mountTemplateShell } from "../../src/shell/TemplateShell.ts";

function createController() {
  return createTemplateShellController({
    storageKey: "fabrikav2.template-shell.test",
    now: () => 123,
  });
}

function templateShellCss(): string {
  return readFileSync(resolve(process.cwd(), "src/shell/template-shell.css"), "utf8");
}

function templateTokensCss(): string {
  return readFileSync(resolve(process.cwd(), "design/tokens.css"), "utf8");
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

interface ContractInstance {
  readonly id: string;
  readonly stateId: string;
  readonly required: boolean;
  readonly accessibility: {
    readonly role: string;
  };
}

function contractInstances(): readonly ContractInstance[] {
  const contract = JSON.parse(
    readFileSync(resolve(process.cwd(), "../../packages/kernel/contracts/shell-presentation.v1.json"), "utf8"),
  ) as { readonly instances: readonly ContractInstance[] };
  return contract.instances;
}

function effectiveRole(element: HTMLElement): string | null {
  const explicitRole = element.getAttribute("role");
  if (explicitRole) return explicitRole;
  if (element instanceof HTMLButtonElement) return "button";
  if (/^H[1-6]$/.test(element.tagName)) return "heading";
  if (element instanceof HTMLImageElement && element.getAttribute("aria-hidden") !== "true") return "img";
  return null;
}

function accessibleName(element: HTMLElement): string {
  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy) {
    return labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
      .filter(Boolean)
      .join(" ");
  }
  return element.getAttribute("aria-label")?.trim() || (element instanceof HTMLImageElement ? element.alt.trim() : "") || element.textContent?.trim() || "";
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

  it("keeps final Next tappable and returns to a completed map without replaying rewards", () => {
    const controller = createController();
    const root = document.getElementById("app")!;
    const shell = mountTemplateShell({ mountInto: root, controller });

    controller.seedSave({ unlockedLevel: 3 });
    expect(controller.startCurrent()).toBe(true);
    expect(controller.win()).toBe(true);
    expect(controller.snapshot()).toMatchObject({
      surface: "win",
      currentLevel: 3,
      completedLevels: [1, 2, 3],
    });
    shell.render();
    expect(shell.root.querySelector<HTMLButtonElement>('[data-fab-action="result-next"]')?.disabled).toBe(false);
    expect(shell.root.querySelector(".fab-modal-ribbon-eyebrow")?.textContent).toBe("Trail 3");
    expect(
      shell.root.querySelector(".template-shell__level--result-backdrop .template-shell__level-label")?.textContent,
    ).toBe("Trail 3");

    expect(controller.next()).toBe(true);
    shell.render();
    expect(controller.snapshot()).toMatchObject({ surface: "menu", currentLevel: 3, currency: 30 });
    expect(
      Array.from(shell.root.querySelectorAll<HTMLElement>("[data-fab-node-state]"), (node) => node.dataset.fabNodeState),
    ).toEqual(["completed", "completed", "completed"]);
    expect(
      Array.from(shell.root.querySelectorAll<HTMLButtonElement>("[data-fab-node-state]"), (node) => node.disabled),
    ).toEqual([true, true, true]);
    expect(controller.startCurrent()).toBe(true);
    expect(controller.snapshot()).toMatchObject({
      surface: "level",
      activeLevel: 3,
      currentLevel: 3,
      completedLevels: [1, 2, 3],
    });
    expect(controller.win()).toBe(true);
    expect(controller.snapshot()).toMatchObject({ surface: "win", currentLevel: 3, completedLevels: [1, 2, 3], currency: 30 });
    expect(controller.trace().filter((event) => event.name === "resource_change")).toHaveLength(1);
  });

  it("starts the exact requested harness level and reports every configured saga node", () => {
    const controller = createController();
    const harness = createTemplateHarness({
      buildVersion: "test",
      packageId: "com.fabrikav2.template",
      controller,
    });

    harness.startLevel(1);
    expect(controller.snapshot()).toMatchObject({ surface: "level", currentLevel: 1, completedLevels: [] });
    expect(harness.sagaNodes()).toEqual([1, 2, 3]);
  });
});

describe("template shell settings and persistence", () => {
  it("returns Back to its Home or Pause origin and emits deterministic setting traces", () => {
    const controller = createController();

    expect(controller.sdk.mixer.isMuted("music")).toBe(false);
    expect(controller.sdk.mixer.isMuted("sfx")).toBe(false);
    controller.openSettings();
    expect(controller.snapshot()).toMatchObject({ surface: "settings", settingsOrigin: "menu" });
    controller.setSetting("music", false);
    controller.setSetting("sfx", false);
    controller.setSetting("haptics", false);
    expect(controller.snapshot().settings).toEqual({ music: false, sfx: false, haptics: false });
    expect(controller.sdk.mixer.isMuted("music")).toBe(true);
    expect(controller.sdk.mixer.isMuted("sfx")).toBe(true);
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

    expect(controller.trace().filter((event) => event.name === "template_setting_changed")).toEqual([
      {
        name: "template_setting_changed",
        params: { setting: "music", enabled: false },
        timestamp: 123,
        sessionId: "template-shell",
        env: "test",
      },
      {
        name: "template_setting_changed",
        params: { setting: "sfx", enabled: false },
        timestamp: 123,
        sessionId: "template-shell",
        env: "test",
      },
      {
        name: "template_setting_changed",
        params: { setting: "haptics", enabled: false },
        timestamp: 123,
        sessionId: "template-shell",
        env: "test",
      },
    ]);
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
    expect(restored.sdk.mixer.isMuted("music")).toBe(true);
    expect(restored.sdk.mixer.isMuted("sfx")).toBe(false);
    expect(restored.trace()).toEqual([]);
  });

  it("synchronizes seeded and reset audio preferences without synthetic setting traces", () => {
    const controller = createController();

    controller.seedSave({ music: false, sfx: false, haptics: false });
    expect(controller.sdk.mixer.isMuted("music")).toBe(true);
    expect(controller.sdk.mixer.isMuted("sfx")).toBe(true);
    expect(controller.trace()).toEqual([]);

    controller.resetSave();
    expect(controller.sdk.mixer.isMuted("music")).toBe(false);
    expect(controller.sdk.mixer.isMuted("sfx")).toBe(false);
    expect(controller.trace()).toEqual([]);
  });

  it("uses distinct success and error notification haptics for terminal outcomes", () => {
    const vibrate = vi.fn();
    vi.stubGlobal("navigator", { vibrate });
    const controller = createController();

    controller.startCurrent();
    controller.lose();
    expect(vibrate).toHaveBeenLastCalledWith([36, 35, 36]);

    controller.home();
    controller.startCurrent();
    controller.win();
    expect(vibrate).toHaveBeenLastCalledWith([12, 40, 24]);
  });
});

describe("template shell renderer and harness", () => {
  it("declares a margin-free viewport host and visible shared control surfaces", () => {
    const css = templateShellCss();

    expect(css).toMatch(/body\s*\{[^}]*margin:\s*0;/s);
    expect(css).toMatch(/\.template-shell \.fab-ui\s*\{[^}]*--fab-color-accent:\s*var\(--fab-seed-color-accent\);/s);
    expect(css).toMatch(/\.template-shell__icon-action\s*\{[^}]*background-color:\s*var\(--fab-color-accent\);/s);
    expect(css).toMatch(
      /\.template-shell \.fab-pause-card \[data-fab-action="pause-resume"\],[\s\S]*?\.template-shell__overlay-action--primary\s*\{[^}]*background-color:\s*var\(--fab-color-accent\);/s,
    );
    expect(css).toMatch(/\.template-shell \.fab-modal-card\.fab-pause-card\s*\{[^}]*background-color:\s*var\(--fab-seed-color-pause-surface\);/s);
    expect(css).toMatch(/\.template-shell \.fab-page-back\s*\{[^}]*background-color:\s*var\(--fab-color-accent\);/s);
    expect(css).toMatch(/\.template-shell \.fab-result-body\s*\{[^}]*background-color:\s*var\(--fab-color-gameplay-surface\);/s);
    expect(css).toMatch(/\.template-shell \.fab-toggle-input\s*\{[^}]*width:\s*100%;[^}]*height:\s*100%;/s);
  });

  it("keeps Settings quiet and makes the seeded star explicitly read as currency", () => {
    const controller = createController();
    const root = document.getElementById("app")!;
    const shell = mountTemplateShell({ mountInto: root, controller });

    const settings = shell.root.querySelector<HTMLButtonElement>('[data-fab-action="settings"]');
    const currency = shell.root.querySelector<HTMLElement>('[data-fab-instance="menu.currency"]');
    const css = templateShellCss();

    expect(settings?.classList.contains("template-shell__icon-action--utility")).toBe(true);
    expect(settings?.getAttribute("aria-label")).toBe("Settings");
    expect(currency?.classList.contains("template-shell__currency--contrasted")).toBe(true);
    expect(currency?.getAttribute("aria-label")).toBe("25 Coins");
    expect(currency?.querySelector(".template-shell__currency-label")?.textContent).toBe("Coins");
    expect(currency?.textContent).toContain("25Coins");
    expect(css).toMatch(
      /\.template-shell__icon-action--utility\s*\{[^}]*width:\s*var\(--fab-btn-min-size\);[^}]*padding:\s*0;[^}]*font-size:\s*0;[^}]*background-color:\s*var\(--fab-seed-color-utility-surface\);[^}]*box-shadow:\s*none;/s,
    );
    expect(css).toMatch(
      /\.template-shell__currency--contrasted\s*\{[^}]*background-color:\s*var\(--fab-seed-color-currency-surface\);[^}]*color:\s*var\(--fab-seed-color-currency-on-surface\);/s,
    );
    expect(css).toMatch(
      /\.template-shell \.fab-page\s*\{[^}]*--fab-page-header-height:\s*calc\(var\(--fab-btn-min-size\) \+ var\(--fab-space-xs\)\);[^}]*--fab-page-body-gap:\s*var\(--fab-space-xs\);[^}]*--fab-page-padding:\s*var\(--fab-space-sm\);/s,
    );
  });

  it("loads the committed Kenney display pair and keeps body copy on a readable rounded stack", () => {
    const tokens = templateTokensCss();
    const fontRoot = resolve(process.cwd(), "design/fonts");

    expect(sha256(resolve(fontRoot, "kenney-future.ttf"))).toBe(
      "7a55b07f5968fac872648a7c5e959bd2b93e06f63153b585d56e4d5298ddff61",
    );
    expect(sha256(resolve(fontRoot, "kenney-future-narrow.ttf"))).toBe(
      "17e182587a3264dcf9e5b17c055715d5597187546ce81925c64e9184c26d597f",
    );
    expect(tokens).toMatch(/@font-face\s*\{[^}]*font-family:\s*"Kenney Future";[^}]*kenney-future\.ttf/s);
    expect(tokens).toMatch(
      /@font-face\s*\{[^}]*font-family:\s*"Kenney Future Narrow";[^}]*kenney-future-narrow\.ttf/s,
    );
    expect(tokens).toMatch(/--fab-seed-font-family:\s*ui-rounded, "SF Pro Rounded", system-ui, sans-serif;/);
    expect(tokens).toMatch(/--fab-seed-font-family-display:\s*"Kenney Future Narrow", "Kenney Future", sans-serif;/);
    expect(templateShellCss()).toMatch(
      /\.template-shell__title,[\s\S]*?\.template-shell \.fab-btn\s*\{[^}]*font-family:\s*var\(--fab-font-family-display\);/s,
    );
    expect(templateShellCss()).toMatch(
      /\.template-shell__gameplay-copy h2\s*\{[^}]*font-family:\s*var\(--fab-font-family\);[^}]*text-transform:\s*uppercase;/s,
    );
    expect(templateShellCss()).toMatch(
      /\.template-shell \[data-fab-action="result-next"\]\s*\{[^}]*font-family:\s*var\(--fab-font-family\);[^}]*text-transform:\s*uppercase;/s,
    );
  });

  it("keeps the paused level visibly present without duplicating its live controls", () => {
    const controller = createController();
    const root = document.getElementById("app")!;
    const shell = mountTemplateShell({ mountInto: root, controller, enableTestOutcomes: true });

    controller.startCurrent();
    shell.render();
    const liveLayoutClasses = [
      shell.root.querySelector(".template-shell__hud")?.className,
      shell.root.querySelector(".template-shell__icon-action--hud")?.className,
      shell.root.querySelector(".template-shell__gameplay")?.className,
      shell.root.querySelector(".template-shell__sample-outcomes")?.className,
      shell.root.querySelector(".template-shell__test-actions")?.className,
    ];
    controller.pause();
    shell.render();

    const backdrop = shell.root.querySelector<HTMLElement>(".template-shell__level--pause-backdrop");
    const css = templateShellCss();

    expect(backdrop).not.toBeNull();
    expect(backdrop?.dataset.templateBackdrop).toBe("pause-level");
    expect(backdrop?.getAttribute("aria-hidden")).toBe("true");
    expect(backdrop?.hasAttribute("inert")).toBe(true);
    expect(backdrop?.querySelectorAll("[data-fab-action]")).toHaveLength(0);
    expect(backdrop?.querySelectorAll("[data-fab-instance]")).toHaveLength(0);
    expect(backdrop?.querySelector(".template-shell__sample-outcomes")?.textContent).toContain("Test outcomes");
    expect(backdrop?.querySelector<HTMLElement>(".template-shell__sample-outcomes")?.hidden).toBe(true);
    expect(backdrop?.querySelectorAll(".template-shell__test-action")).toHaveLength(2);
    const visualPause = backdrop?.querySelector<HTMLButtonElement>(".template-shell__icon-action--hud");
    expect(visualPause).not.toBeNull();
    expect(visualPause?.tabIndex).toBe(-1);
    expect(visualPause?.querySelector<HTMLImageElement>(".template-shell__button-icon")?.src).toContain("icon-control-pause.png");
    expect([
      backdrop?.querySelector(".template-shell__hud")?.className,
      visualPause?.className,
      backdrop?.querySelector(".template-shell__gameplay")?.className,
      backdrop?.querySelector(".template-shell__sample-outcomes")?.className,
      backdrop?.querySelector(".template-shell__test-actions")?.className,
    ]).toEqual(liveLayoutClasses);
    expect(shell.root.querySelector('[data-fab-instance="pause.panel"]')).not.toBeNull();
    expect(css).toMatch(/\.template-shell__level--inert-backdrop\s*\{[^}]*pointer-events:\s*none;/s);
    expect(css).toMatch(
      /\.template-shell__level--inert-backdrop \.template-shell__sample-outcomes\s*\{[^}]*visibility:\s*hidden;/s,
    );
    expect(css).toContain('.template-shell[data-fab-state="pause"] .fab-modal-scrim,');
    expect(css).toMatch(
      /\.template-shell \.fab-modal-card\.fab-pause-card\s*\{[^}]*padding:\s*28px var\(--fab-space-md\) max\(var\(--fab-space-md\), env\(safe-area-inset-bottom\)\);/s,
    );
    expect(css).toMatch(
      /\.template-shell \.fab-modal-card\.fab-pause-card\s*\{[^}]*--fab-pause-action-gap:\s*var\(--fab-space-xs\);/s,
    );
    expect(css).toMatch(
      /\.template-shell \.fab-pause-card \[data-fab-action="pause-settings"\],[\s\S]*?\.template-shell__overlay-action--secondary\s*\{[^}]*background:\s*var\(--fab-seed-color-socket-surface\);[^}]*border:\s*var\(--fab-border-width\) solid var\(--fab-seed-color-socket-border\);[^}]*box-shadow:\s*none;/s,
    );
  });

  it("keeps test outcomes off the player surface unless diagnostics are explicitly enabled", () => {
    const controller = createController();
    const root = document.getElementById("app")!;
    const shell = mountTemplateShell({ mountInto: root, controller });

    controller.startCurrent();
    shell.render();

    expect(shell.root.querySelector(".template-shell__sample-outcomes")).toBeNull();
    expect(shell.root.querySelector('[data-fab-action="test-win"]')).toBeNull();
    expect(shell.root.querySelector('[data-fab-action="test-lose"]')).toBeNull();
  });

  it("keeps the required outcome controls visible in an explicit diagnostic panel", () => {
    const controller = createController();
    const root = document.getElementById("app")!;
    const shell = mountTemplateShell({ mountInto: root, controller, enableTestOutcomes: true });

    controller.startCurrent();
    shell.render();

    const sample = shell.root.querySelector<HTMLElement>(".template-shell__sample-outcomes");
    expect(sample).not.toBeNull();
    expect(sample?.dataset.templateDiagnostic).toBe("outcomes");
    expect(sample?.tagName).toBe("SECTION");
    expect(sample?.querySelector(".template-shell__sample-title")?.textContent).toBe("Test outcomes");
    expect(sample?.querySelector('[data-fab-action="test-win"]')?.textContent).toBe("Win");
    expect(sample?.querySelector('[data-fab-action="test-lose"]')?.textContent).toBe("Lose");
    expect(sample?.querySelector('[data-fab-action="test-win"]')?.classList.contains("template-shell__test-action--win")).toBe(true);
    expect(sample?.querySelector('[data-fab-action="test-lose"]')?.classList.contains("template-shell__test-action--lose")).toBe(true);
    const socket = shell.root.querySelector<HTMLElement>('[data-fab-role="gameplay-region"]');
    expect(socket?.dataset.templateSocket).toBe("replaceable-mechanic");
    expect(socket?.classList.contains("template-shell__gameplay--trail")).toBe(true);
    expect(socket?.querySelector(".template-shell__gameplay-kicker")?.textContent).toBe("Trail clearing");
    expect(socket?.querySelector(".template-shell__gameplay-landscape")).not.toBeNull();
    expect(socket?.querySelector(".template-shell__gameplay-emblem")).toBeNull();
    expect(socket?.querySelector("img, button, [data-fab-action]")).toBeNull();
    expect(shell.root.textContent).not.toContain("Gameplay goes here");
    expect(shell.root.textContent).not.toContain("Starter playfield");
    expect(shell.root.textContent).not.toContain("add a mechanic");
    expect(templateShellCss()).toMatch(
      /\.template-shell__gameplay--trail\s*\{[^}]*border-style:\s*solid;[^}]*background:/s,
    );
    expect(templateShellCss()).toMatch(
      /\.template-shell__gameplay--trail\s*\{[^}]*grid-template-rows:\s*minmax\(0, 1fr\) auto;/s,
    );
    expect(templateShellCss()).toMatch(
      /\.template-shell__gameplay-copy\s*\{[^}]*position:\s*absolute;[^}]*max-width:\s*228px;[^}]*background-color:\s*var\(--fab-seed-color-copy-surface\);/s,
    );
    expect(templateShellCss()).toMatch(
      /\.template-shell__sample-outcomes\s*\{[^}]*border:\s*1px solid var\(--fab-seed-color-secondary-border\);[^}]*background:\s*linear-gradient\(/s,
    );
  });

  it("keeps the full in-level Trail identity in an icon-only HUD lane", () => {
    const controller = createController();
    const root = document.getElementById("app")!;
    const shell = mountTemplateShell({ mountInto: root, controller });

    controller.startCurrent();
    shell.render();

    const label = shell.root.querySelector<HTMLElement>('[data-fab-instance="level.label"]');
    const pause = shell.root.querySelector<HTMLElement>('[data-fab-action="pause"]');
    const css = templateShellCss();

    expect(label?.textContent).toBe("Trail 2");
    expect(label?.classList.contains("template-shell__level-label--identity")).toBe(true);
    expect(pause?.classList.contains("template-shell__icon-action--hud")).toBe(true);
    expect(css).toMatch(
      /\.template-shell__level-label--identity\s*\{[^}]*white-space:\s*nowrap;[^}]*overflow:\s*visible;[^}]*text-overflow:\s*clip;/s,
    );
    expect(css).toMatch(
      /\.template-shell__icon-action--hud\s*\{[^}]*width:\s*var\(--fab-btn-min-size\);[^}]*font-size:\s*0;/s,
    );
    expect(css).not.toContain("template-shell__hud-action-spacer");
  });

  it("uses a non-actionable trail illustration and spatial progression landmarks", () => {
    const controller = createController();
    const root = document.getElementById("app")!;
    const shell = mountTemplateShell({ mountInto: root, controller });

    const hero = shell.root.querySelector<HTMLElement>('[data-fab-instance="menu.hero"]');
    const completed = shell.root.querySelector<HTMLElement>('[data-fab-instance="menu.node.completed"]');
    const locked = shell.root.querySelector<HTMLElement>('[data-fab-instance="menu.node.locked"]');
    const route = shell.root.querySelector<SVGElement>(".template-shell__route");
    const tokens = templateTokensCss();

    expect(hero?.classList.contains("template-shell__hero-stage")).toBe(true);
    expect(hero?.getAttribute("role")).toBe("img");
    expect(hero?.getAttribute("aria-label")).toBe("A winding trail through green hills");
    expect(hero?.dataset.fabSlot).toBe("hero-art");
    expect(hero?.querySelector("img")).toBeNull();
    expect(shell.root.querySelector(".template-shell__hero-marker")).not.toBeNull();
    expect(route?.getAttribute("aria-hidden")).toBe("true");
    expect(route?.querySelectorAll("path")).toHaveLength(2);
    expect(route?.querySelector(".template-shell__route-track")).not.toBeNull();
    expect(route?.querySelector(".template-shell__route-line")).not.toBeNull();
    expect(completed?.getAttribute("data-fab-node-state")).toBe("completed");
    expect(locked?.getAttribute("data-fab-node-state")).toBe("locked");
    expect(tokens).toMatch(/--fab-seed-levelmap-art-completed:\s*url\("\.\/assets\/icon-control-confirm\.png"\);/);
    expect(tokens).toMatch(/--fab-seed-levelmap-art-locked:\s*url\("\.\/assets\/progression-node-locked\.png"\);/);
    expect(tokens).toMatch(/--fab-seed-levelmap-node-current-size:\s*88px;/);
    expect(templateShellCss()).toMatch(/\.template-shell__hero-stage\s*\{[^}]*box-shadow:\s*none;/s);
    expect(templateShellCss()).toMatch(/\.template-shell \.fab-levelmap-node:nth-child\(2\)\s*\{[^}]*--node-x:\s*32px;/s);
    expect(templateShellCss()).toMatch(
      /\.template-shell \.fab-levelmap-node\.current \.fab-levelmap-node-dot\s*\{[^}]*box-shadow:\s*var\(--fab-seed-shadow-current-node\);/s,
    );
  });

  it("keeps progression state in the landmark art and accessible names instead of player-facing component badges", () => {
    const controller = createController();
    const root = document.getElementById("app")!;
    const shell = mountTemplateShell({ mountInto: root, controller });

    const nodes = Array.from(shell.root.querySelectorAll<HTMLElement>("[data-fab-node-state]"));

    expect(nodes).toHaveLength(3);
    expect(nodes.map((node) => node.querySelector(".template-shell__node-status"))).toEqual([null, null, null]);
    expect(nodes.map((node) => node.getAttribute("aria-label"))).toEqual([
      "Trail 1, Complete",
      "Trail 2, Current",
      "Trail 3, Locked",
    ]);
    expect(templateShellCss()).not.toContain("template-shell__node-status");
  });

  it("keeps failure over frozen gameplay with one retry signal and a restrained accent", () => {
    const controller = createController();
    const root = document.getElementById("app")!;
    const shell = mountTemplateShell({ mountInto: root, controller });

    controller.startCurrent();
    controller.lose();
    shell.render();

    const ribbon = shell.root.querySelector<HTMLElement>(".fab-modal-ribbon-title");
    const retry = shell.root.querySelector<HTMLElement>('[data-fab-action="result-retry"]');
    const home = shell.root.querySelector<HTMLElement>('[data-fab-action="result-menu"]');
    const backdrop = shell.root.querySelector<HTMLElement>(".template-shell__level--result-backdrop");
    const css = templateShellCss();

    expect(ribbon?.textContent).toBe("Trail blocked");
    expect(shell.root.querySelector(".template-shell__result-art")).toBeNull();
    expect(shell.root.querySelector(".template-shell__fail-barrier")?.getAttribute("aria-hidden")).toBe("true");
    expect(shell.root.querySelector(".fab-result-message")?.textContent).toBe("Choose a clearer step, then try again.");
    expect(backdrop?.dataset.templateBackdrop).toBe("result-level");
    expect(backdrop?.getAttribute("aria-hidden")).toBe("true");
    expect(backdrop?.querySelector(".template-shell__level-label")?.textContent).toBe("Trail 2");
    expect(backdrop?.querySelector(".template-shell__sample-outcomes")).toBeNull();
    expect(backdrop?.querySelectorAll("[data-fab-action]")).toHaveLength(0);
    expect(backdrop?.querySelectorAll("[data-fab-instance]")).toHaveLength(0);
    expect(retry?.classList.contains("template-shell__overlay-action--primary")).toBe(true);
    expect(home?.classList.contains("template-shell__overlay-action--tertiary")).toBe(true);
    expect(retry?.style.getPropertyValue("--fab-btn-sprite-image")).toBe("");
    expect(home?.style.getPropertyValue("--fab-btn-sprite-image")).toBe("");
    expect(css).toMatch(
      /\.template-shell\[data-fab-state="fail"\] \.fab-ui\s*\{[^}]*--fab-ribbon-title-color:\s*var\(--fab-seed-color-fail-ribbon-text\);/s,
    );
    expect(css).toMatch(
      /\.template-shell\[data-fab-state="fail"\] \.fab-result-body\s*\{[^}]*padding:\s*0;[^}]*border:\s*0;[^}]*background:\s*transparent;/s,
    );
    expect(css).toMatch(
      /\.template-shell \.fab-pause-card \[data-fab-action="pause-settings"\],[\s\S]*?\.template-shell__overlay-action--secondary\s*\{[^}]*background:\s*var\(--fab-seed-color-socket-surface\);[^}]*box-shadow:\s*none;/s,
    );
    expect(css).toMatch(
      /\.template-shell\[data-fab-state="fail"\] \.fab-modal-ribbon\s*\{[^}]*aspect-ratio:\s*auto;[^}]*border:\s*0;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/s,
    );
    expect(css).toMatch(
      /\.template-shell\[data-fab-state="fail"\] \.fab-modal-ribbon-image\s*\{[^}]*display:\s*none;/s,
    );
    expect(css).toMatch(
      /\.template-shell\[data-fab-state="fail"\] \.template-shell__result-art\s*\{[^}]*display:\s*none;/s,
    );
    expect(css).toMatch(
      /\.template-shell\[data-fab-state="fail"\] \.template-shell__fail-barrier::before\s*\{[^}]*var\(--fab-seed-color-trail-surface\)/s,
    );
    expect(css).toMatch(
      /\.template-shell\[data-fab-state="fail"\] \.template-shell__fail-barrier::after\s*\{[^}]*linear-gradient\(/s,
    );
    expect(css).toMatch(
      /\.template-shell\[data-fab-state="fail"\] \.fab-modal-backdrop\s*\{[^}]*align-items:\s*flex-end;[^}]*padding:\s*0;/s,
    );
    expect(css).toContain('.template-shell[data-fab-state="fail"] .fab-modal-scrim');
  });

  it("uses one enabled action grammar across Pause, Win, and Fail overlays", async () => {
    const controller = createController();
    const root = document.getElementById("app")!;
    const shell = mountTemplateShell({ mountInto: root, controller });
    const harness = createTemplateHarness({
      buildVersion: "test",
      packageId: "com.fabrikav2.template",
      controller,
      render: shell.render,
    });

    expect(await harness.driveTo!("pause")).toBe(true);
    shell.render();
    const pauseResume = shell.root.querySelector<HTMLButtonElement>('[data-fab-action="pause-resume"]')!;
    const pauseSettings = shell.root.querySelector<HTMLButtonElement>('[data-fab-action="pause-settings"]')!;
    const pauseHome = shell.root.querySelector<HTMLButtonElement>('[data-fab-action="pause-quit"]')!;
    expect([pauseResume.disabled, pauseSettings.disabled, pauseHome.disabled]).toEqual([false, false, false]);

    for (const state of ["win", "fail"] as const) {
      expect(await harness.driveTo!(state)).toBe(true);
      shell.render();
      const primary = shell.root.querySelector<HTMLButtonElement>(
        state === "win" ? '[data-fab-action="result-next"]' : '[data-fab-action="result-retry"]',
      )!;
      const home = shell.root.querySelector<HTMLButtonElement>('[data-fab-action="result-menu"]')!;
      expect(primary.classList.contains("template-shell__overlay-action--primary")).toBe(true);
      expect(home.classList.contains("template-shell__overlay-action--tertiary")).toBe(true);
      expect([primary.disabled, home.disabled]).toEqual([false, false]);
      expect(primary.style.getPropertyValue("--fab-btn-sprite-image")).toBe("");
      expect(home.style.getPropertyValue("--fab-btn-sprite-image")).toBe("");
    }

    const css = templateShellCss();
    expect(css).toContain(".template-shell__overlay-action--primary");
    expect(css).toContain(".template-shell__overlay-action--secondary");
    expect(css).toContain("template-shell__overlay-action--tertiary");
  });

  it("uses the state owner for rendered semantic actions and keeps locked nodes inert", () => {
    const controller = createController();
    const root = document.getElementById("app")!;
    const shell = mountTemplateShell({ mountInto: root, controller, enableTestOutcomes: true });

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
    expect(
      Array.from(shell.root.querySelectorAll("[data-fab-node-state]")).map((node) => node.getAttribute("aria-label")),
    ).toEqual(["Trail 1, Complete", "Trail 2, Current", "Trail 3, Locked"]);
    play!.click();
    expect(controller.snapshot()).toMatchObject({ surface: "level", scene: "playing" });

    expect(shell.root.querySelector('[data-fab-action="pause"]')).not.toBeNull();
    expect(shell.root.querySelector('[data-fab-action="test-win"]')).not.toBeNull();
    expect(shell.root.querySelector('[data-fab-action="test-lose"]')).not.toBeNull();
    expect(shell.root.querySelector('[data-fab-role="gameplay-region"]')).not.toBeNull();
    expect(shell.root.textContent).not.toContain("Shop");
    expect(shell.root.textContent).not.toContain("Ad");
  });

  it("maps each rendered semantic instance to the closed contract exactly once", async () => {
    const instances = contractInstances();
    const registeredIds = new Set(instances.map((instance) => instance.id));
    const instancesById = new Map(instances.map((instance) => [instance.id, instance]));

    for (const state of ["menu", "level", "settings", "pause", "win", "fail"] as const) {
      const controller = createController();
      const root = document.getElementById("app")!;
      const shell = mountTemplateShell({ mountInto: root, controller, enableTestOutcomes: true });
      const harness = createTemplateHarness({
        buildVersion: "test",
        packageId: "com.fabrikav2.template",
        controller,
      });

      expect(await harness.driveTo!(state)).toBe(true);
      shell.render();

      const renderedIds = Array.from(shell.root.querySelectorAll<HTMLElement>("[data-fab-instance]"), (element) =>
        element.dataset.fabInstance!,
      );
      const semanticOwners = Array.from(shell.root.querySelectorAll<HTMLElement>("[data-fab-instance]"));
      const counts = new Map<string, number>();
      for (const id of renderedIds) counts.set(id, (counts.get(id) ?? 0) + 1);

      expect(renderedIds.filter((id) => !registeredIds.has(id)), `${state}: unregistered instance IDs`).toEqual([]);
      expect(
        Array.from(counts).filter(([, count]) => count !== 1),
        `${state}: duplicate instance IDs`,
      ).toEqual([]);

      const missingRequired = instances
        .filter((instance) => instance.stateId === state && instance.required)
        .map((instance) => instance.id)
        .filter((id) => !counts.has(id));
      expect(missingRequired, `${state}: missing required instance IDs`).toEqual([]);

      for (const owner of semanticOwners) {
        const id = owner.dataset.fabInstance!;
        const contractInstance = instancesById.get(id)!;
        expect(owner.getAttribute("aria-hidden"), `${state}/${id}: semantic owner must be exposed`).not.toBe("true");
        expect(effectiveRole(owner), `${state}/${id}: semantic owner role`).toBe(contractInstance.accessibility.role);
        expect(accessibleName(owner), `${state}/${id}: semantic owner accessible name`).not.toBe("");
      }

      shell.dispose();
    }
  });

  it.each([1, 3])("keeps one completed, current, and locked semantic node at progression level %s", (level) => {
    const controller = createController();
    const root = document.getElementById("app")!;
    const shell = mountTemplateShell({ mountInto: root, controller });

    controller.seedSave({ unlockedLevel: level });
    shell.render();

    expect(
      Array.from(shell.root.querySelectorAll<HTMLElement>("[data-fab-node-state]"), (node) => node.dataset.fabInstance),
    ).toEqual(["menu.node.completed", "menu.node.current", "menu.node.locked"]);
  });

  it("renders every canonical state and lets the deterministic tour drive the same controller", async () => {
    const controller = createController();
    const root = document.getElementById("app")!;
    const shell = mountTemplateShell({ mountInto: root, controller, enableTestOutcomes: true });
    const harness = createTemplateHarness({
      buildVersion: "test",
      packageId: "com.fabrikav2.template",
      controller,
      render: shell.render,
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
      expect(shell.root.dataset.fabState).toBe(state);
      for (const action of actions) {
        const element = shell.root.querySelector<HTMLElement>(`[data-fab-action="${action}"]`);
        expect(element).not.toBeNull();
        expect(element!.getAttribute("aria-label") ?? element!.textContent).not.toBe("");
      }
    }

    expect(harness.snapshot()).toMatchObject({ scene: "failed", status: "lost" });

    await harness.driveTo!("settings");
    const music = shell.root.querySelector<HTMLInputElement>('[data-fab-action="settings-music"]');
    expect(music?.checked).toBe(true);
    music!.click();
    expect(controller.snapshot().settings.music).toBe(false);
    expect(harness.drainEvents!().map((event) => event.name)).toContain("level_start");
  });

  it("renders every settled all-states tour surface before its marker is published", async () => {
    const controller = createController();
    const root = document.getElementById("app")!;
    const shell = mountTemplateShell({ mountInto: root, controller, enableTestOutcomes: true });
    const harness = createTemplateHarness({
      buildVersion: "test",
      packageId: "com.fabrikav2.template",
      controller,
      render: shell.render,
    });
    const settledStates: Array<readonly [string, string | undefined]> = [];

    await maybeRunInsituTour(harness, {
      script: "allstates",
      sleep: async () => {
        settledStates.push([controller.snapshot().surface, shell.root.dataset.fabState]);
      },
    });

    expect(settledStates.every(([surface, rendered]) => surface === rendered)).toBe(true);
    expect([...new Set(settledStates.map(([surface]) => surface))]).toEqual([
      "menu",
      "level",
      "settings",
      "pause",
      "win",
      "fail",
    ]);
  });

  it("wires Pause, Settings, and diagnostic outcome clicks through the rendered shell", () => {
    const controller = createController();
    const root = document.getElementById("app")!;
    const shell = mountTemplateShell({ mountInto: root, controller, enableTestOutcomes: true });
    const click = (action: string): void => {
      const target = shell.root.querySelector<HTMLButtonElement>(`[data-fab-action="${action}"]`);
      expect(target, `missing ${action}`).not.toBeNull();
      target!.click();
    };
    const expectDiagnostics = (): void => {
      const diagnostics = shell.root.querySelector<HTMLElement>(".template-shell__sample-outcomes");
      expect(diagnostics).not.toBeNull();
      expect(diagnostics!.tagName).toBe("SECTION");
    };

    shell.root.querySelector<HTMLButtonElement>('[data-fab-instance="menu.node.current"]')!.click();
    expect(controller.snapshot().surface).toBe("level");
    click("pause");
    click("pause-settings");
    expect(controller.snapshot()).toMatchObject({ surface: "settings", settingsOrigin: "pause" });
    click("back");
    expect(controller.snapshot().surface).toBe("pause");
    click("pause-resume");
    expect(controller.snapshot().surface).toBe("level");

    expectDiagnostics();
    click("test-win");
    expect(controller.snapshot()).toMatchObject({ surface: "win", currentLevel: 3, completedLevels: [1, 2] });
    click("result-next");
    expect(controller.snapshot()).toMatchObject({ surface: "level", currentLevel: 3, completedLevels: [1, 2] });
    click("pause");
    click("pause-quit");
    expect(controller.snapshot()).toMatchObject({ surface: "menu", currentLevel: 3, completedLevels: [1, 2] });

    shell.root.querySelector<HTMLButtonElement>('[data-fab-instance="menu.node.current"]')!.click();
    expectDiagnostics();
    click("test-lose");
    expect(controller.snapshot().surface).toBe("fail");
    click("result-retry");
    expect(controller.snapshot()).toMatchObject({ surface: "level", currentLevel: 3 });
    expectDiagnostics();
    click("test-lose");
    click("result-menu");
    expect(controller.snapshot()).toMatchObject({ surface: "menu", currentLevel: 3, completedLevels: [1, 2] });
  });

  it("keeps result actions in a readable shared card instead of stretching a button sprite into a panel", async () => {
    const controller = createController();
    const root = document.getElementById("app")!;
    const shell = mountTemplateShell({ mountInto: root, controller });
    const harness = createTemplateHarness({
      buildVersion: "test",
      packageId: "com.fabrikav2.template",
      controller,
    });

    expect(await harness.driveTo!("fail")).toBe(true);
    shell.render();

    expect(shell.root.querySelector(".fab-result-card.fab-modal-card--image")).toBeNull();
    expect(shell.root.querySelector('[data-fab-action="result-retry"]')).not.toBeNull();
    expect(shell.root.querySelector('[data-fab-action="result-menu"]')).not.toBeNull();
  });
});
