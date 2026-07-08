import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { mountHomeMenu } from "@fabrikav2/ui";

import { installLevelMapArt } from "../../design/theme.js";
import { DEFAULT_JUICE } from "../../src/game/juice.js";
import type { Progress } from "../../src/game/persist.js";
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
  });
});
