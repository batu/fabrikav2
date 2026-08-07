import { describe, expect, it, vi } from "vitest";

vi.mock("phaser", () => ({
  default: { Scene: class {} },
}));

import { BootScene } from "../../src/scenes/BootScene";

interface BootSceneHarness {
  events: { once: (event: string, callback: () => void) => void };
  sys: { isActive: () => boolean };
  scene: { start: (key: string) => void };
  create: () => void;
}

describe("BootScene", () => {
  it("starts HomeScene after Phaser promotes the boot scene from creating to active", async () => {
    let active = false;
    const start = vi.fn();
    const scene = Object.create(BootScene.prototype) as BootSceneHarness;
    scene.events = { once: vi.fn() };
    scene.sys = { isActive: () => active };
    scene.scene = { start };

    scene.create();
    expect(start).not.toHaveBeenCalled();

    active = true;
    await Promise.resolve();

    expect(start).toHaveBeenCalledOnce();
    expect(start).toHaveBeenCalledWith("HomeScene");
  });
});
