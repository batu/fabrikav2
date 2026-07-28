import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { HOME_NO_ADS_BADGE_SRC } from "../../src/ui/iconPreload";

const NO_ADS_SHA256 = "1c25ea20b8f78279374bb8d4eec1aa0b404e6d7794d1101514b937809b7ed8e9";
const PLAY_BUTTON_SHA256 = "41876ebb627203339a81a78ec1fbe30964642881c124383627e0e0a58fbfc5c7";
const CSS_TEXT = readFileSync(join(process.cwd(), "src/ui/styles.css"), "utf8");

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function element(selector: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(selector);
  if (found === null) throw new Error(`Missing selector: ${selector}`);
  return found;
}

function publicPathForSrc(src: string): string {
  if (!src.startsWith("/")) throw new Error(`Expected root-relative src: ${src}`);
  return join(process.cwd(), "public", src.slice(1));
}

describe("home menu polish regressions", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
    const style = document.createElement("style");
    style.textContent = CSS_TEXT;
    document.head.append(style);
  });

  it("pins the public home no-ads and Play Now asset identities", () => {
    const manifest = JSON.parse(
      readFileSync(join(process.cwd(), "design/asset-identity.json"), "utf8"),
    ) as {
      assets: Record<string, { sha256?: string; sourceSha256?: string; v1Sha256?: string }>;
    };
    expect(sha256File(join(process.cwd(), "public/ui/home/no-ads-runtime.png"))).toBe(NO_ADS_SHA256);
    document.body.innerHTML = `<img class="home-no-ads-art" src="${HOME_NO_ADS_BADGE_SRC}" alt="">`;
    const renderedBadgeSrc = element(".home-no-ads-art").getAttribute("src") ?? "";
    expect(sha256File(publicPathForSrc(renderedBadgeSrc))).toBe(NO_ADS_SHA256);
    expect(sha256File(join(process.cwd(), "public/ui/home/play-level-button-runtime.png"))).toBe(
      PLAY_BUTTON_SHA256,
    );
    expect(manifest.assets["design/assets/play-level-button-runtime.png"].sha256).toBe(PLAY_BUTTON_SHA256);
    expect(manifest.assets["design/assets/play-level-button-runtime.png"].v1Sha256).toBe(PLAY_BUTTON_SHA256);
  });

  it("computes centered plus and contained pill/menu styles", () => {
    document.body.innerHTML = `
      <div id="home-shell">
        <div class="home-balance-pill">
          <span>3</span>
          <img alt="">
          <button class="home-pill-plus" type="button">+</button>
        </div>
        <button id="home-play-now" class="home-play-btn" type="button">Play Now</button>
        <aside class="home-rail home-rail-left">
          <button id="home-no-ads" class="home-side-btn home-no-ads-btn" type="button">
            <img class="home-no-ads-art" src="${HOME_NO_ADS_BADGE_SRC}" alt="">
          </button>
        </aside>
        <nav class="home-nav-bar">
          <button type="button"></button>
          <button type="button"></button>
          <button type="button"></button>
        </nav>
      </div>
    `;

    const plus = window.getComputedStyle(element(".home-pill-plus"));
    expect(plus.display).toBe("flex");
    expect(plus.alignItems).toBe("center");
    expect(plus.justifyContent).toBe("center");
    expect(plus.lineHeight).toBe("1");
    expect(plus.fontSize).toBe("0px");
    expect(CSS_TEXT).toContain(".home-pill-plus::after");
    expect(CSS_TEXT).toContain('content: "+";');

    const pill = window.getComputedStyle(element(".home-balance-pill"));
    expect(pill.boxSizing).toBe("border-box");
    expect(pill.minWidth).toBe("96px");
    expect(pill.minHeight).toBe("42px");
    const pillRule = CSS_TEXT.match(/#home-shell \.home-balance-pill\s*\{([^}]*)\}/s)?.[1] ?? "";
    expect(pillRule).not.toMatch(/^\s*width:/m);
    expect(pillRule).not.toMatch(/^\s*height:/m);
    expect(pill.lineHeight).toBe("1");

    const pillValue = window.getComputedStyle(element(".home-balance-pill span"));
    expect(pillValue.display).toBe("inline-flex");
    expect(pillValue.alignItems).toBe("center");
    expect(pillValue.justifyContent).toBe("center");
    expect(pillValue.minWidth).toBe("2ch");
    expect(pillValue.maxWidth).toBe("");
    expect(pillValue.overflow).toBe("");
    expect(pillValue.whiteSpace).toBe("nowrap");

    const pillIcon = window.getComputedStyle(element(".home-balance-pill img"));
    expect(pillIcon.width).toBe("28px");
    expect(pillIcon.height).toBe("28px");
    expect(pillIcon.flex).toBe("0 0 28px");
    expect(pillIcon.maxWidth).toBe("28px");
    expect(pillIcon.maxHeight).toBe("28px");

    const navCell = window.getComputedStyle(element(".home-nav-bar > button"));
    expect(navCell.flex).toBe("0 0 calc(100% / 3)");
    expect(navCell.width).toBe("calc(100% / 3)");
    expect(navCell.maxWidth).toBe("calc(100% / 3)");
    expect(window.getComputedStyle(element(".home-nav-bar")).padding).toBe("0px");
    expect(CSS_TEXT).toContain("padding: 9px 0 calc(env(safe-area-inset-bottom, 0px) * 0.55 + 4px);");

    const play = window.getComputedStyle(element("#home-play-now"));
    expect(play.backgroundImage).toContain("/ui/home/play-level-button-runtime.png");
    expect(CSS_TEXT).toContain("width: min(100%, 180px);");
    expect(play.height).toBe("62px");
    expect(play.minHeight).toBe("62px");
    expect(play.margin).toBe("-40px auto 26px");

    const noAdsRail = window.getComputedStyle(element(".home-rail-left"));
    expect(noAdsRail.left).toBe("20px");
    expect(noAdsRail.top).toBe("116px");

    const noAdsButton = window.getComputedStyle(element(".home-no-ads-btn"));
    expect(noAdsButton.width).toBe("58px");

    const noAdsArt = element(".home-no-ads-art") as HTMLImageElement;
    expect(noAdsArt.getAttribute("src")).toBe(HOME_NO_ADS_BADGE_SRC);
    expect(window.getComputedStyle(noAdsArt).width).toBe("58px");
    expect(window.getComputedStyle(noAdsArt).height).toBe("58px");
    expect(sha256File(publicPathForSrc(noAdsArt.getAttribute("src") ?? ""))).toBe(NO_ADS_SHA256);
  });
});
