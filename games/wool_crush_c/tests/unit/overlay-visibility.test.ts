import { beforeEach, describe, expect, it } from "vitest";
import { hideHomeMenuLayer, showHomeMenuLayer } from "../../src/ui/OverlayVisibility";

describe("home menu layer visibility", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="hud-overlay" class="home-mode">
        <div id="home-shell" class="home-shell"></div>
        <div id="home-page-overlay" class="home-page-overlay"></div>
      </div>
    `;
  });

  it("hides the menu root before gameplay owns the overlay", () => {
    const overlay = document.getElementById("hud-overlay")!;
    const shell = document.getElementById("home-shell") as HTMLElement & { inert?: boolean };

    hideHomeMenuLayer(overlay);

    expect(overlay.classList.contains("home-mode")).toBe(false);
    expect(document.getElementById("home-page-overlay")).toBeNull();
    expect(shell.hidden).toBe(true);
    expect(shell.getAttribute("aria-hidden")).toBe("true");
    expect(shell.inert).toBe(true);
  });

  it("shows the menu root when HomeScene renders the menu", () => {
    const overlay = document.getElementById("hud-overlay")!;
    const shell = document.getElementById("home-shell") as HTMLElement & { inert?: boolean };
    hideHomeMenuLayer(overlay);

    showHomeMenuLayer(overlay);

    expect(overlay.classList.contains("home-mode")).toBe(true);
    expect(shell.hidden).toBe(false);
    expect(shell.hasAttribute("aria-hidden")).toBe(false);
    expect(shell.inert).toBe(false);
  });
});
