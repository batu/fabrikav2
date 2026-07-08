import { describe, expect, it } from "vitest";
import { installLevelMapArt } from "../../design/theme.js";

describe("arrow menu theme", () => {
  it("installs visible state art on the nested level-map root", () => {
    document.head.innerHTML = "";

    installLevelMapArt(document);

    const style = document.getElementById("arrow-levelmap-art");
    expect(style).not.toBeNull();
    expect(style?.textContent).toContain("--fab-levelmap-art-current: url(");
    expect(style?.textContent).toContain("--fab-levelmap-art-locked: url(");
    expect(style?.textContent).toContain("--fab-levelmap-art-completed: url(");
    expect(style?.textContent).toContain(".fab-levelmap-path::before");
    expect(style?.textContent).toContain(".arrow-menu-header::before");
  });

  it("is idempotent", () => {
    document.head.innerHTML = "";

    installLevelMapArt(document);
    installLevelMapArt(document);

    expect(document.querySelectorAll("#arrow-levelmap-art")).toHaveLength(1);
  });
});
