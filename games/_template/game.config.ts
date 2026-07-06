// The game's declarative contract with the DOM shell. The shell consumes this;
// the game never reaches into shell internals. Shape matches the design-sheets
// fabrikav2 ingester contract (id/title/screens drive structural page cards).
// `create-game` substitutes id + title; everything else is edited per game.
export const gameConfig = {
  id: "template",
  title: "Template Game",
  screens: ["HomeMenu"],
  saga: { levels: 1 },
  economy: { softCurrency: "coins" },
  adPlacements: [],
  productCatalog: [],
  analyticsEvents: ["level_start", "level_end"],
} as const;
