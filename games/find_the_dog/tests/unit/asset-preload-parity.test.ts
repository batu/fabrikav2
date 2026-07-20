import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const PUBLIC_ASSET_SHA256 = {
  "ui/shop/shop_no_ads_premium.png": "f9c31663e04484f1bf784afbcc9a66b8e536ac580a12fb65cbbe148559a2e4e7",
  "ui/shop/badges/best-value-2-mint-rose-ticket.png": "c2310232503b747df6e3b46421809bd222a8c09bf5c665813beb39dea4a0fa34",
  "ui/shop/badges/popular-3-gold-candy-tab.png": "ac400dd413fc37cef639e32d1e03d2f77bc84a4c5bc341b53dbcc0af30d58b46",
  "ui/shop/shop_hint_pack_small.png": "b6c6f51eab32c19275b77972868b4ccc200f6a3cb28e1ff808d6dae6fb32b766",
  "ui/shop/shop_hint_pack_medium.png": "ded4ee72219c88190a00ebbcb6859ea833adc2410443e42b7c6a275e8e70a8f0",
  "ui/shop/shop_hint_pack_large.png": "5784279ec6992aa39e5c028041f7e7c6d395381f228bc043a3a2fa2a41b2143e",
  "ui/shop/shop_no_ads.png": "1c25ea20b8f78279374bb8d4eec1aa0b404e6d7794d1101514b937809b7ed8e9",
  "ui/shop/shop_vip_bundle.png": "c398c75f823ea891d9b3b66a9a309213ec00b2ce53209202ac601ff53aaa51c3",
  "ui/shop/shop_coin_pack_6.png": "7e1c0e3c5c37eb8e3f802a44bb4e132ecf203f8f1d52a440e1fa5861889ceab3",
  "ui/settings/settings_icon_home.png": "1b63b502850aa3f3afd092f962dbcfd8acd4e8fb6c8aaa17f43a3094f56e2028",
  "ui/settings/settings_icon_home.svg": "b4aec7ec1e6db225d3d526062632ff76efd072ce3c5a473955d50c7bfc687052",
  "ui/home/no-ads-runtime.png": "1c25ea20b8f78279374bb8d4eec1aa0b404e6d7794d1101514b937809b7ed8e9",
  "ui/menu-icons/magnifier-runtime.png": "733d24b713f8eec00aba3eff442065cb284bcfc9675b676320355c60df14fbe0",
  "ui/menu-icons/settings-icon-runtime.png": "a460e4fd568f8ff32e36241cbcf1b38aa9dda34c7d034f2b71e686bf6d71136a",
  "ui/menu-icons/shop-icon-runtime.png": "97b9aa58f157d94405cb7b66632c554c40fa15b3f2f5e9693989441685012f34",
} as const;

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("selected v1 runtime assets", () => {
  it("pins all fifteen public assets and only the selected badge variants", () => {
    for (const [relativePath, expectedHash] of Object.entries(PUBLIC_ASSET_SHA256)) {
      expect(sha256File(join(process.cwd(), "public", relativePath)), relativePath).toBe(expectedHash);
    }

    expect(readdirSync(join(process.cwd(), "public/ui/shop/badges")).sort()).toEqual([
      "best-value-2-mint-rose-ticket.png",
      "popular-3-gold-candy-tab.png",
    ]);
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
    const { preloadIcons, whenIconsDecoded } = await import("../../src/ui/iconPreload");

    preloadIcons();
    preloadIcons();
    await whenIconsDecoded();

    expect(decodedSources.filter((src) => src === "/ui/settings/settings_icon_home.png")).toHaveLength(1);
  });
});
