// Style-guide/tokens palette alignment (plan R3/AE2, pixelsmith HITL asset
// pipeline). tokens.css is the palette authority (design-sheets round-trip);
// design/style-guide.json is a consumer whose pinned hex must match it.
// Skips visibly while the style guide has not been produced yet (U8 live run).
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

const designDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../design",
);
const tokensPath = path.join(designDir, "tokens.css");
const guidePath = path.join(designDir, "style-guide.json");

const guideExists = existsSync(guidePath);

function tokensPalette(): Record<string, string> {
  const css = readFileSync(tokensPath, "utf8");
  const palette: Record<string, string> = {};
  for (const match of css.matchAll(/--fab-color-([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
    palette[match[1]] = match[2].toLowerCase();
  }
  return palette;
}

describe("style-guide palette alignment with tokens.css", () => {
  it.skipIf(!guideExists)("every style-guide palette role matches tokens.css", () => {
    const guide = JSON.parse(readFileSync(guidePath, "utf8"));
    const tokens = tokensPalette();
    expect(Object.keys(tokens).length).toBeGreaterThan(0);
    const mismatches: string[] = [];
    for (const [role, hex] of Object.entries(guide.palette as Record<string, string>)) {
      if (tokens[role] === undefined) {
        mismatches.push(`role "${role}" is in style-guide.json but not tokens.css`);
      } else if (tokens[role] !== String(hex).toLowerCase()) {
        mismatches.push(
          `role "${role}": style-guide.json has ${hex}, tokens.css has ${tokens[role]}`,
        );
      }
    }
    expect(mismatches, mismatches.join("; ")).toEqual([]);
  });

  it.skipIf(guideExists)("style guide not yet produced (U8 live run) — alignment inactive", () => {
    // Visible notice: this test flips to the real assertion once
    // design/style-guide.json lands from the ingest + approval flow.
    expect(guideExists).toBe(false);
  });
});
