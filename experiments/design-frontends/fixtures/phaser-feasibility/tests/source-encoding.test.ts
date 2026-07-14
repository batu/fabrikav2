// Committed fixture script source must be NUL-free text: a raw NUL byte makes
// Git treat the file as binary (breaking diffs and text-based tooling). Runtime
// NUL separators belong in textual escapes like "\\u0000", never raw bytes.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts");

describe("fixture .mjs sources contain no raw NUL bytes", () => {
  for (const name of readdirSync(scriptsDir).filter((f) => f.endsWith(".mjs"))) {
    it(`${name} is NUL-free`, () => {
      const bytes = readFileSync(join(scriptsDir, name));
      expect(bytes.includes(0), `${name} contains a raw NUL byte`).toBe(false);
    });
  }
});
