import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const gameFile = (relativePath: string): string =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("Marble Run publisher bug-list regressions", () => {
  it("disables iOS selection callouts and native image dragging across every game surface", () => {
    const html = gameFile("index.html");
    const rootRule = html.match(/html,\s*body\s*\{([^}]*)\}/)?.[1];
    const imageRule = html.match(/img\s*\{([^}]*)\}/)?.[1];
    expect(rootRule).toMatch(/-webkit-user-select:\s*none/);
    expect(rootRule).toMatch(/-webkit-touch-callout:\s*none/);
    expect(imageRule).toMatch(/-webkit-user-drag:\s*none/);
  });

  it("locks browser gestures on the modal layer while leaving the shop scrollable", () => {
    // The 2026-08-07 pass only asserted the html/body/img rules and reported
    // dragging as fixed; in-game windows stayed draggable because the modal
    // layer never got touch-action. Scope is the point here, not presence.
    const html = gameFile("index.html");
    const modalRule = html.match(/#modal-root\s*\{([^}]*)\}/)?.[1];
    const scrollBodyRule = html.match(/\.home-page-body\s*\{([^}]*)\}/)?.[1];

    expect(modalRule).toMatch(/touch-action:\s*none/);
    // A blanket lock would kill shop scrolling (HUD.ts drives .home-page-body
    // scrollTop on deep links), so the scroll container must opt back in.
    expect(scrollBodyRule).toMatch(/touch-action:\s*pan-y/);
  });

  it("does not hold the first paint behind a remote-config network round trip", () => {
    const bootScene = gameFile("src/scenes/BootScene.ts");
    const bootstrap = gameFile("src/bootstrap.ts");
    expect(bootstrap).toContain("remoteConfigService.init();");
    expect(bootstrap.indexOf("remoteConfigService.init();"))
      .toBeLessThan(bootstrap.indexOf("new Phaser.Game(GameConfig)"));
    expect(bootScene).not.toContain("remoteConfigService");
    expect(bootScene).not.toContain("await remoteConfigService.initAndWaitForTest()");
  });

  it("paints the home shell before constructing its decorative WebGL preview", () => {
    const homeScene = gameFile("src/scenes/HomeScene.ts");
    expect(homeScene).toContain("this.prepareBoardPreviewSlot();");
    expect(homeScene.indexOf("this.prepareBoardPreviewSlot();"))
      .toBeLessThan(homeScene.indexOf("this.scheduleBoardPreviewAfterPaint();"));
    expect(homeScene).toContain("this.scheduleBoardPreviewAfterPaint();");
    expect(homeScene).toMatch(/scheduleBoardPreviewAfterPaint[\s\S]*requestAnimationFrame\(\(\) => requestAnimationFrame/);
  });

  it("does not create a redundant Phaser WebGL renderer during cold boot", () => {
    const gameConfig = gameFile("src/core/GameConfig.ts");
    expect(gameConfig).toContain("type: Phaser.CANVAS");
    expect(gameConfig).not.toContain("type: Phaser.AUTO");
  });

  it("requests ATT while authorization is still undetermined before AppsFlyer starts", () => {
    const plugin = gameFile("native-resources/ios/App/AppsFlyerAttributionPlugin.swift");
    expect(plugin).toContain("import AppTrackingTransparency");
    expect(plugin).toContain("ATTrackingManager.requestTrackingAuthorization");
    expect(plugin.indexOf("ATTrackingManager.requestTrackingAuthorization"))
      .toBeLessThan(plugin.indexOf("lib.start()"));
  });
});
