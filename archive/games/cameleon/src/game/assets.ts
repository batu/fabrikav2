import {
  CAMELEON_DIRECTIONS,
  type CameleonLevelDefinition,
  type CameleonLevelId,
} from "./level.ts";

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

const PANEL_FILES = ["panel-a", "panel-b", "panel-c"] as const;
const SCREENPRINT_ONLY_LEVEL_IDS = ["bathhouse", "waterpark", "museum"] as const satisfies readonly CameleonLevelId[];
const TEMPORARY_ALIAS_NOTE = "conductor generates gouache/roughrender variants";

const ORGANIC_HIDE_IDS = ["li-01", "li-02", "li-03", "li-04", "li-05", "li-06", "li-07", "li-08", "li-09", "li-10"] as const;
const SCREENPRINT_ONLY_HIDE_IDS = {
  bathhouse: ["bh-01", "bh-02", "bh-03", "bh-04", "bh-05", "bh-06", "bh-07", "bh-08", "bh-09", "bh-10"],
  waterpark: ["sw-01", "sw-02", "sw-03", "sw-04", "sw-05", "sw-06", "sw-07", "sw-08", "sw-09", "sw-10"],
  museum: ["nm-01", "nm-02", "nm-03", "nm-04", "nm-05", "nm-06", "nm-07", "nm-08", "nm-09", "nm-10"],
} as const satisfies Record<(typeof SCREENPRINT_ONLY_LEVEL_IDS)[number], readonly string[]>;

const LIDO_PANEL_ASSETS = CAMELEON_DIRECTIONS.flatMap((direction) =>
  PANEL_FILES.map((panelFile) =>
    asset(`lido.${direction}.${panelFile}`, "panel", `levels/lido/panels/${direction}/${panelFile}.png`)
  )
);

const SCREENPRINT_ONLY_PANEL_ASSETS = SCREENPRINT_ONLY_LEVEL_IDS.flatMap((levelId) =>
  CAMELEON_DIRECTIONS.flatMap((direction) =>
    PANEL_FILES.map((panelFile) => {
      const screenprintKey = `${levelId}.screenprint.${panelFile}`;
      return asset(
        `${levelId}.${direction}.${panelFile}`,
        "panel",
        `levels/${levelId}/panels/screenprint/${panelFile}.png`,
        direction === "screenprint" ? {} : temporaryAlias(screenprintKey),
      );
    })
  )
);

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
];

const SCREENPRINT_ONLY_HIDE_ASSETS = SCREENPRINT_ONLY_LEVEL_IDS.flatMap((levelId) =>
  SCREENPRINT_ONLY_HIDE_IDS[levelId].flatMap((hideId) => [
    ...CAMELEON_DIRECTIONS.map((direction) => {
      const screenprintKey = `${levelId}.screenprint.${hideId}.painted`;
      return asset(
        `${levelId}.${direction}.${hideId}.painted`,
        "hide-painted",
        `levels/${levelId}/sprites/screenprint/${hideId}-painted.png`,
        direction === "screenprint" ? {} : temporaryAlias(screenprintKey),
      );
    }),
    asset(`${levelId}.${hideId}.white`, "hide-white", `levels/${levelId}/sprites/white/${hideId}-white.png`),
  ])
);

const LIDO_DECOY_ASSETS = [
  asset("lido.screenprint.host-blank-sign", "decoy", "levels/lido/sprites/screenprint/host-blank-sign.png"),
  asset("lido.screenprint.host-swim-poster", "decoy", "levels/lido/sprites/screenprint/host-swim-poster.png"),
  asset("lido.screenprint.host-aframe", "decoy", "levels/lido/sprites/screenprint/host-aframe.png"),
  asset("bathhouse.screenprint.host-empty-arch", "decoy", "levels/bathhouse/sprites/screenprint/host-empty-arch.png"),
  asset("bathhouse.screenprint.host-brass-plaque", "decoy", "levels/bathhouse/sprites/screenprint/host-brass-plaque.png"),
  asset("waterpark.screenprint.host-safety-poster", "decoy", "levels/waterpark/sprites/screenprint/host-safety-poster.png"),
  asset("museum.screenprint.host-vintage-poster", "decoy", "levels/museum/sprites/screenprint/host-vintage-poster.png"),
  asset("museum.screenprint.host-sepia-photo", "decoy", "levels/museum/sprites/screenprint/host-sepia-photo.png"),
] as const;

const LIDO_OVERLAY_ASSETS = [
  asset("lido.screenprint.seam-pillar-deck", "overlay", "levels/lido/sprites/screenprint/seam-pillar-deck.png"),
] as const;

const CAMELEON_LIDO_ASSETS = [
  ...LIDO_PANEL_ASSETS,
  ...LIDO_HIDE_ASSETS,
  ...LIDO_DECOY_ASSETS,
  ...LIDO_OVERLAY_ASSETS,
] as const satisfies readonly CameleonAssetEntry[];

const CAMELEON_ASSETS = [
  ...CAMELEON_LIDO_ASSETS,
  ...SCREENPRINT_ONLY_PANEL_ASSETS,
  ...SCREENPRINT_ONLY_HIDE_ASSETS,
] as const satisfies readonly CameleonAssetEntry[];

const ASSETS_BY_KEY = new Map(CAMELEON_ASSETS.map((entry) => [entry.key, entry]));

export function resolveCameleonAsset(key: string): CameleonAssetEntry {
  const entry = ASSETS_BY_KEY.get(key);
  if (!entry) throw new Error(`Unknown Cameleon asset key: ${key}`);
  return entry;
}

function assetKeysForLevel(level: CameleonLevelDefinition): readonly string[] {
  const keys = new Set<string>();
  for (const direction of CAMELEON_DIRECTIONS) {
    for (const key of level.assetKeys.zonePanels[direction]) keys.add(key);
  }
  for (const hide of level.hides) {
    keys.add(hide.spritePair.white);
    for (const direction of CAMELEON_DIRECTIONS) keys.add(hide.spritePair.painted[direction]);
  }
  for (const decoy of level.decoys) {
    if (decoy.spriteKey) keys.add(decoy.spriteKey);
  }
  for (const overlay of level.visualOverlays) keys.add(overlay.spriteKey);
  return [...keys].sort();
}

export function assetEntriesForLevel(level: CameleonLevelDefinition): readonly CameleonAssetEntry[] {
  return assetKeysForLevel(level).map((key) => resolveCameleonAsset(key));
}

function temporaryAlias(aliasOf: string): Pick<CameleonAssetEntry, "aliasOf" | "temporary" | "note"> {
  return {
    aliasOf,
    temporary: true,
    note: TEMPORARY_ALIAS_NOTE,
  };
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
