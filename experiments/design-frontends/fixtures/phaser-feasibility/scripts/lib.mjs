// Shared helpers for the probe's evidence scripts.
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

export function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

export function sha256File(path) {
  return sha256(readFileSync(path));
}

// Recursively list files under dir, skipping the given directory names.
export function listFiles(dir, { skipDirs = new Set(), skipFiles = new Set([".DS_Store"]) } = {}) {
  const out = [];
  const walk = (d) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (skipFiles.has(e.name)) continue;
      const full = join(d, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        if (!skipDirs.has(e.name)) walk(full);
      } else if (e.isFile()) {
        out.push(full);
      }
    }
  };
  walk(dir);
  return out;
}

// Content-hash manifest of the editor project tree (the editor-owned state).
export function projectManifest() {
  const projDir = join(fixtureRoot, "editor-project");
  const files = listFiles(projDir);
  const manifest = Object.create(null);
  for (const f of files) {
    manifest[relative(fixtureRoot, f)] = sha256File(f);
  }
  return manifest;
}

export function manifestHash(manifest) {
  return sha256(JSON.stringify(manifest, Object.keys(manifest).sort()));
}

// Stat manifest (path -> size:mtimeMs) used by the worktree confinement audit.
export function statManifest(rootDir, { skipDirs }) {
  const files = listFiles(rootDir, { skipDirs });
  const manifest = Object.create(null);
  for (const f of files) {
    const st = statSync(f);
    manifest[relative(rootDir, f)] = `${st.size}:${Math.floor(st.mtimeMs)}`;
  }
  return manifest;
}

export function validateRecordedGenerationPair(gen1, gen2, rootDir) {
  const generated1 = Object.keys(gen1.files).filter((file) => /\.(ts|js)$/.test(file)).sort();
  const generated2 = Object.keys(gen2.files).filter((file) => /\.(ts|js)$/.test(file)).sort();
  const problems = [];

  if (generated1.length === 0) problems.push("no generated files recorded in compile-1 bracket");
  if (!isDeepStrictEqual(generated1, generated2)) {
    problems.push("generated file set drifted between runs");
  }
  for (const file of generated1) {
    if (gen1.files[file] !== gen2.files[file]) {
      problems.push(`generation drift between runs: ${file}`);
      continue;
    }
    const absolute = join(rootDir, file);
    if (!existsSync(absolute)) problems.push(`recorded generated file missing: ${file}`);
    else if (sha256File(absolute) !== gen1.files[file]) {
      problems.push(`committed bytes differ from recorded generation: ${file}`);
    }
  }

  const inputs1 = Object.keys(gen1.files).filter((file) => !/\.(ts|js)$/.test(file)).sort();
  const inputs2 = Object.keys(gen2.files).filter((file) => !/\.(ts|js)$/.test(file)).sort();
  if (!isDeepStrictEqual(inputs1, inputs2)) {
    problems.push("editor input file set changed between generation runs");
  }
  for (const file of inputs1) {
    if (gen1.files[file] !== gen2.files[file]) {
      problems.push(`editor input changed between generation runs: ${file}`);
      continue;
    }
    const absolute = join(rootDir, file);
    if (!existsSync(absolute)) problems.push(`recorded editor input missing: ${file}`);
    else if (sha256File(absolute) !== gen1.files[file]) {
      problems.push(`committed editor input differs from recorded generation: ${file}`);
    }
  }

  return { problems, generatedCount: generated1.length };
}
