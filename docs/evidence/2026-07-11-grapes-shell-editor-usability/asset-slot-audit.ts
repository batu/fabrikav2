import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseShellPresentation, shellPresentationContract } from "@fabrikav2/kernel";

import { createStarterProject, validateProjectFile } from "../../../tools/grapes-shell/src/shared/project.ts";
import { readSeedManifest } from "../../../tools/grapes-shell/src/shared/seed.ts";

// Regenerated after the U1/U2 asset-authority repair. The prior audit measured a
// parallel `compatibleRoles` registry against slot geometry and found 39/40
// role pairs and all 33 starter uses invalid. That bypass is gone: U1's canonical
// asset catalog (embedded in the U2 manifest) is now the single authority, every
// asset targets exactly one slot, and U3 validates the starter through
// parseShellPresentation(..., { assetCatalog }). This audit proves the fix.
const evidenceRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(evidenceRoot, "../../..");
const seedRoot = path.join(repositoryRoot, "games/_template/design");

const catalog = await readSeedManifest(seedRoot);
const roles = new Map(shellPresentationContract.roles.map((role) => [role.id, role]));
const slots = new Map(shellPresentationContract.assetSlots.map((slot) => [slot.id, slot]));
const assetById = new Map(catalog.assets.map((asset) => [asset.id, asset]));

const starter = createStarterProject();

// Every catalog asset must target a real contract slot (single-slot by construction).
const unknownSlotAssets = catalog.assets.filter((asset) => !slots.has(asset.slotId)).map((asset) => asset.id);

const starterUses = starter.presentation.pages.flatMap((page) =>
  page.instances.flatMap((instance) => {
    const role = roles.get(instance.roleId);
    const roleSlotId = role?.assetSlotId ?? null;
    const slot = roleSlotId ? slots.get(roleSlotId) : undefined;
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
      const asset = assetById.get(visual.assetId);
      return [
        {
          instanceId: instance.id,
          variant: visual.variant,
          assetId: visual.assetId,
          roleSlotId,
          assetSlotId: asset?.slotId ?? null,
          known: Boolean(asset),
          slotCompatible: Boolean(asset && roleSlotId && asset.slotId === roleSlotId),
          fitCompatible: Boolean(slot && asset && visual.fit === slot.fit),
        },
      ];
    });
  }),
);

// The real gate: U1 accepts the starter project against the canonical catalog.
let closedAstResult: "pass" | "fail" = "pass";
let closedAstError: string | undefined;
try {
  validateProjectFile(starter, catalog);
  parseShellPresentation(starter.presentation, { assetCatalog: catalog });
} catch (error) {
  closedAstResult = "fail";
  closedAstError = error instanceof Error ? error.message : String(error);
}

const unknownStarterUses = starterUses.filter((use) => !use.known).length;
const slotInvalidStarterUses = starterUses.filter((use) => !use.slotCompatible).length;
const fitInvalidStarterUses = starterUses.filter((use) => !use.fitCompatible).length;

process.stdout.write(
  `${JSON.stringify(
    {
      source: "games/_template/design/kenney-seed.manifest.json",
      authority: "packages/kernel/contracts/shell-presentation.v1.json",
      catalogAssets: catalog.assets.length,
      slots: [...new Set(catalog.assets.map((asset) => asset.slotId))].sort(),
      unknownSlotAssets,
      starterUses: starterUses.length,
      unknownStarterUses,
      slotInvalidStarterUses,
      fitInvalidStarterUses,
      closedAstResult,
      ...(closedAstError ? { closedAstError } : {}),
      result:
        unknownSlotAssets.length === 0 &&
        unknownStarterUses === 0 &&
        slotInvalidStarterUses === 0 &&
        fitInvalidStarterUses === 0 &&
        closedAstResult === "pass"
          ? "pass"
          : "blocked",
    },
    null,
    2,
  )}\n`,
);
