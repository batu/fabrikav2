import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function setViewport(width: number, height: number, devicePixelRatio: number): void {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
  Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: devicePixelRatio });
}

function mockMaxRenderbufferSize(size: number): void {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((contextId: string) => {
    if (contextId !== "webgl" && contextId !== "experimental-webgl") return null;
    return {
      getParameter: () => size,
    } as unknown as WebGLRenderingContext;
  });
}

describe("find_the_dog canvas DPR sizing", () => {
  beforeEach(() => {
    vi.resetModules();
    setViewport(390, 844, 3);
    mockMaxRenderbufferSize(4096);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("renders at native 3x backing size on the iPhone 12 class viewport", async () => {
    const { DPR, GAME } = await import("../../src/core/Constants.ts");

    expect(DPR).toBe(3);
    expect(GAME.WIDTH).toBe(1170);
    expect(GAME.HEIGHT).toBe(2532);
  });

  it("keeps renderbuffer safety clamps alongside the native DPR cap", async () => {
    mockMaxRenderbufferSize(2048);
    vi.resetModules();

    const { DPR, GAME } = await import("../../src/core/Constants.ts");

    expect(DPR).toBeCloseTo(2046 / (844 * 1.5), 5);
    expect(GAME.WIDTH).toBe(Math.round(390 * DPR));
    expect(GAME.HEIGHT).toBe(Math.round(844 * DPR));
  });
});
