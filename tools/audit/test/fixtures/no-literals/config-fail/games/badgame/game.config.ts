// FAIL: `title` is a raw user-facing string literal, not a copy key. This is
// the drift the config-copy scan catches (research 10 finding 9).
export const gameConfig = {
  id: "badgame",
  title: "Marble Madness Deluxe",
  screens: ["HomeMenu"],
  economy: { softCurrency: "coins" },
} as const;
