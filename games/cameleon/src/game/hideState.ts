import type {
  CameleonBodyMode,
  CameleonDirection,
  CameleonHideDefinition,
  CameleonLevelDefinition,
  WorldRect,
} from "./level.ts";

export type HidePhase = "hidden" | "found";
export type HideStateMap = Readonly<Record<string, HidePhase>>;
export type VisibleBodySprite = "painted" | "white" | "off";

export interface HideSpriteView {
  readonly key: string;
  readonly alpha: number;
  readonly visible: boolean;
}

/**
 * CAM-1 hide object API. A hide object is a pair of render sprites bound to one
 * world-space rect and one alpha channel. Art replacement cards may swap the
 * asset behind `painted.key` or `white.key`, but must keep both sprite bounds
 * and alpha in lockstep so `?bodies=painted|white|off` is a render-mode switch,
 * not a second layout. Hit-testing always uses `rect`, independent of which
 * sprite is visible.
 */
export interface HideObjectView {
  readonly id: string;
  readonly rect: WorldRect;
  readonly phase: HidePhase;
  readonly alpha: number;
  readonly bodyMode: CameleonBodyMode;
  readonly visibleBody: VisibleBodySprite;
  readonly painted: HideSpriteView;
  readonly white: HideSpriteView;
  readonly hittable: boolean;
}

export function createHideStateMap(level: CameleonLevelDefinition): HideStateMap {
  return Object.fromEntries(level.hides.map((hide) => [hide.id, "hidden" as const]));
}

export function revealHide(state: HideStateMap, hideId: string): HideStateMap {
  if (!(hideId in state)) throw new Error(`Unknown hide id: ${hideId}`);
  if (state[hideId] === "found") return state;
  return { ...state, [hideId]: "found" };
}

export function hideFoundCount(state: HideStateMap): number {
  return Object.values(state).filter((phase) => phase === "found").length;
}

export function isHideFound(state: HideStateMap, hideId: string): boolean {
  return state[hideId] === "found";
}

export function hideObjectView(
  hide: CameleonHideDefinition,
  phase: HidePhase,
  bodyMode: CameleonBodyMode,
  direction: CameleonDirection,
): HideObjectView {
  const alpha = bodyMode === "off" ? 0 : 1;
  const visibleBody = visibleBodyFor(phase, bodyMode);
  return {
    id: hide.id,
    rect: hide.rect,
    phase,
    alpha,
    bodyMode,
    visibleBody,
    painted: {
      key: hide.spritePair.painted[direction],
      alpha,
      visible: visibleBody === "painted",
    },
    white: {
      key: hide.spritePair.white,
      alpha,
      visible: visibleBody === "white",
    },
    hittable: phase === "hidden",
  };
}

export function hideObjectViews(
  level: CameleonLevelDefinition,
  state: HideStateMap,
  bodyMode: CameleonBodyMode,
  direction: CameleonDirection,
): readonly HideObjectView[] {
  return level.hides.map((hide) => hideObjectView(hide, state[hide.id] ?? "hidden", bodyMode, direction));
}

function visibleBodyFor(phase: HidePhase, bodyMode: CameleonBodyMode): VisibleBodySprite {
  if (bodyMode === "off") return "off";
  if (phase === "found") return "white";
  return bodyMode;
}
