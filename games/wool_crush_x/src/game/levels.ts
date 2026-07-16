import type { Cell, ThreadDefinition, WoolCrushLevel } from "./WoolCrushEngine.ts";

function horizontal(id: string, color: string, y: number, start: number, length: number): ThreadDefinition {
  const cells: Cell[] = Array.from({ length }, (_, offset) => ({ x: start + offset, y }));
  return { id, color, cells, exit: { x: 1, y: 0 } };
}

export const WOOL_CRUSH_LEVELS: readonly WoolCrushLevel[] = [
  {
    id: "wool-01",
    width: 3,
    height: 3,
    visibleSections: 3,
    catDistance: 5,
    threads: [horizontal("red", "red", 0, 0, 2), horizontal("blue", "blue", 1, 0, 2), horizontal("gold", "gold", 2, 0, 2)],
    dragon: ["red", "red", "blue", "blue", "gold", "gold"],
  },
  {
    id: "wool-02",
    width: 5,
    height: 4,
    visibleSections: 3,
    catDistance: 7,
    threads: [
      horizontal("coral-long", "coral", 0, 0, 3),
      horizontal("mint", "mint", 1, 1, 2),
      horizontal("lilac", "lilac", 2, 2, 2),
      horizontal("sky", "sky", 3, 1, 2),
      horizontal("coral-short", "coral", 1, 0, 1),
    ],
    dragon: ["coral", "coral", "coral", "mint", "mint", "lilac", "lilac", "sky", "sky", "coral"],
  },
  {
    id: "wool-03",
    width: 6,
    height: 5,
    visibleSections: 3,
    catDistance: 9,
    threads: [
      horizontal("red-a", "red", 0, 0, 3),
      horizontal("blue", "blue", 1, 2, 3),
      horizontal("green", "green", 2, 3, 2),
      horizontal("gold", "gold", 3, 1, 3),
      horizontal("purple", "purple", 4, 2, 3),
      horizontal("red-b", "red", 3, 0, 1),
    ],
    dragon: ["red", "red", "red", "blue", "blue", "blue", "green", "green", "gold", "gold", "gold", "purple", "purple", "purple", "red"],
  },
] as const;

export function getWoolCrushLevel(id: string): WoolCrushLevel | undefined {
  return WOOL_CRUSH_LEVELS.find((level) => level.id === id);
}
