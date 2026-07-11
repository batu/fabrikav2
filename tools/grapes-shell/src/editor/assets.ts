/// <reference types="vite/client" />

import type { ShellAssetCatalogEntry } from "@fabrikav2/kernel";

const bundledAssetUrls = import.meta.glob("../../../../games/_template/design/assets/*.png", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

const urlByManifestPath = new Map<string, string>(
  Object.entries(bundledAssetUrls).map(([modulePath, url]) => {
    const filename = modulePath.split("/").at(-1);
    if (!filename) throw new Error(`Cannot resolve bundled editor asset path "${modulePath}".`);
    return [`assets/${filename}`, url] as const;
  }),
);

export function editorAssetUrl(asset: Pick<ShellAssetCatalogEntry, "path" | "id">): string {
  const url = urlByManifestPath.get(asset.path);
  if (!url) throw new Error(`Curated asset "${asset.id}" is not present in the bundled U2 seed.`);
  return url;
}
