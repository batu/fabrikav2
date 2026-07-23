import { beforeEach, describe, expect, it } from "vitest";
import { installShellArt, MARBLE_LEVELMAP_THEME } from "../../design/theme";
import { mountHomeShell } from "../../src/menu/homeMenu";

function shellArtCss(): string {
  installShellArt(document);
  const style = document.querySelector("style");
  if (style === null || style.textContent === null) throw new Error("shell art style missing");
  return style.textContent;
}

describe("device parity wave 8 CSS pins", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
  });

  it("centers the actual settings ribbon title", () => {
    const css = shellArtCss();
    const title = css.match(/\.marble-ui \.marble-settings-card \.fab-modal-ribbon-title \{[^}]*\}/);
    expect(title).not.toBeNull();
    expect(title![0]).toContain("left: 50%");
    expect(title![0]).toContain("transform: translate(-50%, -50%)");
    expect(title![0]).toContain("text-align: center");
  });

  it("makes only the menu settings backdrop an opaque purple bubble field", () => {
    const css = shellArtCss();
    const menu = css.match(/\.fab-ui\.fab-modal-backdrop\.marble-settings-modal--menu \{[^}]*\}/);
    expect(menu).not.toBeNull();
    expect(menu![0]).toContain("background-color: #3b3247");
    expect(menu![0]).toContain("url('/v1/ui/marble-shadow-tile.png')");
    expect(menu![0]).toContain("background-repeat: no-repeat, repeat");
    expect(menu![0]).not.toContain("background: #000");
    expect(css).not.toMatch(/marble-settings-modal--ingame[^}]*marble-shadow-tile/);
  });

  it("matches the v1 in-game settings shade and all-caps actions", () => {
    const css = shellArtCss();
    const ingame = css.match(/\.fab-ui\.fab-modal-backdrop\.marble-settings-modal--ingame \{[^}]*\}/);
    expect(ingame).not.toBeNull();
    expect(ingame![0]).toContain("background: rgba(119, 100, 141, 0.66)");

    const actions = css.match(/\.marble-settings-modal--ingame \.marble-settings-action \{[^}]*\}/);
    expect(actions).not.toBeNull();
    expect(actions![0]).toContain("text-transform: uppercase");
  });

  it("shrinks the home preview budget on short phone viewports", () => {
    const css = shellArtCss();
    expect(css).toMatch(/@media \(max-height: 800px\)[^{]*\{[\s\S]*?\.marble-home-board-preview-slot \{[^}]*max-height: 115px/);
  });

  it("keeps the home saga dense and prominent", () => {
    expect(MARBLE_LEVELMAP_THEME["--fab-levelmap-node-size"]).toBe("64px");
    expect(MARBLE_LEVELMAP_THEME["--fab-levelmap-node-current-size"]).toBe("112px");
    expect(MARBLE_LEVELMAP_THEME["--fab-levelmap-node-gap"]).toBe("2px");
  });

  it("mounts the v1 eight-piece ambient sprinkle layer", () => {
    const mountInto = document.createElement("div");
    document.body.appendChild(mountInto);
    const handle = mountHomeShell({
      mountInto,
      coins: 0,
      nodes: [{ id: 1, label: "1", name: "Level 1", state: "current" }],
      currentLevelNumber: 1,
      onSelectLevel: () => undefined,
      onStart: () => undefined,
      onOpenSettings: () => undefined,
    });

    expect(handle.el.querySelectorAll(".marble-ambient-sprinkle")).toHaveLength(8);
    expect(shellArtCss()).toMatch(/@keyframes marble-sprinkle-fall/);
    handle.dismiss();
  });
});
