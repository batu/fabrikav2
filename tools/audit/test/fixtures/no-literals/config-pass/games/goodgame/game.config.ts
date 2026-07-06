// PASS: the title is a copy KEY (dotted identifier referencing design/copy.ts),
// the sanctioned pattern. Non-copy single-token values (id, screen, currency,
// event ids) contain no whitespace and are not user-facing copy.
export const gameConfig = {
  id: "goodgame",
  title: "game.title",
  screens: ["HomeMenu", "ResultCard"],
  economy: { softCurrency: "coins" },
  analyticsEvents: ["level_start", "level_complete"],
} as const;
