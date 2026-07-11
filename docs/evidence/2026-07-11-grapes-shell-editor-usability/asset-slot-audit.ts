import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { shellPresentationContract } from "@fabrikav2/kernel";

import { createStarterProject, type SeedManifest } from "../../../tools/grapes-shell/src/shared/project.ts";

const evidenceRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(evidenceRoot, "../../..");
const manifest = JSON.parse(
  await readFile(path.join(repositoryRoot, "games/_template/design/kenney-seed.manifest.json"), "utf8"),
) as SeedManifest;
const roles = new Map(shellPresentationContract.roles.map((role) => [role.id, role]));
const slots = new Map(shellPresentationContract.assetSlots.map((slot) => [slot.id, slot]));
const assets = new Map(manifest.assets.map((asset) => [asset.id, asset]));

function dimensionCompatible(asset: SeedManifest["assets"][number], slotId: string): boolean {
  const slot = slots.get(slotId);
  return Boolean(slot &&
    asset.dimensions.width >= slot.geometry.minWidth && asset.dimensions.width <= slot.geometry.maxWidth &&
    asset.dimensions.height >= slot.geometry.minHeight && asset.dimensions.height <= slot.geometry.maxHeight);
}

const rolePairs = manifest.assets.flatMap((asset) => asset.compatibleRoles.map((roleId) => {
  const slotId = roles.get(roleId)?.assetSlotId ?? null;
  return {
    assetId: asset.id,
    roleId,
    slotId,
    dimensions: asset.dimensions,
    dimensionCompatible: slotId ? dimensionCompatible(asset, slotId) : false,
  };
}));
const crossSlotAssets = manifest.assets.flatMap((asset) => {
  const slotIds = [...new Set(asset.compatibleRoles
    .map((roleId) => roles.get(roleId)?.assetSlotId)
    .filter((slotId): slotId is string => typeof slotId === "string"))].sort();
  return slotIds.length > 1 ? [{ assetId: asset.id, slotIds }] : [];
});

const starterUses = createStarterProject().presentation.pages.flatMap((page) => page.instances.flatMap((instance) => {
  const role = roles.get(instance.roleId);
  const slot = role?.assetSlotId ? slots.get(role.assetSlotId) : undefined;
  const visuals = [
    { variant: "base", assetId: instance.presentation.assetId, fit: instance.presentation.geometry.fit },
    ...Object.entries(instance.variants).map(([variant, presentation]) => ({
      variant,
      assetId: presentation.assetId,
      fit: presentation.geometry?.fit ?? instance.presentation.geometry.fit,
    })),
  ];
  return visuals.flatMap((visual) => {
    if (!visual.assetId) return [];
    const asset = assets.get(visual.assetId);
    return [{
      instanceId: instance.id,
      variant: visual.variant,
      assetId: visual.assetId,
      slotId: role?.assetSlotId ?? null,
      dimensionCompatible: Boolean(asset && role?.assetSlotId && dimensionCompatible(asset, role.assetSlotId)),
      fitCompatible: Boolean(slot && visual.fit === slot.fit),
    }];
  });
}));

process.stdout.write(`${JSON.stringify({
  source: "games/_template/design/kenney-seed.manifest.json",
  authority: "packages/kernel/contracts/shell-presentation.v1.json",
  assets: manifest.assets.length,
  rolePairs: rolePairs.length,
  dimensionInvalidRolePairs: rolePairs.filter((pair) => !pair.dimensionCompatible).length,
  crossSlotAssets,
  starterUses: starterUses.length,
  dimensionInvalidStarterUses: starterUses.filter((use) => !use.dimensionCompatible).length,
  fitInvalidStarterUses: starterUses.filter((use) => !use.fitCompatible).length,
  result: rolePairs.every((pair) => pair.dimensionCompatible) && crossSlotAssets.length === 0 &&
    starterUses.every((use) => use.dimensionCompatible && use.fitCompatible) ? "pass" : "blocked",
}, null, 2)}\n`);
