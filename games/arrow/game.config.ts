// The game's declarative contract with the DOM shell. The shell consumes this;
// the game never reaches into shell internals. Shape matches the design-sheets
// fabrikav2 ingester contract (id/title/screens drive structural page cards).
// `create-game` substitutes id + the "game.title" copy value; everything else is
// edited per game.
import type { GameConfig } from "@fabrikav2/kernel";
import type { CopyKey } from "./design/copy.ts";

export const gameConfig = {
  id: "arrow",
  // `title` is a copy KEY (typed CopyKey), never a literal user-facing string:
  // the actual title lives in design/copy.ts and a reskin edits it through the
  // design sheet. `satisfies CopyKey` fails typecheck if a literal is pasted here.
  title: "game.title" satisfies CopyKey,
  screens: ["HomeMenu", "SagaMap", "Settings", "ResultCard", "PauseOverlay"],
  saga: { levels: 40 },
  economy: { softCurrency: "coins" },
  adPlacements: [],
  productCatalog: [],
  // Canonical @fabrikav2/sdk analytics events (see packages/sdk analytics contract).
  analyticsEvents: ["level_start", "level_complete", "level_fail"],
} as const satisfies GameConfig;
