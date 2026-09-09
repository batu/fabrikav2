// The game's declarative contract with the DOM shell. The shell consumes this;
// the game never reaches into shell internals. Shape matches the design-sheets
// fabrikav2 ingester contract (id/title/screens drive structural page cards).
// `create-game` substitutes id + the "game.title" copy value; everything else is
// edited per game.
import type { CopyKey } from "./design/copy.ts";

export const gameConfig = {
  id: "hill_to_die_on",
  // `title` is a copy KEY (typed CopyKey), never a literal user-facing string:
  // the actual title lives in design/copy.ts and a reskin edits it through the
  // design sheet. `satisfies CopyKey` fails typecheck if a literal is pasted here.
  title: "game.title" satisfies CopyKey,
  screens: ["home", "combat", "cards", "ready", "pause", "victory", "defeat"],
  saga: { levels: 2, wavesPerLevel: 10 },
  economy: { softCurrency: "salvage" },
  adPlacements: [],
  productCatalog: [],
  analyticsEvents: [],
} as const;
