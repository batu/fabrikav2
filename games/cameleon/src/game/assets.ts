import { CAMELEON_DIRECTIONS, type CameleonLevelDefinition } from "./level.ts";

export type CameleonAssetKind = "panel" | "hide-painted" | "hide-white" | "decoy" | "overlay";

export interface CameleonAssetEntry {
  readonly key: string;
  readonly kind: CameleonAssetKind;
  readonly publicPath: string;
  readonly url: string;
  readonly aliasOf?: string;
  readonly temporary?: boolean;
  readonly note?: string;
}

const PANEL_ALIAS_NOTE =
  "TODO(cHf5RquT): conductor generates riso/night panels after device proof; aliases are approved only for this temporary panel gap.";

const ORGANIC_HIDE_IDS = ["li-01", "li-03", "li-04", "li-05", "li-09"] as const;
const SIGN_HIDE_FILES = {
  "li-02": "li-02-no-diving",
  "li-06": "li-06-lane-rope",
  "li-07": "li-07-fifth-poster-figure",
  "li-08": "li-08-slipping-man",
  "li-10": "li-10-soft-serve-mascot",
} as const;

const LIDO_PANEL_ASSETS = [
  asset("lido.poster.panel-a", "panel", "levels/lido/panels/poster/panel-a.png"),
  asset("lido.poster.panel-b", "panel", "levels/lido/panels/poster/panel-b.png"),
  asset("lido.poster.panel-c", "panel", "levels/lido/panels/poster/panel-c.png"),
  asset("lido.riso.panel-a", "panel", "levels/lido/panels/poster/panel-a.png", {
    aliasOf: "lido.poster.panel-a",
    temporary: true,
    note: PANEL_ALIAS_NOTE,
  }),
  asset("lido.riso.panel-b", "panel", "levels/lido/panels/poster/panel-b.png", {
    aliasOf: "lido.poster.panel-b",
    temporary: true,
    note: PANEL_ALIAS_NOTE,
  }),
  asset("lido.riso.panel-c", "panel", "levels/lido/panels/poster/panel-c.png", {
    aliasOf: "lido.poster.panel-c",
    temporary: true,
    note: PANEL_ALIAS_NOTE,
  }),
  asset("lido.night.panel-a", "panel", "levels/lido/panels/poster/panel-a.png", {
    aliasOf: "lido.poster.panel-a",
    temporary: true,
    note: PANEL_ALIAS_NOTE,
  }),
  asset("lido.night.panel-b", "panel", "levels/lido/panels/poster/panel-b.png", {
    aliasOf: "lido.poster.panel-b",
    temporary: true,
    note: PANEL_ALIAS_NOTE,
  }),
  asset("lido.night.panel-c", "panel", "levels/lido/panels/poster/panel-c.png", {
    aliasOf: "lido.poster.panel-c",
    temporary: true,
    note: PANEL_ALIAS_NOTE,
  }),
] as const;

const LIDO_HIDE_ASSETS = [
  ...ORGANIC_HIDE_IDS.flatMap((hideId) => [
    ...CAMELEON_DIRECTIONS.map((direction) =>
      asset(
        `lido.${direction}.${hideId}.painted`,
        "hide-painted",
        `levels/lido/sprites/${direction}/${hideId}-painted-organic.png`,
      )
    ),
    asset(`lido.${hideId}.white`, "hide-white", `levels/lido/sprites/white/${hideId}-white-organic.png`),
  ]),
  ...Object.entries(SIGN_HIDE_FILES).flatMap(([hideId, fileName]) => [
    ...CAMELEON_DIRECTIONS.map((direction) =>
      asset(
        `lido.${direction}.${hideId}.painted`,
        "hide-painted",
        `levels/lido/sprites/${direction}/${fileName}-painted.png`,
      )
    ),
    asset(`lido.${hideId}.white`, "hide-white", `levels/lido/sprites/white/${fileName}-white.png`),
  ]),
] as const;

const LIDO_DECOY_ASSETS = [
  asset("lido.poster.decoy-rules-board", "decoy", "levels/lido/sprites/poster/decoy-rules-board.png"),
  asset("lido.poster.decoy-no-running-sign", "decoy", "levels/lido/sprites/poster/decoy-no-running-sign.png"),
  asset("lido.poster.decoy-depth-markers", "decoy", "levels/lido/sprites/poster/decoy-depth-markers.png"),
  asset("lido.poster.decoy-swim-school-poster", "decoy", "levels/lido/sprites/poster/decoy-swim-school-poster.png"),
  asset("lido.poster.decoy-wet-floor-aframe", "decoy", "levels/lido/sprites/poster/decoy-wet-floor-aframe.png"),
  asset("lido.poster.decoy-kiosk-mascot-panel", "decoy", "levels/lido/sprites/poster/decoy-kiosk-mascot-panel.png"),
  asset("lido.poster.decoy-tent", "decoy", "levels/lido/sprites/poster/decoy-tent.png"),
  asset("lido.poster.decoy-robe", "decoy", "levels/lido/sprites/poster/decoy-robe.png"),
  asset("lido.poster.decoy-bodyprint-towel", "decoy", "levels/lido/sprites/poster/decoy-bodyprint-towel.png"),
  asset("lido.poster.decoy-ringstack", "decoy", "levels/lido/sprites/poster/decoy-ringstack.png"),
] as const;

const LIDO_OVERLAY_ASSETS = [
  asset("lido.poster.seam-pillar-deck", "overlay", "levels/lido/sprites/poster/seam-pillar-deck.png"),
] as const;

export const CAMELEON_LIDO_ASSETS = [
  ...LIDO_PANEL_ASSETS,
  ...LIDO_HIDE_ASSETS,
  ...LIDO_DECOY_ASSETS,
  ...LIDO_OVERLAY_ASSETS,
] as const satisfies readonly CameleonAssetEntry[];

const ASSETS_BY_KEY = new Map(CAMELEON_LIDO_ASSETS.map((entry) => [entry.key, entry]));

export function resolveCameleonAsset(key: string): CameleonAssetEntry {
  const entry = ASSETS_BY_KEY.get(key);
  if (!entry) throw new Error(`Unknown Cameleon asset key: ${key}`);
  return entry;
}

export function assetKeysForLevel(level: CameleonLevelDefinition): readonly string[] {
  const keys = new Set<string>();
  for (const direction of CAMELEON_DIRECTIONS) {
    for (const key of level.assetKeys.zonePanels[direction]) keys.add(key);
  }
  for (const hide of level.hides) {
    keys.add(hide.spritePair.white);
    for (const direction of CAMELEON_DIRECTIONS) keys.add(hide.spritePair.painted[direction]);
  }
  for (const decoy of level.decoys) keys.add(decoy.spriteKey);
  for (const overlay of level.visualOverlays) keys.add(overlay.spriteKey);
  return [...keys].sort();
}

export function assetEntriesForLevel(level: CameleonLevelDefinition): readonly CameleonAssetEntry[] {
  return assetKeysForLevel(level).map((key) => resolveCameleonAsset(key));
}

function asset(
  key: string,
  kind: CameleonAssetKind,
  publicPath: string,
  opts: Omit<CameleonAssetEntry, "key" | "kind" | "publicPath" | "url"> = {},
): CameleonAssetEntry {
  return {
    key,
    kind,
    publicPath,
    url: `/${publicPath}`,
    ...opts,
  };
}
