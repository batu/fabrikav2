/**
 * U1 freeze guard: both proof games share one hash-verified behavior seed.
 *
 * The two experiment lanes may only diverge in identity (package name, game
 * id, titles, ports, app ids), in their declared projection OUTPUTS, in their
 * lane-owned RENDERER surface, and — after the fork — inside their own lane
 * fences. Controller, SDK fixture, harness, in-situ tour, design seed, content,
 * and behavior tests are read-only lane inputs whose bytes must stay identical
 * across games/shell_proof_grapes and games/shell_proof_phaser, and must match
 * the committed baseline record in experiments/design-frontends/baseline/.
 *
 * This file itself is part of the frozen set and is byte-identical in both
 * games: it resolves "this game" and "the twin game" from its own location.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const GAME_ROOT = resolve(process.cwd());
const GAMES = ["shell_proof_grapes", "shell_proof_phaser"] as const;
const SELF = basename(GAME_ROOT) as (typeof GAMES)[number];
const TWIN = GAMES.find((game) => game !== SELF)!;
const TWIN_ROOT = resolve(GAME_ROOT, "..", TWIN);
const BASELINE_PATH = resolve(
  GAME_ROOT,
  "../../experiments/design-frontends/baseline/behavior-hashes.json",
);

/** Directories whose bytes are frozen behavior inputs for both lanes. */
const FROZEN_DIRS = ["src", "design", "content", "tests/unit"];

/**
 * Identity-bearing file excluded from byte identity because its title line
 * differs per lane; its body is asserted twin-identical separately below.
 */
const IDENTITY_EXCLUDED = new Set(["design/copy.ts"]);

/**
 * Lane-owned surfaces each lane may legally DIVERGE on after the fork — excluded
 * from twin identity AND from the baseline byte record (card qWCv9tUo items 4/9):
 *   - the renderer entry/host/styles that U6 replaces per lane,
 *   - the renderers/** namespace that U6 introduces per lane, and
 *   - the declared projection OUTPUTS (design/revision.json, design/revisions/**),
 *     which are generated per lane, not frozen behavior inputs.
 * Their writability is governed by the executable lane fence (fence-gate); this
 * test only stops guarding their bytes. Every OTHER file under FROZEN_DIRS —
 * controller, sdk, harness, insituTour, game, content, unit tests, the rest of
 * design — stays twin-identical and baseline-pinned.
 */
const LANE_OWNED_FILES = new Set([
  "src/main.ts",
  "src/shell/TemplateShell.ts",
  "src/shell/template-shell.css",
  "design/revision.json",
]);
const LANE_OWNED_DIRS = ["src/shell/renderers/", "design/revisions/"];

/** True when a frozen-dir file is NOT part of the twin/baseline byte set. */
export function isExcludedFromFrozenBytes(rel: string): boolean {
  if (IDENTITY_EXCLUDED.has(rel)) return true;
  if (LANE_OWNED_FILES.has(rel)) return true;
  return LANE_OWNED_DIRS.some((dir) => rel.startsWith(dir));
}

interface BaselineRecord {
  readonly comparedGames: readonly string[];
  readonly frozenDirs: readonly string[];
  readonly identityExcluded: readonly string[];
  readonly laneOwnedFiles: readonly string[];
  readonly laneOwnedDirs: readonly string[];
  readonly files: Readonly<Record<string, string>>;
}

function walkFiles(root: string, dir: string): string[] {
  const absolute = join(root, dir);
  const entries = readdirSync(absolute, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(absolute, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(root, relative(root, path)));
    } else if (entry.isFile() && entry.name !== ".DS_Store") {
      files.push(relative(root, path));
    }
  }
  return files.sort();
}

function frozenFileHashes(root: string): Map<string, string> {
  const hashes = new Map<string, string>();
  for (const dir of FROZEN_DIRS) {
    for (const file of walkFiles(root, dir)) {
      if (isExcludedFromFrozenBytes(file)) continue;
      const digest = createHash("sha256").update(readFileSync(join(root, file))).digest("hex");
      hashes.set(file, `sha256-${digest}`);
    }
  }
  return hashes;
}

function withoutTitleLine(copySource: string): string {
  return copySource
    .split("\n")
    .filter((line) => !line.includes('"game.title"'))
    .join("\n");
}

describe("frozen seven-state behavior copies", () => {
  it("keeps every frozen behavior file byte-identical across both proof games", () => {
    expect(statSync(TWIN_ROOT).isDirectory()).toBe(true);
    const selfHashes = frozenFileHashes(GAME_ROOT);
    const twinHashes = frozenFileHashes(TWIN_ROOT);
    expect([...selfHashes.keys()]).toEqual([...twinHashes.keys()]);
    const drifted = [...selfHashes.entries()]
      .filter(([file, hash]) => twinHashes.get(file) !== hash)
      .map(([file]) => file);
    expect(drifted, "behavior files drifted between the proof games").toEqual([]);
  });

  it("matches the committed U1 baseline behavior-hash record", () => {
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as BaselineRecord;
    expect([...baseline.comparedGames]).toEqual([...GAMES]);
    expect([...baseline.frozenDirs]).toEqual(FROZEN_DIRS);
    expect([...baseline.identityExcluded]).toEqual([...IDENTITY_EXCLUDED]);
    expect([...baseline.laneOwnedFiles]).toEqual([...LANE_OWNED_FILES]);
    expect([...baseline.laneOwnedDirs]).toEqual([...LANE_OWNED_DIRS]);
    const selfHashes = frozenFileHashes(GAME_ROOT);
    expect(Object.fromEntries(selfHashes)).toEqual(baseline.files);
  });

  it("excludes only lane-owned and declared-output paths, never a frozen neighbor", () => {
    // Excluded: per-lane copy title, renderer surface, and declared outputs.
    for (const rel of [
      "design/copy.ts",
      "src/main.ts",
      "src/shell/TemplateShell.ts",
      "src/shell/template-shell.css",
      "src/shell/renderers/DomRenderer.ts",
      "design/revision.json",
      "design/revisions/rev-1/projection.json",
    ]) {
      expect(isExcludedFromFrozenBytes(rel), rel).toBe(true);
    }
    // Guarded neighbors: a mutation to any of these must still break the twin
    // and baseline checks (proves the exclusion is surgical, not a hole).
    for (const rel of [
      "src/core/TemplateShellController.ts",
      "src/sdk/TemplateSdk.ts",
      "src/sdk/proofShopCatalog.ts",
      "src/shell/harness.ts",
      "src/shell/insituTour.ts",
      "design/tokens.css",
      "design/presentation.ts",
      "design/assets.ts",
      "content/README.md",
      "tests/unit/smoke.test.ts",
    ]) {
      expect(isExcludedFromFrozenBytes(rel), rel).toBe(false);
    }
  });

  it("keeps the copy seed identical apart from the game title identity line", () => {
    const selfCopy = withoutTitleLine(readFileSync(join(GAME_ROOT, "design/copy.ts"), "utf8"));
    const twinCopy = withoutTitleLine(readFileSync(join(TWIN_ROOT, "design/copy.ts"), "utf8"));
    expect(selfCopy).toBe(twinCopy);
  });
});
