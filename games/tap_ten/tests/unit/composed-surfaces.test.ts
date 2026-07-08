import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { bootGame } from "../../src/main.ts";
import { TAP_TEN_GOAL, TAP_TEN_MAX_MISSES, TAP_TEN_TILE_COUNT } from "../../src/game/tapTen.ts";

const UI_CSS = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../../../packages/ui/src/ui.css"),
  "utf8",
);

function appRoot(): HTMLElement {
  document.body.innerHTML = '<div id="app"></div>';
  return document.getElementById("app")!;
}

function expectEyebrowCenteredWithinRibbon(ribbon: HTMLElement, eyebrow: HTMLElement): void {
  const ribbonBox = ribbon.getBoundingClientRect();
  const eyebrowBox = eyebrow.getBoundingClientRect();

  if (ribbonBox.width > 0 && eyebrowBox.width > 0) {
    const ribbonCenter = ribbonBox.x + ribbonBox.width / 2;
    const eyebrowCenter = eyebrowBox.x + eyebrowBox.width / 2;
    expect(eyebrowBox.x).toBeGreaterThanOrEqual(ribbonBox.x);
    expect(eyebrowBox.x + eyebrowBox.width).toBeLessThanOrEqual(ribbonBox.x + ribbonBox.width);
    expect(Math.abs(eyebrowCenter - ribbonCenter)).toBeLessThanOrEqual(2);
    return;
  }

  expect(UI_CSS).toContain(".fab-modal-ribbon {\n    position: relative;");
  expect(UI_CSS).toContain("left: 0;\n    right: 0;");
  expect(UI_CSS).toContain("margin-inline: auto;");
  expect(UI_CSS).toContain("transform: translateY(-50%);");
}

function expectSpriteRibbon(
  card: HTMLElement,
  opts: { assetName: string; title: string; eyebrow?: string },
): void {
  const ribbon = card.querySelector<HTMLElement>(".fab-modal-ribbon")!;
  expect(ribbon).not.toBeNull();
  expect(Array.from(ribbon.classList).filter((name) => name.startsWith("fab-modal-ribbon--"))).toEqual([]);
  expect(ribbon.style.backgroundImage).toBe("");
  const src = ribbon.querySelector<HTMLImageElement>(".fab-modal-ribbon-image")?.src ?? "";
  expect(src).toMatch(new RegExp(`${opts.assetName}|data:image/svg`));
  const title = ribbon.querySelector<HTMLElement>(".fab-modal-ribbon-title")!;
  expect(title.textContent).toBe(opts.title);
  if (opts.eyebrow !== undefined) {
    const eyebrow = ribbon.querySelector<HTMLElement>(".fab-modal-ribbon-eyebrow")!;
    expect(eyebrow.textContent).toBe(opts.eyebrow);
    expect(eyebrow.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expectEyebrowCenteredWithinRibbon(ribbon, eyebrow);
  }
}

function expectSpriteButton(action: string, assetName: string): void {
  const button = document.querySelector<HTMLButtonElement>(`[data-fab-action="${action}"]`)!;
  expect(button).not.toBeNull();
  expect(button.classList.contains("fab-btn")).toBe(true);
  expect(button.style.getPropertyValue("--fab-btn-sprite-image")).toMatch(new RegExp(`${assetName}|data:image/svg`));
}

describe("tap_ten shared UI kit composed surfaces", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("renders settings, win, and fail with sprite ribbons, live title stack, and sprite buttons", () => {
    const { controller } = bootGame(appRoot());

    controller.openSettings();
    const settings = document.querySelector<HTMLElement>(".tap-ten-surface--settings")!;
    expect(settings).not.toBeNull();
    expect(settings.classList.contains("fab-modal-card--image")).toBe(true);
    expect(settings.style.getPropertyValue("--fab-modal-card-image")).toMatch(/tapten-popup|data:image\/svg/);
    expectSpriteRibbon(settings, { assetName: "tapten-ribbon-neutral", title: "Settings" });
    expect(settings.querySelectorAll(".fab-toggle-row")).toHaveLength(3);
    expectSpriteButton("settings-close", "tapten-button-primary");

    controller.startLevel(1);
    for (let i = 0; i < TAP_TEN_GOAL; i += 1) {
      controller.tapTile(controller.snapshot().litTile);
    }
    const win = document.querySelector<HTMLElement>(".fab-result-card--win")!;
    expect(win).not.toBeNull();
    expect(win.classList.contains("fab-modal-card--image")).toBe(true);
    expect(win.style.getPropertyValue("--fab-modal-card-image")).toMatch(/tapten-popup|data:image\/svg/);
    expectSpriteRibbon(win, { assetName: "tapten-ribbon-win", title: "Ten hits", eyebrow: "LEVEL 1" });
    expectSpriteButton("result-restart", "tapten-button-primary");
    expectSpriteButton("result-menu", "tapten-button-secondary");

    controller.startLevel(1);
    for (let i = 0; i < TAP_TEN_MAX_MISSES; i += 1) {
      controller.tapTile((controller.snapshot().litTile + 1) % TAP_TEN_TILE_COUNT);
    }
    const fail = document.querySelector<HTMLElement>(".fab-result-card--lose")!;
    expect(fail).not.toBeNull();
    expect(fail.classList.contains("fab-modal-card--image")).toBe(true);
    expect(fail.style.getPropertyValue("--fab-modal-card-image")).toMatch(/tapten-popup|data:image\/svg/);
    expectSpriteRibbon(fail, { assetName: "tapten-ribbon-fail", title: "Too many misses", eyebrow: "LEVEL 1" });
    expectSpriteButton("result-retry", "tapten-button-primary");
    expectSpriteButton("result-menu", "tapten-button-secondary");
  });
});
