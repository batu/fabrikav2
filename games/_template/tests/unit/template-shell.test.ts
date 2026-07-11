import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

function templateShellCss(): string {
  return readFileSync(resolve(process.cwd(), "src/shell/template-shell.css"), "utf8");
}

function templateTokensCss(): string {
  return readFileSync(resolve(process.cwd(), "design/tokens.css"), "utf8");
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
  it("declares a margin-free viewport host and visible shared control surfaces", () => {
    const css = templateShellCss();

    expect(css).toMatch(/body\s*\{[^}]*margin:\s*0;/s);
    expect(css).toMatch(/\.template-shell \.fab-ui\s*\{[^}]*--fab-color-accent:\s*var\(--fab-seed-color-accent\);/s);
    expect(css).toMatch(/\.template-shell__icon-action\s*\{[^}]*background-color:\s*var\(--fab-color-accent\);/s);
    expect(css).toMatch(/\.template-shell \.fab-pause-card \[data-fab-action="pause-resume"\]\s*\{[^}]*background-color:\s*var\(--fab-color-accent\);/s);
    expect(css).toMatch(/\.template-shell \.fab-modal-card\.fab-pause-card\s*\{[^}]*background-color:\s*var\(--fab-seed-color-pause-surface\);/s);
    expect(css).toMatch(/\.template-shell \.fab-page-back\s*\{[^}]*background-color:\s*var\(--fab-color-accent\);/s);
    expect(css).toMatch(/\.template-shell \.fab-result-body\s*\{[^}]*background-color:\s*var\(--fab-color-gameplay-surface\);/s);
    expect(css).toMatch(/\.template-shell \.fab-toggle-input\s*\{[^}]*width:\s*100%;[^}]*height:\s*100%;/s);
  });

  it("keeps Settings as an icon-only utility and the white currency star on a contrasted surface", () => {
    const controller = createController();
    const root = document.getElementById("app")!;
    const shell = mountTemplateShell({ mountInto: root, controller });

    const settings = shell.root.querySelector<HTMLButtonElement>('[data-fab-action="settings"]');
    const currency = shell.root.querySelector<HTMLElement>('[data-fab-instance="menu.currency"]');
    const css = templateShellCss();

    expect(settings?.classList.contains("template-shell__icon-action--utility")).toBe(true);
    expect(settings?.getAttribute("aria-label")).toBe("Settings");
    expect(currency?.classList.contains("template-shell__currency--contrasted")).toBe(true);
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

  it("keeps the paused level visibly present without duplicating its live controls", () => {
    const controller = createController();
    const root = document.getElementById("app")!;
    const shell = mountTemplateShell({ mountInto: root, controller });

    controller.startCurrent();
    controller.pause();
    shell.render();

    const backdrop = shell.root.querySelector<HTMLElement>(".template-shell__level--paused-backdrop");
    const css = templateShellCss();

    expect(backdrop).not.toBeNull();
    expect(backdrop?.dataset.templateBackdrop).toBe("paused-level");
    expect(backdrop?.getAttribute("aria-hidden")).toBe("true");
    expect(backdrop?.hasAttribute("inert")).toBe(true);
    expect(backdrop?.querySelectorAll("[data-fab-action]")).toHaveLength(0);
    expect(backdrop?.querySelectorAll("[data-fab-instance]")).toHaveLength(0);
    expect(backdrop?.querySelector(".template-shell__sample-outcomes")).toBeNull();
    expect(backdrop?.querySelector(".template-shell__hud-action-spacer")?.getAttribute("aria-hidden")).toBe("true");
    expect(shell.root.querySelector('[data-fab-instance="pause.panel"]')).not.toBeNull();
    expect(css).toMatch(/\.template-shell__level--paused-backdrop\s*\{[^}]*pointer-events:\s*none;/s);
    expect(css).toMatch(
      /\.template-shell\[data-fab-state="pause"\] \.fab-modal-scrim\s*\{[^}]*background:\s*var\(--fab-seed-color-pause-scrim\);/s,
    );
    expect(css).toMatch(
      /\.template-shell \.fab-modal-card\.fab-pause-card\s*\{[^}]*padding:\s*var\(--fab-space-md\);/s,
    );
    expect(css).toMatch(
      /\.template-shell \.fab-modal-card\.fab-pause-card\s*\{[^}]*--fab-pause-action-gap:\s*var\(--fab-space-xs\);/s,
    );
    expect(css).toMatch(
      /\.template-shell \.fab-pause-card \[data-fab-action="pause-quit"\]\s*\{[^}]*background:\s*var\(--fab-color-secondary-surface\);[^}]*border:\s*var\(--fab-border-width\) solid var\(--fab-color-secondary-border\);[^}]*box-shadow:\s*none;/s,
    );
  });

  it("frames the required outcome controls as a quiet diagnostic strip beside a player-facing trail clearing", () => {
    const controller = createController();
    const root = document.getElementById("app")!;
    const shell = mountTemplateShell({ mountInto: root, controller });

    controller.startCurrent();
    shell.render();

    const sample = shell.root.querySelector<HTMLElement>(".template-shell__sample-outcomes");
    expect(sample).not.toBeNull();
    expect(sample?.dataset.templateDiagnostic).toBe("outcomes");
    expect(sample?.textContent).toContain("Outcome preview");
    expect(sample?.querySelector('[data-fab-action="test-win"]')?.textContent).toBe("Win preview");
    expect(sample?.querySelector('[data-fab-action="test-lose"]')?.textContent).toBe("Lose preview");
    expect(sample?.querySelector('[data-fab-action="test-win"]')?.classList.contains("template-shell__test-action--win")).toBe(true);
    expect(sample?.querySelector('[data-fab-action="test-lose"]')?.classList.contains("template-shell__test-action--lose")).toBe(true);
    const socket = shell.root.querySelector<HTMLElement>('[data-fab-role="gameplay-region"]');
    expect(socket?.dataset.templateSocket).toBe("replaceable-mechanic");
    expect(socket?.classList.contains("template-shell__gameplay--trail")).toBe(true);
    expect(socket?.querySelector(".template-shell__gameplay-kicker")?.textContent).toBe("Trail clearing");
    expect(socket?.querySelector<HTMLImageElement>(".template-shell__gameplay-art")?.src).toContain("icon-play.png");
    expect(shell.root.textContent).not.toContain("Gameplay goes here");
    expect(shell.root.textContent).not.toContain("Starter playfield");
    expect(shell.root.textContent).not.toContain("add a mechanic");
    expect(templateShellCss()).toMatch(
      /\.template-shell__gameplay--trail\s*\{[^}]*border-style:\s*solid;[^}]*background:/s,
    );
    expect(templateShellCss()).toMatch(
      /\.template-shell__gameplay--trail\s*\{[^}]*grid-template-columns:\s*auto minmax\(0, 1fr\);/s,
    );
    expect(templateShellCss()).toMatch(
      /\.template-shell__gameplay-emblem\s*\{[^}]*box-shadow:\s*none;/s,
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
    expect(css).toMatch(
      /\.template-shell__hud-action-spacer\s*\{[^}]*flex:\s*0 0 var\(--fab-btn-min-size\);[^}]*width:\s*var\(--fab-btn-min-size\);/s,
    );
  });

  it("uses a trail-start marker and a success check instead of the bullseye and open-lock placeholder language", () => {
    const controller = createController();
    const root = document.getElementById("app")!;
    const shell = mountTemplateShell({ mountInto: root, controller });

    const hero = shell.root.querySelector<HTMLImageElement>('[data-fab-instance="menu.hero"]');
    const completed = shell.root.querySelector<HTMLElement>('[data-fab-instance="menu.node.completed"]');
    const locked = shell.root.querySelector<HTMLElement>('[data-fab-instance="menu.node.locked"]');
    const tokens = templateTokensCss();

    expect(hero?.src).toContain("icon-play.png");
    expect(hero?.src).not.toContain("hero-placeholder.png");
    expect(completed?.getAttribute("data-fab-node-state")).toBe("completed");
    expect(locked?.getAttribute("data-fab-node-state")).toBe("locked");
    expect(tokens).toMatch(/--fab-seed-levelmap-art-completed:\s*url\("\.\/assets\/icon-confirm\.png"\);/);
    expect(tokens).toMatch(/--fab-seed-levelmap-art-locked:\s*url\("\.\/assets\/node-locked\.png"\);/);
    expect(templateShellCss()).toMatch(/\.template-shell__hero-stage\s*\{[^}]*box-shadow:\s*none;/s);
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

  it("gives the fail card a calm retry signal with Retry as its only primary action", () => {
    const controller = createController();
    const root = document.getElementById("app")!;
    const shell = mountTemplateShell({ mountInto: root, controller });

    controller.startCurrent();
    controller.lose();
    shell.render();

    const ribbon = shell.root.querySelector<HTMLElement>(".fab-modal-ribbon-title");
    const retry = shell.root.querySelector<HTMLElement>('[data-fab-action="result-retry"]');
    const home = shell.root.querySelector<HTMLElement>('[data-fab-action="result-menu"]');
    const css = templateShellCss();

    expect(ribbon?.textContent).toBe("Try again");
    expect(shell.root.querySelector<HTMLImageElement>(".template-shell__result-art")?.src).toContain("icon-retry.png");
    expect(retry?.classList.contains("template-shell__primary-action")).toBe(true);
    expect(home?.classList.contains("template-shell__fail-home-action")).toBe(true);
    expect(css).toMatch(
      /\.template-shell\[data-fab-state="fail"\] \.fab-ui\s*\{[^}]*--fab-ribbon-title-color:\s*var\(--fab-seed-color-fail-ribbon-text\);/s,
    );
    expect(css).toMatch(
      /\.template-shell\[data-fab-state="fail"\] \.fab-result-body\s*\{[^}]*background-color:\s*var\(--fab-seed-color-fail-surface\);/s,
    );
    expect(css).toMatch(
      /\.template-shell\[data-fab-state="fail"\] \.template-shell__fail-home-action\s*\{[^}]*background:\s*var\(--fab-color-secondary-surface\);[^}]*box-shadow:\s*none;/s,
    );
    expect(css).toMatch(
      /\.template-shell\[data-fab-state="fail"\] \.fab-modal-ribbon\s*\{[^}]*aspect-ratio:\s*auto;[^}]*background-color:\s*var\(--fab-seed-color-pause-surface\);[^}]*box-shadow:\s*none;/s,
    );
    expect(css).toMatch(
      /\.template-shell\[data-fab-state="fail"\] \.fab-modal-ribbon-image\s*\{[^}]*display:\s*none;/s,
    );
    expect(css).toMatch(
      /\.template-shell\[data-fab-state="fail"\] \.template-shell__result-art\s*\{[^}]*width:\s*var\(--fab-fail-art-size\);[^}]*border-radius:\s*50%;/s,
    );
  });

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
      const shell = mountTemplateShell({ mountInto: root, controller });
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
