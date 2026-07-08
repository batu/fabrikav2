import type { LevelMapNode } from "@fabrikav2/ui";
import { PACKS, RECIPES } from "../game/levels-data.js";
import { packCompleted, type Progress } from "../game/persist.js";

export const ARROW_PACK = "all";

export function buildSagaNodes(progress: Progress, packSlug = ARROW_PACK): LevelMapNode[] {
  const pack = PACKS.find((entry) => entry.slug === packSlug) ?? PACKS[0];
  if (!pack) return [];
  const completed = Math.max(0, packCompleted(progress, pack.slug));
  return pack.indices
    .map((recipeIndex) => {
      const recipe = RECIPES[recipeIndex];
      const indexInPack = recipe?.meta.indexInPack ?? recipeIndex + 1;
      const title = recipe?.meta.title;
      return {
        id: recipeIndex + 1,
        label: String(indexInPack),
        name: title ? `${indexInPack} ${title}` : String(indexInPack),
        state:
          indexInPack <= completed
            ? "completed"
            : indexInPack === completed + 1
              ? "current"
              : "locked",
      } satisfies LevelMapNode;
    })
    .sort((a, b) => Number(a.label) - Number(b.label));
}

export function isSagaLevelOpen(progress: Progress, levelId: number, packSlug = ARROW_PACK): boolean {
  const recipe = RECIPES[levelId - 1];
  if (!recipe || recipe.meta.pack !== packSlug) return false;
  return recipe.meta.indexInPack <= packCompleted(progress, packSlug) + 1;
}
