import { assets } from "./assets.ts";

function svgAssetUrl(assetId: string): string {
  return new URL(`./assets/${assetId}.svg`, import.meta.url).href;
}

function pngAssetUrl(assetId: string): string {
  return new URL(`./assets/${assetId}.png`, import.meta.url).href;
}

export const assetUrls = {
  backgroundTile: pngAssetUrl(assets.gameplay.backgroundTile),
  blockTiles: [
    pngAssetUrl(assets.gameplay.blockTileEmerald),
    pngAssetUrl(assets.gameplay.blockTileAzure),
    pngAssetUrl(assets.gameplay.blockTileAmber),
    pngAssetUrl(assets.gameplay.blockTileRuby),
    pngAssetUrl(assets.gameplay.blockTileMagenta),
    pngAssetUrl(assets.gameplay.blockTileViolet),
    pngAssetUrl(assets.gameplay.blockTileTeal),
  ],
  ribbonWin: svgAssetUrl(assets.result.ribbonWin),
  ribbonFail: svgAssetUrl(assets.result.ribbonFail),
} as const;
