import { beforeEach, describe, expect, it } from "vitest";
import { installShellArt } from "../../design/theme";

function shellArtCss(): string {
  installShellArt(document);
  const style = document.querySelector("style");
  if (style === null || style.textContent === null) throw new Error("shell art style missing");
  return style.textContent;
}

// MRV2-14 device parity wave 7: pin the home vertical-budget, button-width,
// modal-ribbon, and reward-stack fixes so a future theme edit can't silently
// reintroduce the round-6 device defects. Geometry itself is proven headlessly
// (scripts/verify-wave7.mjs); these are the cheap regression fences.
describe("device parity wave 7 CSS pins", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
  });

  it("collapses the saga rail dead band and un-stretches the fixed LEVEL button (defects 1, 2)", () => {
    const css = shellArtCss();
    // Saga rail min-height:0 kills the ~175px centered dead band.
    expect(css).toMatch(/#home-shell \.fab-levelmap-path \{[^}]*min-height: 0;[^}]*\}/);
    // Fixed actions container sizes to content so the button uses its 220px
    // min-width instead of resolving width:100% against the viewport.
    const actions = css.match(/\.marble-ui \.fab-home-menu-actions \{[^}]*\}/);
    expect(actions).not.toBeNull();
    expect(actions![0]).toContain("width: max-content");
  });

  it("trims the preview spacer under the 390x844 budget (defect 1)", () => {
    const css = shellArtCss();
    const slot = css.match(/\.marble-home-board-preview-slot \{[^}]*\}/);
    expect(slot).not.toBeNull();
    const maxH = slot![0].match(/max-height:\s*(\d+)px/);
    expect(maxH).not.toBeNull();
    expect(Number(maxH![1])).toBeLessThanOrEqual(230);
  });

  it("makes the settings/pause card a flex column with a top-overhanging ribbon (defects 3, 4)", () => {
    const css = shellArtCss();
    const card = css.match(/\.marble-ui \.marble-settings-card\.fab-modal-card--image \{[^}]*\}/);
    expect(card).not.toBeNull();
    expect(card![0]).toContain("display: flex");
    expect(card![0]).toContain("flex-direction: column");
    const ribbon = css.match(/\.marble-ui \.marble-settings-card > \.fab-modal-ribbon \{[^}]*\}/);
    expect(ribbon).not.toBeNull();
    expect(ribbon![0]).toContain("align-self: center");
    expect(ribbon![0]).toContain("margin: calc(-64px - var(--fab-ribbon-overhang))");
  });

  it("insets the in-game Restart/Home action rows (defect 3)", () => {
    const css = shellArtCss();
    const action = css.match(/\.marble-ui \.marble-settings-action \{[^}]*\}/);
    expect(action).not.toBeNull();
    expect(action![0]).toContain("margin-inline: auto");
    expect(action![0]).toMatch(/width: min\(/);
  });

  it("stacks the reward as a transparent centered column, not an inline pill (defect 5)", () => {
    const css = shellArtCss();
    const row = css.match(/\.marble-ui \.marble-reward-row \{[^}]*\}/);
    expect(row).not.toBeNull();
    expect(row![0]).toContain("flex-direction: column");
    expect(row![0]).toContain("background: none");
    expect(row![0]).not.toContain("border-radius: 999px");
    expect(css).toMatch(/\.marble-ui \.marble-reward-coinrow \{[^}]*\}/);
  });

  it("keeps the win completion ribbon lift untouched (KTD3-guard)", () => {
    const css = shellArtCss();
    const ribbon = css.match(/#modal-root\.completion-mode \.fab-modal-ribbon \{[^}]*\}/);
    expect(ribbon).not.toBeNull();
    expect(ribbon![0]).toContain("margin-top: calc(-1 * var(--fab-space-lg) - var(--fab-ribbon-overhang) - 72px)");
  });
});
