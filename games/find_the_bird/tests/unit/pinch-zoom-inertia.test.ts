import { describe, expect, it, vi } from "vitest";

vi.mock("phaser", () => ({
  default: {
    Input: { Events: {} },
    Math: { Clamp: (value: number, min: number, max: number) => Math.min(max, Math.max(min, value)) },
  },
}));

import { stepPanInertiaAxis } from "../../src/scenes/PinchZoom";

describe("pan inertia", () => {
  it("continues moving after release while smoothly slowing down", () => {
    const first = stepPanInertiaAxis(100, 1, 16, 0, 500);
    const second = stepPanInertiaAxis(first.position, first.velocity, 16, 0, 500);

    expect(first.position).toBeGreaterThan(100);
    expect(second.position).toBeGreaterThan(first.position);
    expect(Math.abs(first.velocity)).toBeLessThan(1);
    expect(Math.abs(second.velocity)).toBeLessThan(Math.abs(first.velocity));
  });

  it("stops at the artwork edge instead of exposing a gutter", () => {
    const result = stepPanInertiaAxis(495, 2, 16, 0, 500);

    expect(result).toEqual({ position: 500, velocity: 0 });
  });

  it("settles small residual movement instead of drifting forever", () => {
    const result = stepPanInertiaAxis(100, 0.005, 16, 0, 500);

    expect(result).toEqual({ position: 100, velocity: 0 });
  });
});
