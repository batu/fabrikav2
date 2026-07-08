import { assets } from "./assets.ts";

function assetUrl(assetId: string): string {
  return new URL(`./assets/${assetId}.svg`, import.meta.url).href;
}

export const assetUrls = {
  ribbonWin: assetUrl(assets.result.ribbonWin),
  ribbonFail: assetUrl(assets.result.ribbonFail),
} as const;
