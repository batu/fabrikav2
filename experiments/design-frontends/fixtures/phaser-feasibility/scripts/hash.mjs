// Writes report/hashes.json: the manifest binding every evidence artifact and
// editor-native source to committed bytes (plan KTD4). verify-report.mjs
// recomputes and compares.
import { writeFileSync, mkdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fixtureRoot, listFiles, sha256File } from "./lib.mjs";

const COVERED = ["editor-project", "catalog", "evidence", "src", "scripts"];

export function buildManifest() {
  const manifest = {};
  for (const dir of COVERED) {
    for (const f of listFiles(join(fixtureRoot, dir), { skipDirs: new Set(["node_modules"]) })) {
      manifest[relative(fixtureRoot, f)] = sha256File(f);
    }
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
