import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { installShellArt } from "../../design/theme";

const HUD_CSS = readFileSync(join(process.cwd(), "src/gameplay/hud.css"), "utf8");

function shellArtCss(): string {
  installShellArt(document);
  const style = document.querySelector("style");
  if (style === null || style.textContent === null) throw new Error("shell art style missing");
  return style.textContent;
}

// MRV2-13 device parity wave 6: pin the three cascade/clip fixes so a future
// sheet edit can't silently reintroduce the round-5 device defects.
describe("device parity wave 6 CSS pins", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
  });

  it("gameplay canvas lift is scoped to direct children only (defect 1 cascade)", () => {
    // '#game-container canvas' (1-0-1) used to beat the home preview's
    // full-bleed rule and push the preview canvas below the viewport.
    expect(HUD_CSS).toContain("#game-container > canvas");
    expect(HUD_CSS).not.toMatch(/#game-container\s+canvas/);
  });

  it("combo callouts use the bundled display font on both Android and WKWebView", () => {
    const streak = HUD_CSS.match(/\.mr-gameplay-screen \.streak \{[^}]*\}/);
    expect(streak).not.toBeNull();
    expect(streak![0]).toContain("font-family: 'FredokaOne'");
    expect(streak![0]).toContain("font-weight: 400");
    expect(streak![0]).toContain("font-synthesis: none");
  });

  it("home preview full-bleed rule uses id strength and keeps the saga rail readable", () => {
    const css = shellArtCss();
    const rule = css.match(/#hud-overlay > \.marble-home-board-preview \{[^}]*\}/);
    expect(rule).not.toBeNull();
    expect(rule![0]).toContain("position: fixed");
    expect(rule![0]).toContain("z-index: 0");
    expect(rule![0]).toContain("inset: 0");
  });

  it("modal card never clips (backdrop scrolls; card centers via auto margins)", () => {
    const css = shellArtCss();
    const card = css.match(/\.marble-ui \.fab-modal-card \{[^}]*\}/);
    expect(card).not.toBeNull();
    expect(card![0]).not.toContain("overflow-y");
    expect(card![0]).not.toContain("max-height");
    expect(card![0]).toContain("margin-block: auto");
    expect(card![0]).toContain("--fab-modal-close-inset: -8px");
    const backdrop = css.match(/\.marble-ui \.fab-modal-backdrop \{[^}]*\}/);
    expect(backdrop).not.toBeNull();
    expect(backdrop![0]).toContain("overflow-y: auto");
  });

  it("completion ribbon is centered against the completion artwork (defect 3)", () => {
    const css = shellArtCss();
    const ribbon = css.match(/#modal-root\.completion-mode \.fab-modal-ribbon \{[^}]*\}/);
    expect(ribbon).not.toBeNull();
    expect(ribbon![0]).toContain("left: 8.2%");
    expect(ribbon![0]).toContain("width: 83.6%");
    expect(ribbon![0]).toContain("margin: 0");
  });
});
