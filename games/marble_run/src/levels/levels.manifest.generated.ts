/**
 * GENERATED FILE — do not edit by hand. Run `npm run gen:levels`.
 * Per-level funnel + shape metadata for downstream theming (MRB-5).
 */
import type { ShapeKind } from '../marble-board/shapes';
import type { Slot } from './funnel-schedule';

export interface LevelManifestEntry {
  readonly id: number;
  readonly slot: Slot;
  readonly target: number;
  readonly shapeKind: ShapeKind;
  /** True iff the baked board is a perfect left-right mirror (distance 0). */
  readonly symmetric: boolean;
}

export const LEVEL_MANIFEST: readonly LevelManifestEntry[] = [
  {
    "id": 1,
    "slot": "onboarding",
    "target": 1,
    "shapeKind": "plain",
    "symmetric": false
  },
  {
    "id": 2,
    "slot": "onboarding",
    "target": 1,
    "shapeKind": "plain",
    "symmetric": false
  },
  {
    "id": 3,
    "slot": "onboarding",
    "target": 2,
    "shapeKind": "plain",
    "symmetric": true
  },
  {
    "id": 4,
    "slot": "onboarding",
    "target": 3,
    "shapeKind": "plain",
    "symmetric": false
  },
  {
    "id": 5,
    "slot": "onboarding",
    "target": 4,
    "shapeKind": "plain",
    "symmetric": false
  },
  {
    "id": 6,
    "slot": "onboarding",
    "target": 5,
    "shapeKind": "twin-holes",
    "symmetric": true
  },
  {
    "id": 7,
    "slot": "onboarding",
    "target": 6,
    "shapeKind": "plain",
    "symmetric": false
  },
  {
    "id": 8,
    "slot": "onboarding",
    "target": 7,
    "shapeKind": "checker-plugs",
    "symmetric": false
  },
  {
    "id": 9,
    "slot": "onboarding",
    "target": 8,
    "shapeKind": "twin-holes",
    "symmetric": true
  },
  {
    "id": 10,
    "slot": "onboarding",
    "target": 9,
    "shapeKind": "pillars",
    "symmetric": false
  },
  {
    "id": 11,
    "slot": "onboarding",
    "target": 10,
    "shapeKind": "checker-plugs",
    "symmetric": false
  },
  {
    "id": 12,
    "slot": "band",
    "target": 11,
    "shapeKind": "plain",
    "symmetric": true
  },
  {
    "id": 13,
    "slot": "band",
    "target": 11,
    "shapeKind": "plain",
    "symmetric": false
  },
  {
    "id": 14,
    "slot": "relax",
    "target": 7,
    "shapeKind": "plain",
    "symmetric": false
  },
  {
    "id": 15,
    "slot": "band",
    "target": 11,
    "shapeKind": "twin-holes",
    "symmetric": true
  },
  {
    "id": 16,
    "slot": "spike",
    "target": 16,
    "shapeKind": "butterfly",
    "symmetric": false
  },
  {
    "id": 17,
    "slot": "recover",
    "target": 7,
    "shapeKind": "plain",
    "symmetric": false
  },
  {
    "id": 18,
    "slot": "band",
    "target": 12,
    "shapeKind": "corners",
    "symmetric": true
  },
  {
    "id": 19,
    "slot": "band",
    "target": 13,
    "shapeKind": "frame-notch",
    "symmetric": false
  },
  {
    "id": 20,
    "slot": "band",
    "target": 14,
    "shapeKind": "twin-holes",
    "symmetric": true
  },
  {
    "id": 21,
    "slot": "spike",
    "target": 17,
    "shapeKind": "hourglass",
    "symmetric": false
  },
  {
    "id": 22,
    "slot": "recover",
    "target": 7,
    "shapeKind": "plain",
    "symmetric": false
  },
  {
    "id": 23,
    "slot": "band",
    "target": 15,
    "shapeKind": "checker-plugs",
    "symmetric": true
  },
  {
    "id": 24,
    "slot": "band",
    "target": 11,
    "shapeKind": "plain",
    "symmetric": false
  },
  {
    "id": 25,
    "slot": "band",
    "target": 12,
    "shapeKind": "corners",
    "symmetric": false
  },
  {
    "id": 26,
    "slot": "spike",
    "target": 18,
    "shapeKind": "cross",
    "symmetric": true
  },
  {
    "id": 27,
    "slot": "recover",
    "target": 7,
    "shapeKind": "plain",
    "symmetric": false
  },
  {
    "id": 28,
    "slot": "band",
    "target": 13,
    "shapeKind": "pillars",
    "symmetric": false
  },
  {
    "id": 29,
    "slot": "band",
    "target": 14,
    "shapeKind": "checker-plugs",
    "symmetric": true
  },
  {
    "id": 30,
    "slot": "climax",
    "target": 19,
    "shapeKind": "hourglass",
    "symmetric": false
  },
  {
    "id": 31,
    "slot": "ramp",
    "target": 5,
    "shapeKind": "plain",
    "symmetric": false
  },
  {
    "id": 32,
    "slot": "ramp",
    "target": 7,
    "shapeKind": "plain",
    "symmetric": true
  },
  {
    "id": 33,
    "slot": "ramp",
    "target": 10,
    "shapeKind": "twin-holes",
    "symmetric": false
  },
  {
    "id": 34,
    "slot": "band",
    "target": 12,
    "shapeKind": "pillars",
    "symmetric": false
  },
  {
    "id": 35,
    "slot": "spike",
    "target": 17,
    "shapeKind": "arena",
    "symmetric": true
  },
  {
    "id": 36,
    "slot": "recover",
    "target": 7,
    "shapeKind": "plain",
    "symmetric": false
  },
  {
    "id": 37,
    "slot": "band",
    "target": 13,
    "shapeKind": "corners",
    "symmetric": false
  },
  {
    "id": 38,
    "slot": "band",
    "target": 14,
    "shapeKind": "frame-notch",
    "symmetric": true
  },
  {
    "id": 39,
    "slot": "band",
    "target": 15,
    "shapeKind": "twin-holes",
    "symmetric": false
  },
  {
    "id": 40,
    "slot": "spike",
    "target": 18,
    "shapeKind": "butterfly",
    "symmetric": true
  },
  {
    "id": 41,
    "slot": "recover",
    "target": 7,
    "shapeKind": "plain",
    "symmetric": false
  },
  {
    "id": 42,
    "slot": "band",
    "target": 16,
    "shapeKind": "corners",
    "symmetric": false
  },
  {
    "id": 43,
    "slot": "band",
    "target": 12,
    "shapeKind": "frame-notch",
    "symmetric": true
  },
  {
    "id": 44,
    "slot": "band",
    "target": 13,
    "shapeKind": "twin-holes",
    "symmetric": false
  },
  {
    "id": 45,
    "slot": "spike",
    "target": 18,
    "shapeKind": "hourglass",
    "symmetric": false
  },
  {
    "id": 46,
    "slot": "recover",
    "target": 7,
    "shapeKind": "plain",
    "symmetric": true
  },
  {
    "id": 47,
    "slot": "band",
    "target": 14,
    "shapeKind": "checker-plugs",
    "symmetric": false
  },
  {
    "id": 48,
    "slot": "band",
    "target": 15,
    "shapeKind": "plain",
    "symmetric": false
  },
  {
    "id": 49,
    "slot": "climax",
    "target": 20,
    "shapeKind": "cross",
    "symmetric": true
  },
  {
    "id": 50,
    "slot": "ramp",
    "target": 5,
    "shapeKind": "plain",
    "symmetric": false
  },
  {
    "id": 51,
    "slot": "ramp",
    "target": 7,
    "shapeKind": "plain",
    "symmetric": false
  },
  {
    "id": 52,
    "slot": "ramp",
    "target": 10,
    "shapeKind": "pillars",
    "symmetric": true
  },
  {
    "id": 53,
    "slot": "band",
    "target": 13,
    "shapeKind": "checker-plugs",
    "symmetric": false
  },
  {
    "id": 54,
    "slot": "spike",
    "target": 18,
    "shapeKind": "diamond",
    "symmetric": false
  },
  {
    "id": 55,
    "slot": "recover",
    "target": 7,
    "shapeKind": "plain",
    "symmetric": true
  },
  {
    "id": 56,
    "slot": "band",
    "target": 14,
    "shapeKind": "frame-notch",
    "symmetric": false
  },
  {
    "id": 57,
    "slot": "band",
    "target": 15,
    "shapeKind": "twin-holes",
    "symmetric": false
  },
  {
    "id": 58,
    "slot": "band",
    "target": 16,
    "shapeKind": "pillars",
    "symmetric": true
  },
  {
    "id": 59,
    "slot": "spike",
    "target": 18,
    "shapeKind": "arena",
    "symmetric": false
  },
  {
    "id": 60,
    "slot": "recover",
    "target": 7,
    "shapeKind": "plain",
    "symmetric": true
  },
  {
    "id": 61,
    "slot": "band",
    "target": 17,
    "shapeKind": "corners",
    "symmetric": false
  },
  {
    "id": 62,
    "slot": "band",
    "target": 13,
    "shapeKind": "frame-notch",
    "symmetric": false
  },
  {
    "id": 63,
    "slot": "band",
    "target": 14,
    "shapeKind": "twin-holes",
    "symmetric": true
  },
  {
    "id": 64,
    "slot": "spike",
    "target": 18,
    "shapeKind": "butterfly",
    "symmetric": false
  },
  {
    "id": 65,
    "slot": "recover",
    "target": 7,
    "shapeKind": "plain",
    "symmetric": false
  },
  {
    "id": 66,
    "slot": "band",
    "target": 15,
    "shapeKind": "corners",
    "symmetric": true
  },
  {
    "id": 67,
    "slot": "band",
    "target": 16,
    "shapeKind": "frame-notch",
    "symmetric": false
  },
  {
    "id": 68,
    "slot": "climax",
    "target": 19,
    "shapeKind": "ring",
    "symmetric": false
  },
  {
    "id": 69,
    "slot": "ramp",
    "target": 5,
    "shapeKind": "plain",
    "symmetric": true
  },
  {
    "id": 70,
    "slot": "ramp",
    "target": 7,
    "shapeKind": "plain",
    "symmetric": false
  },
  {
    "id": 71,
    "slot": "ramp",
    "target": 10,
    "shapeKind": "checker-plugs",
    "symmetric": false
  },
  {
    "id": 72,
    "slot": "band",
    "target": 14,
    "shapeKind": "plain",
    "symmetric": true
  },
  {
    "id": 73,
    "slot": "spike",
    "target": 18,
    "shapeKind": "ring",
    "symmetric": false
  },
  {
    "id": 74,
    "slot": "recover",
    "target": 7,
    "shapeKind": "plain",
    "symmetric": false
  },
  {
    "id": 75,
    "slot": "band",
    "target": 15,
    "shapeKind": "twin-holes",
    "symmetric": true
  },
  {
    "id": 76,
    "slot": "band",
    "target": 16,
    "shapeKind": "pillars",
    "symmetric": false
  },
  {
    "id": 77,
    "slot": "band",
    "target": 17,
    "shapeKind": "checker-plugs",
    "symmetric": false
  },
  {
    "id": 78,
    "slot": "spike",
    "target": 18,
    "shapeKind": "diamond",
    "symmetric": true
  },
  {
    "id": 79,
    "slot": "recover",
    "target": 7,
    "shapeKind": "plain",
    "symmetric": false
  },
  {
    "id": 80,
    "slot": "band",
    "target": 18,
    "shapeKind": "frame-notch",
    "symmetric": true
  },
  {
    "id": 81,
    "slot": "band",
    "target": 14,
    "shapeKind": "twin-holes",
    "symmetric": false
  },
  {
    "id": 82,
    "slot": "band",
    "target": 15,
    "shapeKind": "pillars",
    "symmetric": false
  },
  {
    "id": 83,
    "slot": "spike",
    "target": 18,
    "shapeKind": "arena",
    "symmetric": true
  },
  {
    "id": 84,
    "slot": "recover",
    "target": 7,
    "shapeKind": "plain",
    "symmetric": false
  },
  {
    "id": 85,
    "slot": "band",
    "target": 16,
    "shapeKind": "corners",
    "symmetric": false
  },
  {
    "id": 86,
    "slot": "band",
    "target": 17,
    "shapeKind": "frame-notch",
    "symmetric": true
  },
  {
    "id": 87,
    "slot": "climax",
    "target": 20,
    "shapeKind": "arena",
    "symmetric": false
  },
  {
    "id": 88,
    "slot": "ramp",
    "target": 5,
    "shapeKind": "plain",
    "symmetric": false
  },
  {
    "id": 89,
    "slot": "ramp",
    "target": 7,
    "shapeKind": "plain",
    "symmetric": true
  },
  {
    "id": 90,
    "slot": "ramp",
    "target": 10,
    "shapeKind": "corners",
    "symmetric": false
  },
  {
    "id": 91,
    "slot": "band",
    "target": 14,
    "shapeKind": "frame-notch",
    "symmetric": false
  },
  {
    "id": 92,
    "slot": "spike",
    "target": 18,
    "shapeKind": "cross",
    "symmetric": true
  },
  {
    "id": 93,
    "slot": "recover",
    "target": 7,
    "shapeKind": "plain",
    "symmetric": false
  },
  {
    "id": 94,
    "slot": "band",
    "target": 15,
    "shapeKind": "pillars",
    "symmetric": false
  },
  {
    "id": 95,
    "slot": "band",
    "target": 16,
    "shapeKind": "checker-plugs",
    "symmetric": true
  },
  {
    "id": 96,
    "slot": "band",
    "target": 17,
    "shapeKind": "plain",
    "symmetric": false
  },
  {
    "id": 97,
    "slot": "spike",
    "target": 18,
    "shapeKind": "ring",
    "symmetric": false
  },
  {
    "id": 98,
    "slot": "recover",
    "target": 7,
    "shapeKind": "plain",
    "symmetric": true
  },
  {
    "id": 99,
    "slot": "band",
    "target": 18,
    "shapeKind": "twin-holes",
    "symmetric": false
  },
  {
    "id": 100,
    "slot": "band",
    "target": 14,
    "shapeKind": "pillars",
    "symmetric": true
  },
  {
    "id": 101,
    "slot": "band",
    "target": 15,
    "shapeKind": "checker-plugs",
    "symmetric": false
  },
  {
    "id": 102,
    "slot": "spike",
    "target": 18,
    "shapeKind": "diamond",
    "symmetric": false
  },
  {
    "id": 103,
    "slot": "recover",
    "target": 7,
    "shapeKind": "plain",
    "symmetric": true
  },
  {
    "id": 104,
    "slot": "band",
    "target": 16,
    "shapeKind": "frame-notch",
    "symmetric": false
  },
  {
    "id": 105,
    "slot": "band",
    "target": 17,
    "shapeKind": "twin-holes",
    "symmetric": false
  },
  {
    "id": 106,
    "slot": "climax",
    "target": 19,
    "shapeKind": "hourglass",
    "symmetric": true
  },
  {
    "id": 107,
    "slot": "ramp",
    "target": 5,
    "shapeKind": "plain",
    "symmetric": false
  },
  {
    "id": 108,
    "slot": "ramp",
    "target": 7,
    "shapeKind": "plain",
    "symmetric": false
  },
  {
    "id": 109,
    "slot": "ramp",
    "target": 10,
    "shapeKind": "corners",
    "symmetric": true
  },
  {
    "id": 110,
    "slot": "band",
    "target": 14,
    "shapeKind": "frame-notch",
    "symmetric": false
  }
];
