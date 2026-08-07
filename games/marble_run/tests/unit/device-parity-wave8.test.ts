import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
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
    // NOTE: this assertion used to require `left: 50%` + translate(-50%, -50%),
    // and passed while the shipped title sat 42px LEFT of the ribbon centre on a
    // Pixel 6a — string-matching CSS proves nothing about layout. That pairing
    // fought the kit's own left:0/right:0/margin-inline:auto centring. Centre it
    // the kit's way and keep the over-constraining combination out.
    const css = shellArtCss();
    const title = css.match(/\.marble-ui \.marble-settings-card \.fab-modal-ribbon-title \{[^}]*\}/);
    expect(title).not.toBeNull();
    expect(title![0]).toContain("margin-inline: auto");
    expect(title![0]).toContain("text-align: center");
    expect(title![0]).not.toContain("left: 50%");
  });

  it("keeps the live home visible through a purple menu-settings scrim", () => {
    const css = shellArtCss();
    const menu = css.match(/\.fab-ui\.fab-modal-backdrop\.marble-settings-modal--menu \{[^}]*\}/);
    expect(menu).not.toBeNull();
    expect(menu![0]).toContain("background: transparent");
    expect(menu![0]).not.toContain("background: #000");
    const scrim = css.match(/\.fab-ui\.fab-modal-backdrop\.marble-settings-modal--menu \.fab-modal-scrim \{[^}]*\}/);
    expect(scrim).not.toBeNull();
    // 0.72 left the home banner, coin pill, gear and LEVEL button plainly
    // readable behind the card on device; v1 dims them to near-invisible.
    expect(scrim![0]).toContain("background: rgba(62, 43, 84, 0.93)");
  });

  it("matches the v1 in-game settings shade and all-caps actions", () => {
    const css = shellArtCss();
    const ingame = css.match(/\.fab-ui\.fab-modal-backdrop\.marble-settings-modal--ingame \{[^}]*\}/);
    expect(ingame).not.toBeNull();
    // MRV2-25 item 2: near-opaque purple so v1's full HUD dim is reproduced and
    // the composite matches v1's ~(64,51,82) pause shade on device.
    expect(ingame![0]).toContain("background: rgba(162, 129, 207, 0.93)");

    const actions = css.match(/\.marble-ui \.marble-settings-action \{[^}]*\}/);
    expect(actions).not.toBeNull();
    expect(actions![0]).toContain("text-transform: uppercase");
  });

  it("shrinks the home preview budget on short phone viewports", () => {
    const css = shellArtCss();
    expect(css).toMatch(/@media \(max-height: 800px\)[^{]*\{[\s\S]*?\.marble-home-board-preview-slot \{[^}]*max-height: 115px/);
    expect(css).toMatch(/@media \(min-height: 801px\) and \(max-height: 900px\)[^{]*\{[\s\S]*?max-height: min\(11vh, 100px\)/);
  });

  it("uses the v1-sized banner title with flat lettering (no offset shadow or outline)", () => {
    // v1's title is flat brown with only a faint soft shadow. The old stack added
    // a cream underline (read as a white outline on device) and a hard purple
    // offset shadow; both are gone by product call (2026-07-27).
    const css = shellArtCss();
    const title = css.match(/\.marble-home-banner-title \{[^}]*\}/);
    expect(title).not.toBeNull();
    expect(title![0]).toContain("font-size: clamp(30px, 9.5vw, 42px)");
    expect(title![0]).not.toContain("0 4px 0 #3d1b33");
    expect(title![0]).not.toContain("rgba(255, 240, 205");
  });

  it("uses cream toggle knobs", () => {
    const css = shellArtCss();
    expect(css).toMatch(/\.marble-ui \.fab-toggle-slider::before \{[^}]*background: #fff4dc;/);
    const card = css.match(/\.marble-ui \.marble-settings-card\.fab-modal-card--image \{[^}]*\}/);
    expect(card?.[0]).toContain("padding: 104px 42px 34px");
  });

  it("keeps the enlarged settings ribbon inside the phone safe area", () => {
    const css = shellArtCss();
    const ribbon = css.match(/\.marble-ui \.marble-settings-card > \.fab-modal-ribbon \{[^}]*\}/);
    expect(ribbon?.[0]).toContain("width: min(calc(100% + 100px), calc(100vw - 16px))");

    const modal = css.match(/\.fab-ui\.fab-modal-backdrop\.marble-settings-modal--menu \{[^}]*\}/);
    expect(modal?.[0]).toContain("env(safe-area-inset-top)");
    expect(modal?.[0]).toContain("48px");
  });

  it("uses the standard settings row, toggle, and action spacing", () => {
    const css = shellArtCss();
    const row = css.match(/\.marble-ui \.fab-toggle-row \{[^}]*\}/);
    expect(row?.[0]).toContain("padding: 10px 18px 10px 24px");

    const toggle = css.match(/\.marble-ui \.fab-toggle-switch \{[^}]*\}/);
    expect(toggle?.[0]).toContain("width: 78px");
    expect(toggle?.[0]).toContain("height: 42px");
    expect(css).toMatch(/\.marble-ui \.fab-toggle-slider::before \{[^}]*width: 34px[^}]*height: 34px/);

    const actions = css.match(/\.marble-settings-modal--ingame \.fab-modal-actions \{[^}]*\}/);
    expect(actions?.[0]).toContain("margin-top: 18px");
  });

  it("matches the in-game card, ribbon, and outlined action geometry", () => {
    const css = shellArtCss();
    const card = css.match(/\.marble-settings-modal--ingame \.marble-settings-card \{[^}]*\}/);
    expect(card?.[0]).toContain("height: 560px");
    expect(card?.[0]).toContain("min-height: 560px");

    const ribbon = css.match(/\.marble-ui \.marble-settings-card > \.fab-modal-ribbon \{[^}]*\}/);
    expect(ribbon?.[0]).toContain("margin: calc(-104px - 38px)");

    const title = css.match(/\.marble-ui \.marble-settings-card \.fab-modal-ribbon-title \{[^}]*\}/);
    expect(title?.[0]).toContain("top: 39%");

    const action = css.match(/\.marble-settings-modal--ingame \.marble-settings-action \{[^}]*\}/);
    expect(action?.[0]).toContain("width: min(58%, 178px)");
    expect(action?.[0]).toContain("-webkit-text-stroke: 1.4px #2b1f3d");
  });

  it("optically centers the close glyph and removes its clipped pressed outline", () => {
    const css = shellArtCss();
    const close = css.match(/\.marble-ui \.fab-modal-close \{[^}]*\}/);
    expect(close?.[0]).toContain("display: grid");
    expect(close?.[0]).toContain("place-items: center");
    expect(close?.[0]).toContain("padding: 0 0 5px");
    expect(css).toMatch(/\.marble-ui \.fab-modal-close:focus,[\s\S]*?\.marble-ui \.fab-modal-close:focus-visible \{[^}]*outline: none/);
    const anchor = css.match(/\.marble-ui \.marble-settings-card > \.fab-modal-close \{[^}]*\}/);
    expect(anchor?.[0]).toContain("top: -38px");
    expect(anchor?.[0]).toContain("right: -8px");
  });

  it("renders an affordable hint at full opacity", () => {
    const css = readFileSync("src/gameplay/hud.css", "utf8");
    const enabledHint = css.match(/\.mr-gameplay-screen \.hint-btn:not\(:disabled\) \{[^}]*\}/);
    expect(enabledHint).not.toBeNull();
    expect(enabledHint![0]).toContain("opacity: 1");
    const hintArt = css.match(/\.mr-gameplay-screen \.hint-btn-art \{[^}]*\}/);
    expect(hintArt).not.toBeNull();
    expect(hintArt![0]).not.toContain("filter:");
    const disabledArt = css.match(/\.mr-gameplay-screen \.hint-btn:disabled \.hint-btn-art \{[^}]*\}/);
    expect(disabledArt).not.toBeNull();
    expect(disabledArt![0]).toContain("saturate(0.52)");
  });

  it("keeps the HINT label white with a dark outline", () => {
    const css = readFileSync("src/gameplay/hud.css", "utf8");
    const label = css.match(/\.mr-gameplay-screen \.hint-label \{[^}]*\}/);
    expect(label).not.toBeNull();
    expect(label![0]).toContain("color: #fff");
    expect(label![0]).toContain("-webkit-text-stroke: 1px #4a356d");
    expect(label![0]).toContain("text-shadow:");
  });

  it("uses v1's saga geometry", () => {
    // Ported from v1 .menu-saga-mount .fab-ui (sugar3d/src/ui/style.css). The
    // previous 64/112/2 values were tuned by eye and rendered nodes larger and
    // tighter than v1.
    expect(MARBLE_LEVELMAP_THEME["--fab-levelmap-node-size"]).toBe("56px");
    expect(MARBLE_LEVELMAP_THEME["--fab-levelmap-node-current-size"]).toBe("100px");
    expect(MARBLE_LEVELMAP_THEME["--fab-levelmap-node-gap"]).toBe("4px");
    expect(MARBLE_LEVELMAP_THEME["--fab-levelmap-path-width"]).toBe("min(180px, 48vw)");
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

  it("stacks the home banner above the rotating board above the saga rail (MRV2-23 item 3b)", () => {
    // Strip CSS comments so prose like "z-index:4" inside explanatory blocks
    // cannot be mistaken for an actual declaration.
    const css = shellArtCss().replace(/\/\*[\s\S]*?\*\//g, "");

    const banner = css.match(/\.marble-home-banner \{[^}]*\}/);
    expect(banner).not.toBeNull();
    const bannerZ = Number(banner![0].match(/z-index:\s*(\d+)/)?.[1]);

    const board = css.match(/#hud-overlay > \.marble-home-board-preview \{[^}]*\}/);
    expect(board).not.toBeNull();
    const boardZ = Number(board![0].match(/z-index:\s*(\d+)/)?.[1]);

    // banner > board so the wooden title always paints over the tilted decor.
    expect(bannerZ).toBeGreaterThan(boardZ);
    // MRV2-24 (preview-geometry) moved the decor board full-bleed BEHIND the home
    // shell content (.marble-ui > * is z-index:1), so it now sits at z-index:0 —
    // see theme.ts "z-index:0 keeps it BELOW the home shell content". This stale
    // MRV2-23 assertion (board above saga) was left unchanged by that card.
    expect(boardZ).toBe(0);
  });
});
