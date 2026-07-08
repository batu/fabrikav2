import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "@playwright/test";

const NO_ADS_SHA256 = "a81f1439fc3f5d1eb3e202ee8707186d6e930711b38c94da5a62a1c4aed800f5";
const PLAY_BUTTON_SHA256 = "41876ebb627203339a81a78ec1fbe30964642881c124383627e0e0a58fbfc5c7";

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

test("boots the real Find the Dog shell", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#game-container")).toBeVisible();
  await expect(page.locator("#hud-overlay")).toBeAttached();
  await expect(page.locator("#game-container canvas")).toBeVisible({ timeout: 30000 });
  await expect(page.locator("#home-shell")).toBeVisible({ timeout: 30000 });
  await expect(page.locator("#home-map-mount")).toBeVisible();
  await expect(page.locator("#home-play-now")).toBeVisible();
  await expect(page.locator("#home-no-ads .home-side-btn-label")).toHaveCount(0);
  await expect(page.locator("#home-nav-play")).toBeVisible();
});

test("Play Now starts the current level from a real menu tap", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto("/");
  await expect(page.locator("#home-play-now")).toBeVisible({ timeout: 30000 });

  await page.locator("#home-play-now").tap();

  await page.waitForFunction(
    () => {
      const game = (window as unknown as { __FIND_DOG_GAME__?: { scene?: { isActive?: (key: string) => boolean } } })
        .__FIND_DOG_GAME__;
      return game?.scene?.isActive?.("GameScene") === true;
    },
    { timeout: 30000 },
  );
});

test.describe("home menu polish regressions", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
  });

  test("pins v1 home assets and contains the mobile menu chrome", async ({ page }) => {
    const manifest = JSON.parse(
      readFileSync(join(process.cwd(), "design/asset-identity.json"), "utf8"),
    ) as {
      assets: Record<string, { sha256?: string; v1Sha256?: string }>;
    };

    expect(sha256File(join(process.cwd(), "public/ui/home/no-ads-runtime.png"))).toBe(NO_ADS_SHA256);
    expect(sha256File(join(process.cwd(), "design/assets/no-ads-runtime.png"))).toBe(NO_ADS_SHA256);
    expect(manifest.assets["design/assets/no-ads-runtime.png"].sha256).toBe(NO_ADS_SHA256);
    expect(manifest.assets["design/assets/no-ads-runtime.png"].v1Sha256).toBe(NO_ADS_SHA256);
    expect(sha256File(join(process.cwd(), "public/ui/home/play-level-button-runtime.png"))).toBe(
      PLAY_BUTTON_SHA256,
    );
    expect(manifest.assets["design/assets/play-level-button-runtime.png"].sha256).toBe(PLAY_BUTTON_SHA256);
    expect(manifest.assets["design/assets/play-level-button-runtime.png"].v1Sha256).toBe(PLAY_BUTTON_SHA256);

    await page.addInitScript(() => window.localStorage.clear());
    await page.goto("/");
    await expect(page.locator("#home-shell")).toBeVisible({ timeout: 30000 });
    await page.waitForFunction(() => {
      const noAds = document.querySelector<HTMLImageElement>(".home-no-ads-art");
      return noAds !== null && noAds.complete && noAds.naturalWidth > 0;
    });

    const layout = await page.evaluate(() => {
      type Box = {
        x: number;
        y: number;
        width: number;
        height: number;
        top: number;
        right: number;
        bottom: number;
        left: number;
      };
      const box = (selector: string): Box => {
        const element = document.querySelector<HTMLElement>(selector);
        if (element === null) throw new Error(`Missing selector: ${selector}`);
        const rect = element.getBoundingClientRect();
        return {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          left: rect.left,
        };
      };
      const contained = (outer: Box, inner: Box): boolean =>
        inner.left >= outer.left - 0.5 &&
        inner.top >= outer.top - 0.5 &&
        inner.right <= outer.right + 0.5 &&
        inner.bottom <= outer.bottom + 0.5;

      const plusStyles = Array.from(document.querySelectorAll<HTMLButtonElement>(".home-pill-plus")).map((button) => {
        const style = window.getComputedStyle(button);
        const after = window.getComputedStyle(button, "::after");
        return {
          display: style.display,
          alignItems: style.alignItems,
          justifyContent: style.justifyContent,
          lineHeight: style.lineHeight,
          afterContent: after.content,
          afterDisplay: after.display,
          afterLineHeight: after.lineHeight,
        };
      });
      const navWidths = Array.from(document.querySelectorAll<HTMLElement>("#home-shell .home-nav-bar > button")).map(
        (button) => button.getBoundingClientRect().width,
      );
      const play = document.querySelector<HTMLButtonElement>("#home-play-now");
      if (play === null) throw new Error("Missing Play Now button");
      const playStyle = window.getComputedStyle(play);
      const noAds = document.querySelector<HTMLImageElement>(".home-no-ads-art");
      if (noAds === null) throw new Error("Missing no-ads art");
      const noAdsBox = noAds.getBoundingClientRect();
      const currentDot = document.querySelector<HTMLElement>(".fab-levelmap-node.current .fab-levelmap-node-dot");
      if (currentDot === null) throw new Error("Missing current saga dot");
      const currentDotStyle = window.getComputedStyle(currentDot);
      const saga = document.querySelector<HTMLElement>(".fab-levelmap");
      if (saga === null) throw new Error("Missing saga map");
      const banner = document.querySelector<HTMLElement>(".home-brand-art");
      if (banner === null) throw new Error("Missing banner art");
      const bannerContainer = document.querySelector<HTMLElement>(".home-brand-banner");
      if (bannerContainer === null) throw new Error("Missing banner container");
      const bannerContainerStyle = window.getComputedStyle(bannerContainer);
      const playBox = play.getBoundingClientRect();

      return {
        bannerTag: banner.tagName,
        bannerContainerBackground: bannerContainerStyle.backgroundColor,
        hasBannerVideo: document.querySelector(".home-brand-banner video") !== null,
        noAdsNaturalWidth: noAds.naturalWidth,
        noAdsNaturalHeight: noAds.naturalHeight,
        noAdsLeft: noAdsBox.left,
        noAdsTop: noAdsBox.top,
        noAdsRight: noAdsBox.right,
        noAdsBottom: noAdsBox.bottom,
        viewportWidth: window.innerWidth,
        sagaNodeDisc: saga.dataset.fabNodeDisc,
        currentDotBackgroundColor: currentDotStyle.backgroundColor,
        currentDotBackgroundImage: currentDotStyle.backgroundImage,
        plusStyles,
        coinContained:
          contained(box(".home-coin-pill"), box(".home-coin-pill span")) &&
          contained(box(".home-coin-pill"), box(".home-coin-pill img")),
        hintContained:
          contained(box(".home-hint-pill"), box(".home-hint-pill span")) &&
          contained(box(".home-hint-pill"), box(".home-hint-pill img")),
        navWidths,
        playWidth: playBox.width,
        playHeight: playBox.height,
        playBackground: playStyle.backgroundImage,
      };
    });

    expect(layout.bannerTag).toBe("IMG");
    expect(layout.hasBannerVideo).toBe(false);
    expect(layout.bannerContainerBackground).toBe("rgba(0, 0, 0, 0)");
    expect(layout.noAdsNaturalWidth).toBe(1254);
    expect(layout.noAdsNaturalHeight).toBe(1254);
    expect(layout.noAdsLeft).toBeGreaterThanOrEqual(20);
    expect(layout.noAdsLeft).toBeLessThanOrEqual(40);
    expect(layout.noAdsTop).toBeGreaterThanOrEqual(190);
    expect(layout.noAdsTop).toBeLessThanOrEqual(255);
    expect(layout.noAdsRight).toBeLessThanOrEqual(layout.viewportWidth);
    expect(layout.noAdsBottom).toBeLessThan(360);
    expect(layout.sagaNodeDisc).toBe("none");
    expect(layout.currentDotBackgroundColor).toMatch(/^(rgba\(0, 0, 0, 0\)|transparent)$/);
    expect(layout.currentDotBackgroundImage).toContain("node-current-candy.png");
    for (const plus of layout.plusStyles) {
      expect(plus.display).toBe("flex");
      expect(plus.alignItems).toBe("center");
      expect(plus.justifyContent).toBe("center");
      expect(plus.lineHeight).toBe("0px");
      expect(plus.afterContent).toBe("\"+\"");
      expect(plus.afterDisplay).toBe("block");
      expect(plus.afterLineHeight).toBe("16px");
    }
    expect(layout.coinContained).toBe(true);
    expect(layout.hintContained).toBe(true);
    expect(Math.max(...layout.navWidths) - Math.min(...layout.navWidths)).toBeLessThanOrEqual(1);
    expect(layout.playBackground).toContain("play-level-button-runtime.png");
    expect(layout.playWidth).toBeGreaterThanOrEqual(176);
    expect(layout.playWidth).toBeLessThanOrEqual(220);
    expect(layout.playHeight).toBeGreaterThanOrEqual(60);
    expect(layout.playHeight).toBeLessThanOrEqual(72);
  });
});
