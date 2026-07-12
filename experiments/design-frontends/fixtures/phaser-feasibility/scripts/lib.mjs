// Shared helpers for the probe's evidence scripts.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
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
export function listFiles(dir, { skipDirs = new Set() } = {}) {
  const out = [];
  const walk = (d) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
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
  const files = listFiles(projDir, { skipDirs: new Set([".DS_Store"]) });
  const manifest = {};
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
  const manifest = {};
  for (const f of files) {
    const st = statSync(f);
    manifest[relative(rootDir, f)] = `${st.size}:${Math.floor(st.mtimeMs)}`;
  }
  return manifest;
}
