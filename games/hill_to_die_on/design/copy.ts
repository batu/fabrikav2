// Shared design-sheet identity. Game action copy lives in ui-copy.ts.
export const copyLocale = "en";

export const copy = {
  "game.title": "This is my hill to die on",
  "currency.label": "Salvage",
} as const;

export type CopyKey = keyof typeof copy;
