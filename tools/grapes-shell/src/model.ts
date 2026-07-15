import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { REQUIRED_PAGES, type AssetManifest } from "./contract.ts";

export type { AssetManifest } from "./contract.ts";

type JsonRecord = Record<string, unknown>;

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as JsonRecord;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as JsonRecord).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function walkComponents(value: unknown, visit: (component: JsonRecord) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) walkComponents(item, visit);
    return;
  }
  if (!value || typeof value !== "object") return;
  const component = value as JsonRecord;
  visit(component);
  walkComponents(component.components, visit);
}

export function validateProjectData(value: unknown, manifest: AssetManifest): JsonRecord {
  const project = record(value, "GrapesJS project data");
  if (!Array.isArray(project.pages)) throw new Error("GrapesJS project data must contain pages.");
  const pages = project.pages.map((item, index) => record(item, `pages[${index}]`));
  const pageIds = pages.map((page) => page.id);
  if (JSON.stringify(pageIds) !== JSON.stringify(REQUIRED_PAGES)) {
    throw new Error(`Pages must be exactly ${REQUIRED_PAGES.join(", ")} in canonical order.`);
  }

  const exactAssets = new Map(manifest.assets.map((asset) => [`/marble-assets/${asset.file}`, asset]));
  const ids = new Set<string>();
  for (const page of pages) {
    const frames = Array.isArray(page.frames) ? page.frames.map((frame, index) => record(frame, `page ${String(page.id)} frames[${index}]`)) : [];
    const component = page.component
      ? record(page.component, `page ${String(page.id)} component`)
      : record(frames[0]?.component, `page ${String(page.id)} frame component`);
    const attributes = record(component.attributes, `page ${String(page.id)} attributes`);
    if (attributes["data-fab-page"] !== page.id) throw new Error(`Page ${String(page.id)} root is not self-identifying.`);
    if (component.style !== undefined) {
      const style = record(component.style, `page ${String(page.id)} style`);
      if (style.width !== "390px" || style.height !== "844px") throw new Error(`Page ${String(page.id)} must be 390x844.`);
    }

    walkComponents(component, (candidate) => {
      const attrs = candidate.attributes;
      if (!attrs || typeof attrs !== "object" || Array.isArray(attrs)) return;
      const componentAttrs = attrs as JsonRecord;
      const id = componentAttrs["data-fab-id"];
      if (id !== undefined) {
        if (typeof id !== "string" || !/^[a-z0-9][a-z0-9._-]*$/u.test(id)) throw new Error(`Invalid semantic instance id ${String(id)}.`);
        if (ids.has(id)) throw new Error(`Duplicate semantic instance id ${id}.`);
        ids.add(id);
        if (typeof componentAttrs["data-fab-role"] !== "string") throw new Error(`Instance ${id} is missing data-fab-role.`);
      }
      const src = candidate.src ?? componentAttrs.src;
      if (typeof src !== "string" || !src.startsWith("/marble-assets/")) return;
      const asset = exactAssets.get(src);
      if (!asset) throw new Error(`Component references uncurated asset ${src}.`);
      if (componentAttrs["data-asset-sha"] !== asset.sha256) throw new Error(`Asset hash metadata diverges for ${src}.`);
    });
  }
  if (ids.size < 50) throw new Error(`Project exposes only ${ids.size} semantic instances; expected at least 50.`);
  return structuredClone(project);
}

export async function verifyAssetBytes(assetRoot: string, manifest: AssetManifest): Promise<void> {
  for (const asset of [...manifest.assets, ...manifest.fonts]) {
    const bytes = await readFile(`${assetRoot}/${asset.file}`);
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (hash !== asset.sha256) throw new Error(`Exact bytes changed for ${asset.file}.`);
  }
}

export function publicationRevision(project: unknown, manifest: AssetManifest): string {
  const payload = {
    project,
    assets: manifest,
    profile: { game: "marble_run", frontend: "grapesjs", viewport: [390, 844], version: 1 },
  };
  return `sha256-${createHash("sha256").update(canonical(payload)).digest("hex")}`;
}
