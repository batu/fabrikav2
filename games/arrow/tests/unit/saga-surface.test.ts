import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountHomeMenu } from "@fabrikav2/ui";

import { copy } from "../../design/copy.js";
import { installLevelMapArt } from "../../design/theme.js";
import { DEFAULT_JUICE } from "../../src/game/juice.js";
import type { Progress } from "../../src/game/persist.js";
import { bootGame } from "../../src/main.js";
import { buildSagaNodes } from "../../src/shell/saga.js";

const REQUIRED_LEVELMAP_TOKENS = [
  "--fab-levelmap-path-width",
  "--fab-levelmap-node-gap",
  "--fab-levelmap-offset",
  "--fab-levelmap-node-size",
  "--fab-levelmap-node-current-size",
  "--fab-levelmap-node-font",
  "--fab-levelmap-node-current-font",
  "--fab-levelmap-far-opacity",
  "--fab-levelmap-far-scale",
  "--fab-levelmap-distant-opacity",
  "--fab-levelmap-distant-scale",
  "--fab-levelmap-node-color",
  "--fab-levelmap-dot-color",
  "--fab-levelmap-node-bg",
  "--fab-levelmap-node-radius",
  "--fab-levelmap-locked-color",
  "--fab-levelmap-locked-dot-color",
  "--fab-levelmap-locked-bg",
  "--fab-levelmap-completed-color",
  "--fab-levelmap-completed-bg",
  "--fab-levelmap-current-color",
  "--fab-levelmap-current-bg",
  "--fab-levelmap-line-top",
  "--fab-levelmap-line-mid",
  "--fab-levelmap-line-bottom",
  "--fab-levelmap-line-glow",
  "--fab-levelmap-loading-bg",
  "--fab-levelmap-loading-border",
  "--fab-levelmap-loading-shadow",
  "--fab-levelmap-loading-current-bg",
  "--fab-levelmap-art-default",
  "--fab-levelmap-art-locked",
  "--fab-levelmap-art-completed",
  "--fab-levelmap-art-current",
] as const;

const store = new Map<string, string>();
const mockLocalStorage = {
  getItem: (key: string): string | null => store.get(key) ?? null,
  setItem: (key: string, value: string): void => {
    store.set(key, value);
  },
  removeItem: (key: string): void => {
    store.delete(key);
  },
  clear: (): void => {
    store.clear();
  },
  key: (index: number): string | null => Array.from(store.keys())[index] ?? null,
  get length(): number {
    return store.size;
  },
};
vi.stubGlobal("localStorage", mockLocalStorage);

const launchViewport = { width: 390, height: 844 } as const;
const originalViewport = { width: window.innerWidth, height: window.innerHeight } as const;

interface HappyDomViewportApi {
  setViewport(viewport: { width: number; height: number }): void;
}

function progress(done: number): Progress {
  return {
    schema: "arrow-progress",
    version: 2,
    packProgress: done > 0 ? { all: done } : {},
    mute: false,
    tutorialSeen: false,
    bestTimeSeconds: 0,
    completions: 0,
    juice: DEFAULT_JUICE,
  };
}

function setViewport(width: number, height: number): void {
  const happyDom = (window as Window & { happyDOM?: HappyDomViewportApi }).happyDOM;
  if (happyDom) {
    happyDom.setViewport({ width, height });
    return;
  }
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
}

function unwrapCssLayers(css: string): string {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  let output = "";
  let i = 0;
  while (i < withoutComments.length) {
    if (withoutComments.startsWith("@layer", i)) {
      const open = withoutComments.indexOf("{", i);
      const semi = withoutComments.indexOf(";", i);
      if (semi !== -1 && (open === -1 || semi < open)) {
        i = semi + 1;
        continue;
      }
      if (open === -1) break;
      let depth = 1;
      let close = open + 1;
      while (close < withoutComments.length && depth > 0) {
        const char = withoutComments[close];
        if (char === "{") depth += 1;
        if (char === "}") depth -= 1;
        close += 1;
      }
      output += unwrapCssLayers(withoutComments.slice(open + 1, close - 1));
      i = close;
      continue;
    }
    output += withoutComments[i];
    i += 1;
  }
  return output;
}

function installCss(id: string, path: string): void {
  const style = document.createElement("style");
  style.id = id;
  style.textContent = unwrapCssLayers(readFileSync(resolve(path), "utf8"));
  document.head.appendChild(style);
}

function isTransparent(color: string): boolean {
  const normalized = color.trim().toLowerCase();
  return (
    normalized === "" ||
    normalized === "transparent" ||
    /rgba\([^)]*,\s*0(?:\.0+)?\)$/.test(normalized)
  );
}

function expectVisibleSagaDots(root: HTMLElement): void {
  const dots = Array.from(root.querySelectorAll<HTMLElement>(".fab-levelmap-node-dot"));
  expect(dots.length).toBeGreaterThan(0);
  for (const dot of dots) {
    const style = getComputedStyle(dot);
    expect(Number.parseFloat(style.width)).toBeGreaterThan(0);
    expect(Number.parseFloat(style.height)).toBeGreaterThan(0);
    expect(style.backgroundImage).not.toContain("var(");
    expect(style.backgroundColor).not.toContain("var(");
    const hasImage = !["", "none"].includes(style.backgroundImage.trim());
    const hasColor = !isTransparent(style.backgroundColor);
    expect(hasImage || hasColor).toBe(true);
    expect(hasImage).toBe(true);
  }
}

function expectSagaStateStyles(root: HTMLElement): void {
  const completed = root.querySelector<HTMLElement>(".fab-levelmap-node.completed .fab-levelmap-node-dot");
  const current = root.querySelector<HTMLElement>(".fab-levelmap-node.current .fab-levelmap-node-dot");
  const locked = root.querySelector<HTMLElement>(".fab-levelmap-node.locked .fab-levelmap-node-dot");
  expect(completed).not.toBeNull();
  expect(current).not.toBeNull();
  expect(locked).not.toBeNull();

  const currentStyle = getComputedStyle(current!);
  const completedStyle = getComputedStyle(completed!);
  const lockedStyle = getComputedStyle(locked!);
  expect(currentStyle.backgroundImage).not.toContain("var(");
  expect(completedStyle.backgroundImage).not.toContain("var(");
  expect(lockedStyle.backgroundImage).not.toContain("var(");
  expect(Number.parseFloat(currentStyle.width)).toBeGreaterThan(Number.parseFloat(completedStyle.width));
  expect(Number.parseFloat(currentStyle.width)).toBeGreaterThan(Number.parseFloat(lockedStyle.width));
}

function expectCenteredSagaNodes(root: HTMLElement): void {
  const nodes = Array.from(root.querySelectorAll<HTMLElement>(".fab-levelmap-node"));
  expect(nodes.length).toBeGreaterThan(0);
  for (const node of nodes) {
    expect(getComputedStyle(node).getPropertyValue("--node-x").trim()).toBe("0px");
  }
}

function firstPx(value: string): number {
  const match = /(-?\d+(?:\.\d+)?)px/.exec(value);
  return match ? Number(match[1]) : Number.NaN;
}

function expectFixedLaunchCta(button: HTMLButtonElement): void {
  const style = getComputedStyle(button);
  expect(["fixed", "sticky"]).toContain(style.position);
  expect(style.left).toBe("50%");
  expect(style.bottom).toContain("18px");
  expect(style.width).toContain("260px");
  expect(style.transform).toContain("translateX(-50%)");

  const declaredWidth = firstPx(style.width);
  const maxWidth = firstPx(style.maxWidth);
  const minimumTouchHeight = firstPx(style.minHeight);
  const bottomInset = firstPx(style.bottom);
  expect(declaredWidth).toBeLessThanOrEqual(window.innerWidth);
  expect(maxWidth).toBeLessThanOrEqual(window.innerWidth);
  expect(minimumTouchHeight).toBeGreaterThanOrEqual(44);
  expect(bottomInset + minimumTouchHeight).toBeLessThanOrEqual(window.innerHeight);
}

function installCanvasHarness(): void {
  const gradient = { addColorStop: () => undefined };
  const ctx = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "createLinearGradient" || prop === "createRadialGradient") return () => gradient;
        if (prop === "measureText") return () => ({ width: 0 });
        return () => undefined;
      },
      set() {
        return true;
      },
    },
  ) as CanvasRenderingContext2D;

  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => ctx);
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
}

afterEach(() => {
  vi.restoreAllMocks();
  setViewport(originalViewport.width, originalViewport.height);
  store.clear();
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

describe("arrow saga composed surface", () => {
  it("defines every shared level-map token in design/tokens.css", () => {
    const css = readFileSync(resolve("design/tokens.css"), "utf8");

    for (const token of REQUIRED_LEVELMAP_TOKENS) {
      expect(css).toMatch(new RegExp(`${token}:`));
    }
  });

  it("computes visible node-chip styles from the real kit and game CSS", () => {
    document.head.innerHTML = "";
    document.body.innerHTML = '<div id="host"></div>';
    installCss("fab-ui-css-test", "../../packages/ui/src/ui.css");
    installCss("arrow-token-css-test", "design/tokens.css");
    installLevelMapArt(document);

    const host = document.getElementById("host")!;
    const handle = mountHomeMenu({
      mountInto: host,
      saga: {
        state: { nodes: buildSagaNodes(progress(3)) },
        actions: { onSelectLevel: () => {} },
        loadingLabel: "Loading",
      },
    });

    expectVisibleSagaDots(handle.el);
    expectSagaStateStyles(handle.el);
    expectCenteredSagaNodes(handle.el);
  });

  it("renders exactly one fixed Play CTA wired to the first incomplete level", () => {
    document.body.innerHTML = `
      <canvas id="scene" style="width: 390px; height: 844px"></canvas>
      <div id="ui" class="arrow-ui"></div>
    `;
    setViewport(launchViewport.width, launchViewport.height);
    installCss("fab-ui-css-test", "../../packages/ui/src/ui.css");
    installCss("arrow-token-css-test", "design/tokens.css");
    installCanvasHarness();
    installLevelMapArt(document);

    const canvas = document.getElementById("scene") as HTMLCanvasElement;
    const ui = document.getElementById("ui")!;
    const app = bootGame(canvas, ui);
    app.harness().seedSave!({ unlockedLevel: 7 });

    const playButtons = ui.querySelectorAll<HTMLButtonElement>("[data-fab-action='play']");
    expect(playButtons).toHaveLength(1);
    expect(playButtons[0]!.textContent).toBe(copy["menu.play"]);
    expect(playButtons[0]!.classList.contains("arrow-play-button")).toBe(true);
    expect(playButtons[0]!.getAttribute("aria-label")).toBe(`${copy["menu.play"]} ${copy["menu.levelButton"]} 7`);
    expectFixedLaunchCta(playButtons[0]!);

    playButtons[0]!.click();

    expect(app.snapshot()).toMatchObject({ scene: "playing", status: "playing", level: 7 });
    expect(ui.querySelector("[data-fab-action='play']")).toBeNull();
  });
});
