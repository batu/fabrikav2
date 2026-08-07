import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assets } from "../../design/assets";

const REQUIRED_RESKIN_ASSET_IDS = [
  "achievement-birds",
  "achievement-completion",
  "achievement-shortcut-runtime",
  "achievement-mastery",
  "achievement-progression",
  "achievement-streak",
  "back_button",
  "background-feather",
  "button-olive-9s",
  "button-sky-9s",
  "canvas-cream-seamless",
  "dog-detective-complete",
  "dog-detective-crying",
  "dog-detective-openai",
  "home-banner-mascot-runtime",
  "icon_coin",
  "icon_heart",
  "icon_streak_flame",
  "icon_hint_magnifier",
  "icon_settings_gear",
  "level-complete-title",
  "level-node-complete-runtime",
  "level-node-current-teal-runtime",
  "level-node-locked-bones-runtime",
  "level-node-locked-runtime",
  "magnifier-runtime",
  "nav-bar-3",
  "nav-bar-4",
  "nav-bar-5",
  "no-ads-runtime",
  "painted-olive-seamless",
  "painted-sky-seamless",
  "panel-honey-9s",
  "panel-olive-9s",
  "pattern-motif",
  "play-level-button-runtime",
  "rewarded-ad-badge",
  "settings-icon-runtime",
  "settings_icon_home",
  "settings_icon_music",
  "settings_icon_sound",
  "settings_icon_vibration",
  "shop-icon-runtime",
  "shop_coin_pack_1",
  "shop_coin_pack_2",
  "shop_coin_pack_3",
  "shop_coin_pack_4",
  "shop_coin_pack_5",
  "shop_coin_pack_6",
  "shop_hint_pack_large",
  "shop_hint_pack_medium",
  "shop_hint_pack_small",
  "shop_no_ads",
  "shop_no_ads_premium",
  "shop_vip_bundle",
  "wood-honey-seamless",
] as const;

const PUBLIC_ASSET_SHA256 = {
  "ui/shop/shop_no_ads_premium.png": "e7c3cb5ded9eeaa63d2d84be49edc0fab36585a88fcc44a3ed2bedec54be37f7",
  "ui/shop/shop_hint_pack_small.png": "ec30d0d140afb221966a7512f8c72e00a96e1831f6281d61af1ddc2485f52234",
  "ui/shop/shop_hint_pack_medium.png": "ab5b25a558c30d33aa2b524dec171e2abee97e659efb50f8c9a0da65795e4ae4",
  "ui/shop/shop_hint_pack_large.png": "b982b9dac9f9ae37aa583bcb75d82fc157010ffbc05cfe869ad8f8834937a82f",
  "ui/shop/shop_no_ads.png": "017388ff0092d7a5453ae5163c0994d1c2341ccb63a1a9aadc180e75035c227c",
  "ui/shop/shop_vip_bundle.png": "16941c94ea26c5923f219e47b87bcbbdc187778499912ecdf5228a4f73ca149f",
  "ui/shop/shop_coin_pack_6.png": "e3f49975292f8ea777fcec9c31e6a4487c33937a0bd170409bada8b4d0453240",
  "ui/settings/settings_icon_home.png": "973bb67314af4eaae548d9ee31a03008bc1e99e3b1c64d44e0ce6bec6ae87e16",
  "ui/settings/settings_icon_vibration.png": "e583e7032f613db816942cf178c4b440e8332e2acbc6d068624bf3c1a2e418b0",
  "ui/settings/settings_icon_home.svg": "b4aec7ec1e6db225d3d526062632ff76efd072ce3c5a473955d50c7bfc687052",
  "ui/home/no-ads-runtime.png": "017388ff0092d7a5453ae5163c0994d1c2341ccb63a1a9aadc180e75035c227c",
  "ui/menu-icons/magnifier-runtime.png": "ef455791858fca0e89a3c5634ca918b617635538dfe5d187dcd332ffa6c7abc9",
  "ui/menu-icons/settings-icon-runtime.png": "1a3730b636ae359696816242926fa86d1047aba21f5c7e6d9deda8838430353d",
  "ui/menu-icons/shop-icon-runtime.png": "f627574764c4a51b7f874eeb60cee50e6c1d850dd2c30c05995e882301ab8878",
  "ui/menu-icons/icon_streak_flame.png": "bbf7e5461d78bae54dd5b64a7054b80715e2aecd0f08b0742a3396bbc284dbd6",
} as const;

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("selected v1 runtime assets", () => {
  it("documents every design-sheet asset in the canonical Cozy Garden list", () => {
    const canonicalList = readFileSync(join(process.cwd(), "design/ASSET-LIST.md"), "utf8");
    for (const assetId of REQUIRED_RESKIN_ASSET_IDS) {
      expect(canonicalList, assetId).toContain(`\`${assetId}\``);
    }
    expect(canonicalList).toContain("There is no Pause screen");
    expect(canonicalList).toContain("byte-identical to `public/ui/home/no-ads-runtime.png`");
  });

  it("exposes every non-level reskin asset through the design-sheet bindings", () => {
    const boundAssetIds = new Set<string>();
    const collect = (value: unknown): void => {
      if (typeof value === "string") {
        boundAssetIds.add(value);
        return;
      }
      if (typeof value !== "object" || value === null) return;
      for (const child of Object.values(value)) collect(child);
    };
    collect(assets);

    expect([...boundAssetIds].sort()).toEqual([...REQUIRED_RESKIN_ASSET_IDS].sort());
  });

  it("pins selected public assets and only the selected badge variants", () => {
    for (const [relativePath, expectedHash] of Object.entries(PUBLIC_ASSET_SHA256)) {
      expect(sha256File(join(process.cwd(), "public", relativePath)), relativePath).toBe(expectedHash);
    }

    expect(readdirSync(join(process.cwd(), "public/ui/shop/badges")).sort()).toEqual([
      "best-value-2-mint-rose-ticket.png",
      "popular-3-gold-candy-tab.png",
    ]);
    expect(
      sha256File(join(process.cwd(), "public/ui/shop/shop_no_ads.png")),
    ).toBe(sha256File(join(process.cwd(), "public/ui/home/no-ads-runtime.png")));
  });

  it("decodes the Settings Home icon exactly once across repeated preload calls", async () => {
    const decodedSources: string[] = [];

    class MockImage {
      decoding = "auto";
      src = "";

      decode(): Promise<void> {
        decodedSources.push(this.src);
        return Promise.resolve();
      }
    }

    vi.stubGlobal("Image", MockImage);
    vi.useFakeTimers();
    const { preloadIcons, whenIconsDecoded } = await import("../../src/ui/iconPreload");

    preloadIcons();
    preloadIcons();
    await whenIconsDecoded();
    // Home icons gate the boot path; shop/settings decode from a deferred
    // idle/timeout callback — advance timers so the deferred set fires.
    expect(decodedSources.filter((src) => src === "/ui/settings/settings_icon_home.png")).toHaveLength(0);
    vi.runAllTimers();
    vi.useRealTimers();

    expect(decodedSources.filter((src) => src === "/ui/settings/settings_icon_home.png")).toHaveLength(1);
  });
});
