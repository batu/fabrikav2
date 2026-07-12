// Worktree write-confinement audit (plan R11 / KTD11 input). Manifests every
// file in the enclosing worktree outside this fixture (by size+mtime, so
// gitignored writes are caught too) and reports any difference after an
// editor session.
//
//   node scripts/confine-audit.mjs snapshot   # before the session
//   node scripts/confine-audit.mjs compare    # after the session
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { fixtureRoot, statManifest } from "./lib.mjs";

const snapshotPath = join(fixtureRoot, "evidence", "sessions", "confine-baseline.json");

// .git omitted: git's own bookkeeping churns; the audit targets project files.
const SKIP = new Set([".git", "node_modules", "dist"]);

export function filterOutsideManifest(manifest, fixtureRel) {
  return Object.fromEntries(
    Object.entries(manifest).filter(
      ([path]) => path !== fixtureRel && !path.startsWith(fixtureRel + "/")
    )
  );
}

export function diffManifests(before, after) {
  const created = [];
  const modified = [];
  for (const path of Object.keys(after)) {
    if (!Object.hasOwn(before, path)) created.push(path);
    else if (before[path] !== after[path]) modified.push(path);
  }
  const deleted = Object.keys(before)
    .filter((path) => !Object.hasOwn(after, path))
    .sort();
  return [
    ...created.sort().map((path) => `created: ${path}`),
    ...modified.sort().map((path) => `modified: ${path}`),
    ...deleted.map((path) => `deleted: ${path}`),
  ];
}

function outsideManifest(worktreeRoot, fixtureRel) {
  const all = statManifest(worktreeRoot, { skipDirs: SKIP });
  return filterOutsideManifest(all, fixtureRel);
}

function run(mode) {
  const worktreeRoot = execSync("git rev-parse --show-toplevel", {
    cwd: fixtureRoot,
    encoding: "utf8",
  }).trim();
  const fixtureRel = relative(worktreeRoot, resolve(fixtureRoot));

  if (mode === "snapshot") {
    mkdirSync(join(fixtureRoot, "evidence", "sessions"), { recursive: true });
    writeFileSync(snapshotPath, JSON.stringify(outsideManifest(worktreeRoot, fixtureRel), null, 2) + "\n");
    console.log("[confine] baseline written");
  } else if (mode === "compare") {
    if (!existsSync(snapshotPath)) {
      console.error("[confine] no baseline snapshot; run `confine-audit.mjs snapshot` first");
      process.exit(2);
    }
    const before = JSON.parse(readFileSync(snapshotPath, "utf8"));
    const after = outsideManifest(worktreeRoot, fixtureRel);
    const violations = diffManifests(before, after);
    if (violations.length > 0) {
      console.error("[confine] FAIL — writes outside the fixture:");
      for (const violation of violations) console.error("  " + violation);
      process.exit(1);
    }
    console.log("[confine] PASS — no writes outside the fixture");
  } else {
    console.error("usage: confine-audit.mjs snapshot|compare");
    process.exit(2);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run(process.argv[2]);
}
