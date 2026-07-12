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
import { fixtureRoot, statManifest } from "./lib.mjs";

const worktreeRoot = execSync("git rev-parse --show-toplevel", {
  cwd: fixtureRoot,
  encoding: "utf8",
}).trim();
const fixtureRel = relative(worktreeRoot, resolve(fixtureRoot));
const snapshotPath = join(fixtureRoot, "evidence", "sessions", "confine-baseline.json");

// .git omitted: git's own bookkeeping churns; the audit targets project files.
const SKIP = new Set([".git", "node_modules", "dist"]);

function outsideManifest() {
  const all = statManifest(worktreeRoot, { skipDirs: SKIP });
  const outside = {};
  for (const [path, sig] of Object.entries(all)) {
    if (!path.startsWith(fixtureRel + "/")) outside[path] = sig;
  }
  return outside;
}

const mode = process.argv[2];
if (mode === "snapshot") {
  mkdirSync(join(fixtureRoot, "evidence", "sessions"), { recursive: true });
  writeFileSync(snapshotPath, JSON.stringify(outsideManifest(), null, 2) + "\n");
  console.log("[confine] baseline written");
} else if (mode === "compare") {
  if (!existsSync(snapshotPath)) {
    console.error("[confine] no baseline snapshot; run `confine-audit.mjs snapshot` first");
    process.exit(2);
  }
  const before = JSON.parse(readFileSync(snapshotPath, "utf8"));
  const after = outsideManifest();
  const violations = [];
  for (const [path, sig] of Object.entries(after)) {
    if (!(path in before)) violations.push(`created: ${path}`);
    else if (before[path] !== sig) violations.push(`modified: ${path}`);
  }
  for (const path of Object.keys(before)) {
    if (!(path in after)) violations.push(`deleted: ${path}`);
  }
  if (violations.length > 0) {
    console.error("[confine] FAIL — writes outside the fixture:");
    for (const v of violations) console.error("  " + v);
    process.exit(1);
  }
  console.log("[confine] PASS — no writes outside the fixture");
} else {
  console.error("usage: confine-audit.mjs snapshot|compare");
  process.exit(2);
}
