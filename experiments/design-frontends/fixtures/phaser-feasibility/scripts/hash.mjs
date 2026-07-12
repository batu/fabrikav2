// Writes report/hashes.json: the manifest binding every evidence artifact and
// editor-native source to committed bytes (plan KTD4). verify-report.mjs
// recomputes and compares.
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { fixtureRoot, listFiles, sha256File } from "./lib.mjs";

const COVERED_DIRS = [
  "editor-project",
  "editor-plugins",
  "catalog",
  "evidence",
  "src",
  "scripts",
  "tests",
];

const COVERED_FILES = [
  ".gitignore",
  "README.md",
  "capacitor.config.ts",
  "eslint.config.js",
  "index.html",
  "package-lock.json",
  "package.json",
  "tsconfig.json",
  "vite.config.ts",
  "vitest.config.ts",
];

export function buildManifest() {
  const manifest = Object.create(null);
  for (const dir of COVERED_DIRS) {
    for (const f of listFiles(join(fixtureRoot, dir), { skipDirs: new Set(["node_modules"]) })) {
      manifest[relative(fixtureRoot, f)] = sha256File(f);
    }
  }
  for (const file of COVERED_FILES) {
    const path = join(fixtureRoot, file);
    if (existsSync(path)) manifest[file] = sha256File(path);
  }
  return manifest;
}

if (process.argv[1].endsWith("hash.mjs")) {
  mkdirSync(join(fixtureRoot, "report"), { recursive: true });
  const manifest = buildManifest();
  writeFileSync(
    join(fixtureRoot, "report", "hashes.json"),
    JSON.stringify({ generated: new Date().toISOString(), algorithm: "sha256", files: manifest }, null, 2) + "\n"
  );
  console.log(`[hash] wrote report/hashes.json (${Object.keys(manifest).length} files)`);
}
