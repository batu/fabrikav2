import { describe, expect, it } from "vitest";
import { installLevelMapArt } from "../../design/theme.js";

describe("arrow menu theme", () => {
  it("installs visible state art on the nested level-map root", () => {
    document.head.innerHTML = "";

    installLevelMapArt(document);

    const style = document.getElementById("arrow-levelmap-art");
    expect(style).not.toBeNull();
    expect(style?.textContent).not.toContain("--fab-levelmap-art-");
    expect(style?.textContent).toContain(".fab-levelmap-path::before");
    expect(style?.textContent).toContain(".arrow-menu-header::before");
    expect(style?.textContent).toContain(".arrow-play-button");
    expect(style?.textContent).toContain(".arrow-ui .arrow-play-button:active:not(:disabled)");
    expect(style?.textContent).toContain("bottom: calc(18px + env(safe-area-inset-bottom, 0px));");
    expect(style?.textContent).toContain("width: min(72vw, 260px);");
  });

  it("is idempotent", () => {
    document.head.innerHTML = "";

    installLevelMapArt(document);
    installLevelMapArt(document);

    expect(document.querySelectorAll("#arrow-levelmap-art")).toHaveLength(1);
  });
});
