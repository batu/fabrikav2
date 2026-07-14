/**
 * Pixel mobile-layout regressions (card qWCv9tUo). Two live-proven seams from the
 * Pixel runs at 4329eeb0:
 *   1. Safe top — page/header content sat under Android's status bar because
 *      env(safe-area-inset-top) is 0 on Android. A single design token floors the
 *      top inset; the one semantic --fab-safe-top token feeds home/level, the
 *      kit Settings page, and the custom Shop page.
 *   2. Shop grid — the shared kit auto-fills a third narrow column at the Pixel's
 *      ~412 CSS-px width; the reviewed contract is exactly two columns.
 *
 * This file is a frozen behavior input: it is byte-identical across both proof
 * games and resolves its inputs from `process.cwd()` (the running game root).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function tokensCss(): string {
  return readFileSync(resolve(process.cwd(), "design/tokens.css"), "utf8");
}

function templateShellCss(): string {
  return readFileSync(resolve(process.cwd(), "src/shell/template-shell.css"), "utf8");
}

describe("safe-top inset floor", () => {
  it("declares one explicit safe-top-min token with a 32px Android fallback", () => {
    expect(tokensCss()).toMatch(/--fab-seed-safe-top-min:\s*32px;/);
  });

  it("derives one semantic safe-top token from the Android floor and device env", () => {
    expect(tokensCss()).toMatch(
      /--fab-safe-top:\s*max\(var\(--fab-seed-safe-top-min\), env\(safe-area-inset-top\)\);/,
    );
  });

  it("feeds the home/level screen padding from the semantic safe-top token", () => {
    expect(tokensCss()).toMatch(
      /--fab-space-screen-padding:\s*var\(--fab-safe-top\) 20px max\(24px, env\(safe-area-inset-bottom\)\);/,
    );
  });

  it("feeds the custom Shop page from the same semantic safe-top token", () => {
    expect(templateShellCss()).toMatch(
      /\.template-shell__shop\s*\{[^}]*padding-top:\s*calc\(var\(--fab-space-sm\) \+ var\(--fab-safe-top\)\);/s,
    );
  });

  it("keeps Shop viewport-bounded so its catalog remains the sole scroll region", () => {
    expect(templateShellCss()).toMatch(
      /\.template-shell__shop\s*\{[^}]*box-sizing:\s*border-box;[^}]*height:\s*100dvh;/s,
    );
  });

  it("floors the docked fail rescue sheet bottom above the safe-area inset", () => {
    // The fail rescue card is a bottom sheet docked flush to the viewport edge,
    // so its last control (the bundle) must clear the device home indicator. The
    // bottom padding floors at space-lg above env(safe-area-inset-bottom) (0 on
    // Android) so the bundle never reaches the raw viewport bottom.
    expect(templateShellCss()).toMatch(
      /\.template-shell\[data-fab-state="fail"\] \.fab-result-card\s*\{[^}]*padding:[^;]*max\(var\(--fab-space-lg\), env\(safe-area-inset-bottom\)\);/s,
    );
  });
});

describe("shop grid two-column contract", () => {
  it("pins the proof-shell shop grid to exactly two minmax(0, 1fr) columns", () => {
    expect(templateShellCss()).toMatch(
      /\.template-shell__shop \.fab-shop-grid\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\);\s*\}/s,
    );
  });

  it("does not reintroduce the kit's auto-fill/auto-fit column behavior in the proof shell", () => {
    const shopGridRule = templateShellCss().slice(
      templateShellCss().indexOf(".template-shell__shop .fab-shop-grid"),
    );
    const rule = shopGridRule.slice(0, shopGridRule.indexOf("}") + 1);
    expect(rule).not.toMatch(/auto-fill|auto-fit/);
  });
});
