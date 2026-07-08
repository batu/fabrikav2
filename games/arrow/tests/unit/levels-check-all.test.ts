/**
 * Regression test for the levels:check-all CI gate.
 *
 * Mutates a copy of the catalogue with a bad metric and runs
 * `npm run levels:check-all` pointing at the tampered copy — the
 * script must fail loudly. Confirms CI will catch a hand-edited
 * catalogue.json drift.
 *
 * Also confirms the clean-state run succeeds in < 10s on this machine
 * (card's done-when condition).
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(__dirname, "../../");
const SCRIPT = join(REPO_ROOT, "content/level-tools/levels-check-all.mts");
const CATALOGUE = join(REPO_ROOT, "content/levels/catalogue.json");

function runCheck(extraEnv: Record<string, string> = {}): { status: number; stderr: string; stdout: string } {
  const res = spawnSync("node", ["--import", "tsx", SCRIPT], {
    cwd: REPO_ROOT,
    env: { ...process.env, ...extraEnv },
    encoding: "utf8",
  });
  return { status: res.status ?? -1, stderr: res.stderr, stdout: res.stdout };
}

describe("levels:check-all gate", () => {
  it("passes on the committed catalogue", () => {
    const res = runCheck();
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("OK");
  });

  it("finishes within 10 seconds (single-process budget)", () => {
    const start = Date.now();
    runCheck();
    const elapsed = Date.now() - start;
    // 10000ms is the card's gate; give some margin.
    expect(elapsed).toBeLessThan(10000);
  });

  it("fails when a catalogue entry's branching metric is mutated", () => {
    // Copy catalogue to a tmp path, mutate it, run the script with
    // ARROW_CATALOGUE pointing at the mutated copy. The script's
    // in-proc solver still runs against the real src/ and content/levels/.
    const scratch = mkdtempSync(join(tmpdir(), "lca-regression-"));
    try {
      const mutated = join(scratch, "catalogue.json");
      const cat = JSON.parse(readFileSync(CATALOGUE, "utf8"));
      const idx = cat.levels.findIndex((e: { kind: string }) => e.kind === "solved");
      expect(idx).toBeGreaterThanOrEqual(0);
      cat.levels[idx].meanBranchingFactor += 999;
      writeFileSync(mutated, JSON.stringify(cat, null, 2) + "\n");

      const res = runCheck({ ARROW_CATALOGUE: mutated });
      expect(res.status).not.toBe(0);
      expect(res.stderr).toContain("meanBranchingFactor");
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }, 30_000);
});
