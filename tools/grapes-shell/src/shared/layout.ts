import {
  projectShellGeometry,
  shellPresentationContract,
  type ShellNormalizedGeometry,
  type ShellRect,
  type ShellViewport,
} from "@fabrikav2/kernel";

const baselineShellViewport: ShellViewport = {
  width: shellPresentationContract.canonicalCanvas.width,
  height: shellPresentationContract.canonicalCanvas.height,
  insets: { ...shellPresentationContract.canonicalCanvas.baselineInsets },
};

export function projectSemanticLayout(roleId: string, geometry: ShellNormalizedGeometry): ShellRect {
  const role = shellPresentationContract.roles.find((candidate) => candidate.id === roleId);
  if (!role) throw new RangeError(`Unknown semantic role "${roleId}".`);
  return projectShellGeometry({
    anchor: role.anchor,
    geometry,
    viewport: baselineShellViewport,
    caps: role.geometryCaps,
  }).bounds;
}
