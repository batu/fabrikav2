import { parseShellAssetCatalog, type ShellAssetCatalog } from "@fabrikav2/kernel";

import rawSeedManifest from "../../../../games/_template/design/kenney-seed.manifest.json";

// The editor bundles the exact U2 manifest as declarative data and never fetches
// its source URLs. Its single asset vocabulary is U1's canonical asset catalog,
// validated here through the kernel so a malformed bundle fails at build/import.
export const editorAssetCatalog: ShellAssetCatalog = parseShellAssetCatalog(
  (rawSeedManifest as { assetCatalog: unknown }).assetCatalog,
);
