import { describe, expect, it } from "vitest";

import { createStarterProject } from "../../src/shared/project.ts";
import { normalizeSemanticLayout, projectSemanticLayout } from "../../src/shared/layout.ts";

function menuPlay() {
  return createStarterProject().presentation.pages
    .find((page) => page.stateId === "menu")!
    .instances.find((instance) => instance.id === "menu.play")!;
}

describe("semantic canvas layout", () => {
  it("round-trips rendered drag bounds through normalized contract geometry", () => {
    const instance = menuPlay();
    const original = projectSemanticLayout(instance.roleId, instance.presentation.geometry);
    const movedBounds = { ...original, x: original.x + 12, y: original.y - 8 };

    const normalized = normalizeSemanticLayout(
      instance.roleId,
      movedBounds,
      instance.presentation.geometry.fit,
    );

    const projected = projectSemanticLayout(instance.roleId, normalized);
    expect(projected.x).toBeCloseTo(movedBounds.x, 6);
    expect(projected.y).toBeCloseTo(movedBounds.y, 6);
    expect(projected.width).toBeCloseTo(movedBounds.width, 6);
    expect(projected.height).toBeCloseTo(movedBounds.height, 6);
  });

  it("fails closed when a canvas gesture leaves the safe rectangle or violates role caps", () => {
    const instance = menuPlay();
    const original = projectSemanticLayout(instance.roleId, instance.presentation.geometry);

    expect(() => normalizeSemanticLayout(
      instance.roleId,
      { ...original, x: -1 },
      instance.presentation.geometry.fit,
    )).toThrow(/safe|outside/i);
    expect(() => normalizeSemanticLayout(
      instance.roleId,
      { ...original, width: 1 },
      instance.presentation.geometry.fit,
    )).toThrow(/width|minimum|cap/i);
  });
});
