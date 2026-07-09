import { containsPoint, type CameleonDecoyDefinition, type CameleonHideDefinition, type CameleonLevelDefinition } from "./level.ts";
import { isHideFound, type HideStateMap } from "./hideState.ts";

export interface WorldPoint {
  readonly x: number;
  readonly y: number;
}

export type HitTestResult =
  | { readonly kind: "hide"; readonly hide: CameleonHideDefinition }
  | { readonly kind: "decoy"; readonly decoy: CameleonDecoyDefinition }
  | { readonly kind: "miss" };

export function hitTestLevel(
  level: CameleonLevelDefinition,
  point: WorldPoint,
  hideState: HideStateMap,
): HitTestResult {
  const hide = topmost(level.hides, (candidate) => !isHideFound(hideState, candidate.id) && containsPoint(candidate.rect, point));
  if (hide) return { kind: "hide", hide };

  const decoy = topmost(level.decoys, (candidate) => containsPoint(candidate.rect, point));
  if (decoy) return { kind: "decoy", decoy };

  return { kind: "miss" };
}

function topmost<T>(items: readonly T[], predicate: (item: T) => boolean): T | undefined {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item !== undefined && predicate(item)) return item;
  }
  return undefined;
}
