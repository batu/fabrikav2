import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMageMasterController } from "../../src/game/MageMasterController.ts";
import { mountMageMasterScreen } from "../../src/shell/MageMasterScreen.ts";

// Phaser cannot boot under happy-dom; the battle page is device-verified.
vi.mock("../../src/battle/BattleScene.ts", () => ({
  createBattleRenderer: () => ({ destroy() {}, captureFrames: async () => [], canvas: null }),
}));

function click(root: HTMLElement, action: string): void {
  const target = root.querySelector<HTMLButtonElement>(`[data-fab-action="${action}"]`);
  if (!target) throw new Error(`missing action ${action}`);
  expect(target.disabled).toBe(false);
  target.click();
}

describe("mage master shell", () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  beforeEach(() => {
    (globalThis as { localStorage?: { clear?: () => void } }).localStorage?.clear?.();
    document.body.innerHTML = '<div id="app"></div>';
  });

  it("boots at home with the party, ladder, and play button", () => {
    const controller = createMageMasterController({ env: "test", storageKey: "test-shell-a" });
    const screen = mountMageMasterScreen({ mountInto: document.getElementById("app")!, controller });
    expect(screen.root.dataset.fabState).toBe("menu");
    expect(screen.root.querySelectorAll(".mm-party__mage").length).toBe(3);
    expect(screen.root.querySelector('[data-fab-action="play"]')).not.toBeNull();
    expect(screen.root.querySelector('[data-fab-action="level-1"]')).not.toBeNull();
    screen.destroy();
  });

  it("rift: pull opens the reveal, use equips, discard pays gold", () => {
    const controller = createMageMasterController({ env: "test", storageKey: "test-shell-b", seed: () => 42 });
    const screen = mountMageMasterScreen({ mountInto: document.getElementById("app")!, controller });
    click(screen.root, "nav-rift");
    expect(screen.root.dataset.fabState).toBe("rift");
    expect(screen.root.querySelectorAll(".mm-odds__row").length).toBeGreaterThan(2);
    vi.useFakeTimers();
    click(screen.root, "pull");
    expect(controller.snapshot().pending).not.toBeNull();
    expect(screen.root.querySelector("#mm-reveal")).toBeNull();
    vi.advanceTimersByTime(600);
    expect(screen.root.querySelector("#mm-reveal")).not.toBeNull();
    const pending = controller.snapshot().pending!;
    click(screen.root, "reveal-use");
    expect(controller.snapshot().pending).toBeNull();
    expect(screen.root.querySelector("#mm-reveal")).toBeNull();
    expect(controller.snapshot().loadout[pending.cls][pending.slot].id).toBe(pending.id);
    const goldBefore = controller.snapshot().gold;
    click(screen.root, "pull");
    vi.advanceTimersByTime(600);
    click(screen.root, "reveal-discard");
    expect(controller.snapshot().gold).toBeGreaterThan(goldBefore);
    screen.destroy();
  });

  it("rift upgrade shows the timer and gems skip it", () => {
    let now = 1_000_000;
    const controller = createMageMasterController({ env: "test", storageKey: "test-shell-c", now: () => now });
    controller.grantResources({ gold: 500 });
    const screen = mountMageMasterScreen({ mountInto: document.getElementById("app")!, controller });
    click(screen.root, "nav-rift");
    click(screen.root, "upgrade-rift");
    expect(controller.snapshot().riftUpgradeRemaining).toBe(30);
    now += 5000;
    screen.refresh();
    const skip = screen.root.querySelector<HTMLButtonElement>('[data-fab-action="skip-upgrade"]')!;
    expect(skip.hidden).toBe(false);
    skip.click();
    expect(controller.snapshot().riftTier).toBe(1);
    screen.destroy();
  });

  it("mages page lists three mages with two slots each and opens item detail", () => {
    const controller = createMageMasterController({ env: "test", storageKey: "test-shell-d" });
    const screen = mountMageMasterScreen({ mountInto: document.getElementById("app")!, controller });
    click(screen.root, "nav-mages");
    expect(screen.root.querySelectorAll(".mm-mage").length).toBe(3);
    expect(screen.root.querySelectorAll(".mm-slot").length).toBe(6);
    click(screen.root, "slot-warrior-weapon");
    expect(screen.root.querySelector("#mm-item")).not.toBeNull();
    click(screen.root, "item-close");
    expect(screen.root.querySelector("#mm-item")).toBeNull();
    screen.destroy();
  });

  it("settings opens from home and closes back to home", () => {
    const controller = createMageMasterController({ env: "test", storageKey: "test-shell-e" });
    const screen = mountMageMasterScreen({ mountInto: document.getElementById("app")!, controller });
    click(screen.root, "nav-settings");
    expect(screen.root.dataset.fabState).toBe("settings");
    expect(screen.root.querySelector("#mm-settings")).not.toBeNull();
    click(screen.root, "back");
    expect(controller.snapshot().surface).toBe("menu");
    screen.destroy();
  });

  it("battle → headless win → result card → next level", () => {
    const controller = createMageMasterController({ env: "test", storageKey: "test-shell-f", seed: () => 7 });
    const screen = mountMageMasterScreen({ mountInto: document.getElementById("app")!, controller });
    click(screen.root, "play");
    expect(controller.snapshot().surface).toBe("battle");
    expect(screen.root.querySelectorAll(".mm-hud__mage").length).toBe(3);
    click(screen.root, "pause");
    expect(screen.root.querySelector("#mm-pause")).not.toBeNull();
    click(screen.root, "pause-resume");
    expect(controller.resolveBattle("win")).toBe(true);
    expect(controller.snapshot().surface).toBe("win");
    expect(screen.root.querySelector("#mm-win")).not.toBeNull();
    click(screen.root, "result-next");
    expect(controller.snapshot().level).toBe(2);
    expect(controller.snapshot().surface).toBe("battle");
    screen.destroy();
  });
});
