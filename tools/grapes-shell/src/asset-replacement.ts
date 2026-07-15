import type { AssetManifest } from "./contract.ts";

interface ReplaceableImageComponent {
  getAttributes(): Record<string, string>;
  set(value: { readonly src: string; readonly attributes: Record<string, string> }): void;
}

export interface ExactAssetReplacement {
  readonly src: string;
  readonly role: string;
  readonly sha256: string;
}

export function exactAssetReplacement(manifest: AssetManifest, src: string): ExactAssetReplacement {
  const prefix = "/marble-assets/";
  const asset = manifest.assets.find((candidate) => candidate.tray && `${prefix}${candidate.file}` === src);
  if (!asset) throw new Error(`Asset Manager selection is not a curated Marble tray asset: ${src}`);
  return { src, role: asset.role, sha256: asset.sha256 };
}

export function applyExactAssetReplacement(
  component: ReplaceableImageComponent,
  manifest: AssetManifest,
  src: string,
): ExactAssetReplacement {
  const replacement = exactAssetReplacement(manifest, src);
  component.set({
    src: replacement.src,
    attributes: {
      ...component.getAttributes(),
      src: replacement.src,
      "data-asset-role": replacement.role,
      "data-asset-sha": replacement.sha256,
    },
  });
  return replacement;
}
