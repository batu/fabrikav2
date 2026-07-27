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
    expect(css).toMatch(/@media \(min-height: 801px\) and \(max-height: 900px\)[^{]*\{[\s\S]*?max-height: min\(16vh, 140px\)/);
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

  it("uses cream toggle knobs and keeps CLOSE padded inside the card", () => {
    const css = shellArtCss();
    expect(css).toMatch(/\.marble-ui \.fab-toggle-slider::before \{ background: #fff4dc; \}/);
    const card = css.match(/\.marble-ui \.marble-settings-card\.fab-modal-card--image \{[^}]*\}/);
    expect(card?.[0]).toContain("padding: 104px 42px 34px");
    expect(css).toMatch(/\.marble-settings-modal--menu \.fab-modal-actions \{[^}]*padding-bottom: 4px/);
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
