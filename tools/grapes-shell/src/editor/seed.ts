import rawSeedManifest from "../../../../games/_template/design/kenney-seed.manifest.json";

import type { SeedManifest } from "../shared/project.ts";

// This is the exact U2 manifest bundled as declarative data. The editor never
// fetches its source URLs; it only uses the pinned semantic inventory below.
export const editorSeedManifest = rawSeedManifest as unknown as SeedManifest;
