/**
 * U1 freeze guard: both proof games share one hash-verified behavior seed.
 *
 * The two experiment lanes may only diverge in identity (package name, game
 * id, titles, ports, app ids) and — after the fork — inside their own lane
 * fences. Controller, SDK fixture, shell, design seed, content, and behavior
 * tests are read-only lane inputs whose bytes must stay identical across
 * games/shell_proof_grapes and games/shell_proof_phaser, and must match the
 * committed baseline record in experiments/design-frontends/baseline/.
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
/** Identity-bearing files excluded from byte identity (asserted separately). */
const IDENTITY_EXCLUDED = new Set(["design/copy.ts"]);

interface BaselineRecord {
  readonly comparedGames: readonly string[];
  readonly frozenDirs: readonly string[];
  readonly identityExcluded: readonly string[];
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
      if (IDENTITY_EXCLUDED.has(file)) continue;
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
    const selfHashes = frozenFileHashes(GAME_ROOT);
    expect(Object.fromEntries(selfHashes)).toEqual(baseline.files);
  });

  it("keeps the copy seed identical apart from the game title identity line", () => {
    const selfCopy = withoutTitleLine(readFileSync(join(GAME_ROOT, "design/copy.ts"), "utf8"));
    const twinCopy = withoutTitleLine(readFileSync(join(TWIN_ROOT, "design/copy.ts"), "utf8"));
    expect(selfCopy).toBe(twinCopy);
  });
});
