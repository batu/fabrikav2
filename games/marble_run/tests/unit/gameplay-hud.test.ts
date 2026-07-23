import { beforeEach, describe, expect, it, vi } from "vitest";
import { GameHud } from "../../src/gameplay/hud";
import { HINT_COIN_COST } from "../../src/three/constants";

function mount(coins: number, hearts = 5) {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const onHint = vi.fn();
  const onSettings = vi.fn();
  const hud = new GameHud(root, { onHint, onSettings });
  hud.showGameHud(1, hearts, hearts, coins);
  return { root, hud, onHint, onSettings };
}

describe("GameHud", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("renders N heart glyphs for N hearts and marks them dead on loss", () => {
    const { root, hud } = mount(0, 5);
    const hearts = root.querySelectorAll(".hearts-content > span");
    expect(hearts).toHaveLength(5);

    hud.setHearts(3);
    const dead = root.querySelectorAll(".hearts-content > span.dead");
    expect(dead).toHaveLength(2);
    // The dead ones are the trailing pips.
    expect(hearts[3].classList.contains("dead")).toBe(true);
    expect(hearts[4].classList.contains("dead")).toBe(true);
  });

  it("disables the hint button below the coin cost and enables it at/above", () => {
    const { root, hud, onHint } = mount(HINT_COIN_COST - 1);
    const hintBtn = root.querySelector<HTMLButtonElement>("[data-a=hint]")!;
    expect(hintBtn.disabled).toBe(true);

    hud.setCoins(HINT_COIN_COST);
    expect(hintBtn.disabled).toBe(false);

    hintBtn.click();
    expect(onHint).toHaveBeenCalledTimes(1);
  });

  it("reflects the injected coin value and updates on change", () => {
    const { root, hud } = mount(42);
    const value = root.querySelector(".game-coin-counter .vida-counter-value")!;
    expect(value.textContent).toBe("42");
    hud.setCoins(999);
    expect(value.textContent).toBe("999");
  });

  it("invokes the settings-modal opener on the settings button", () => {
    const { root, onSettings } = mount(0);
    root.querySelector<HTMLButtonElement>("[data-a=settings]")!.click();
    expect(onSettings).toHaveBeenCalledTimes(1);
  });

  it("removes its DOM nodes on dispose", () => {
    const { root, hud } = mount(0);
    expect(root.querySelector(".mr-gameplay-screen")).not.toBeNull();
    hud.dispose();
    expect(root.querySelector(".mr-gameplay-screen")).toBeNull();
  });

  it("only pops a streak label at streak >= 3", () => {
    const { root, hud } = mount(0);
    hud.popStreak(2);
    expect(root.querySelector(".streak")).toBeNull();
    hud.popStreak(5);
    expect(root.querySelector(".streak")?.textContent).toContain("x5");
  });

  // MRV2-9 U1: the vida coin pill renders the coin icon BEFORE the value.
  it("renders the coin icon before the value in the currency pill", () => {
    const { root } = mount(42);
    const content = root.querySelector(".game-coin-counter .vida-counter-content")!;
    const children = Array.from(content.children);
    const iconIndex = children.findIndex((c) => c.classList.contains("vida-counter-coin"));
    const valueIndex = children.findIndex((c) => c.classList.contains("vida-counter-value"));
    expect(iconIndex).toBeGreaterThanOrEqual(0);
    expect(valueIndex).toBeGreaterThan(iconIndex);
  });

  describe("showTutorialHand (v1 teach parity)", () => {
    it("renders the v1 spotlight, ring, and emoji hand at the projected target", () => {
      const { hud } = mount(0);
      const el = hud.showTutorialHand({ x: 100, y: 200 })!;
      expect(el).not.toBeNull();
      expect(el.style.getPropertyValue("--tx")).toBe("100px");
      expect(el.style.getPropertyValue("--ty")).toBe("200px");
      expect(el.querySelector(".tutorial-spotlight")).not.toBeNull();
      expect(el.querySelector(".tutorial-ring")).not.toBeNull();
      const hand = el.querySelector(".tutorial-hand");
      expect(hand).not.toBeNull();
      expect(hand?.textContent).toBe("\u{1F446}");
      expect(hand?.getAttribute("aria-hidden")).toBe("true");
    });
  });
});
