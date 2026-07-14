import {
  normalizeShellGeometry,
  projectShellGeometry,
  shellPresentationContractV2,
  type ShellFitMode,
  type ShellNormalizedGeometry,
  type ShellRect,
  type ShellViewport,
} from "@fabrikav2/kernel";

const baselineShellViewport: ShellViewport = {
  width: shellPresentationContractV2.canonicalCanvas.width,
  height: shellPresentationContractV2.canonicalCanvas.height,
  insets: { ...shellPresentationContractV2.canonicalCanvas.baselineInsets },
};

export function projectSemanticLayout(roleId: string, geometry: ShellNormalizedGeometry): ShellRect {
  const role = shellPresentationContractV2.roles.find((candidate) => candidate.id === roleId);
  if (!role) throw new RangeError(`Unknown semantic role "${roleId}".`);
  return projectShellGeometry({
    anchor: role.anchor,
    geometry,
    viewport: baselineShellViewport,
    caps: role.geometryCaps,
  }).bounds;
}

export function normalizeSemanticLayout(
  roleId: string,
  bounds: ShellRect,
  fit: ShellFitMode,
): ShellNormalizedGeometry {
  const role = shellPresentationContractV2.roles.find((candidate) => candidate.id === roleId);
  if (!role) throw new RangeError(`Unknown semantic role "${roleId}".`);
  const safeRect: ShellRect = {
    x: baselineShellViewport.insets.left,
    y: baselineShellViewport.insets.top,
    width: baselineShellViewport.width - baselineShellViewport.insets.left - baselineShellViewport.insets.right,
    height: baselineShellViewport.height - baselineShellViewport.insets.top - baselineShellViewport.insets.bottom,
  };
  const epsilon = 1e-8;
  if (
    role.requiredSafeBounds &&
    (bounds.x < safeRect.x - epsilon ||
      bounds.y < safeRect.y - epsilon ||
      bounds.x + bounds.width > safeRect.x + safeRect.width + epsilon ||
      bounds.y + bounds.height > safeRect.y + safeRect.height + epsilon)
  ) {
    throw new RangeError(`Semantic role "${roleId}" must remain inside the safe rectangle.`);
  }
  if (bounds.width < role.geometryCaps.minWidth || bounds.width > role.geometryCaps.maxWidth) {
    throw new RangeError(`Semantic role "${roleId}" width violates its geometry cap.`);
  }
  if (bounds.height < role.geometryCaps.minHeight || bounds.height > role.geometryCaps.maxHeight) {
    throw new RangeError(`Semantic role "${roleId}" height violates its geometry cap.`);
  }
  const geometry = normalizeShellGeometry({
    anchor: role.anchor,
    bounds,
    viewport: baselineShellViewport,
    fit,
  });
  return geometry;
}
