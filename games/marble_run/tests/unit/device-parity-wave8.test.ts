import { beforeEach, describe, expect, it } from "vitest";
import { installShellArt } from "../../design/theme";

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

  it("makes only the menu settings backdrop opaque black", () => {
    const css = shellArtCss();
    const menu = css.match(/\.fab-ui\.fab-modal-backdrop\.marble-settings-modal--menu \{[^}]*\}/);
    expect(menu).not.toBeNull();
    expect(menu![0]).toContain("background: #000");
    expect(css).not.toMatch(/marble-settings-modal--ingame[^}]*background:\s*#000/);
  });

  it("shrinks the home preview budget on short phone viewports", () => {
    const css = shellArtCss();
    expect(css).toMatch(/@media \(max-height: 800px\)[^{]*\{[\s\S]*?\.marble-home-board-preview-slot \{[^}]*max-height: 115px/);
  });
});
