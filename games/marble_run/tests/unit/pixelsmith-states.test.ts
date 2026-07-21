import { describe, expect, it } from "vitest";
import {
  PIXELSMITH_STATE_LEVELS,
  PIXELSMITH_TOUR_STATES,
  isGameplayState,
  isPixelsmithState,
  pixelsmithStatePredicates,
  snapshotMatchesPixelsmithState,
  type PixelsmithState,
} from "../../src/testing/pixelsmithStates";

const SNAPSHOTS: Record<PixelsmithState, Record<string, unknown>> = {
  "home-fresh": { homeShellVisible: true, settingsOpen: false, shopOpen: false, levelMapVisible: false },
  "level-map": { homeShellVisible: true, levelMapVisible: true, settingsOpen: false, shopOpen: false },
  "gameplay-opener": { activeScene: "GameScene", status: "playing", levelDataReady: true, homeShellVisible: false, lives: 3 },
  "gameplay-plugs": { activeScene: "GameScene", status: "playing", levelDataReady: true, homeShellVisible: false, lives: 3 },
  "gameplay-voids": { activeScene: "GameScene", status: "playing", levelDataReady: true, homeShellVisible: false, lives: 3 },
  "gameplay-teach": { activeScene: "GameScene", status: "playing", levelDataReady: true, homeShellVisible: false, lives: 3 },
  win: { activeScene: "GameScene", status: "complete", levelComplete: true, homeShellVisible: false },
  pause: { activeScene: "GameScene", status: "paused", lifecycleSuspended: true, homeShellVisible: false },
  shop: { shopOpen: true, homeShellVisible: true },
  settings: { settingsOpen: true, homeShellVisible: true },
};

describe("pixelsmith state vocabulary", () => {
  it("exposes the ten card-order states", () => {
    expect(PIXELSMITH_TOUR_STATES).toEqual([
      "home-fresh",
      "level-map",
      "gameplay-opener",
      "gameplay-plugs",
      "gameplay-voids",
      "gameplay-teach",
      "win",
      "pause",
      "shop",
      "settings",
    ]);
  });

  it("maps each gameplay-* state to a designated level index", () => {
    expect(PIXELSMITH_STATE_LEVELS).toEqual({
      "gameplay-opener": 1,
      "gameplay-plugs": 2,
      "gameplay-voids": 3,
      "gameplay-teach": 4,
    });
  });

  it("recognizes pixelsmith and gameplay states, rejects unknowns", () => {
    expect(isPixelsmithState("home-fresh")).toBe(true);
    expect(isPixelsmithState("nope")).toBe(false);
    expect(isGameplayState("gameplay-plugs")).toBe(true);
    expect(isGameplayState("win")).toBe(false);
    expect(isGameplayState("nope")).toBe(false);
  });
});

describe("pixelsmith state predicates", () => {
  it("accepts the matching snapshot for every state", () => {
    for (const state of PIXELSMITH_TOUR_STATES) {
      expect(snapshotMatchesPixelsmithState(state, SNAPSHOTS[state])).toBe(true);
    }
  });

  it("keeps shop and settings mutually distinguishable", () => {
    expect(pixelsmithStatePredicates.shop({ shopOpen: true })).toBe(true);
    expect(pixelsmithStatePredicates.shop({ settingsOpen: true })).toBe(false);
    expect(pixelsmithStatePredicates.settings({ settingsOpen: true })).toBe(true);
    expect(pixelsmithStatePredicates.settings({ shopOpen: true })).toBe(false);
  });

  it("distinguishes home-fresh from level-map by the level-map signal", () => {
    expect(pixelsmithStatePredicates["level-map"](SNAPSHOTS["home-fresh"])).toBe(false);
    expect(pixelsmithStatePredicates["home-fresh"](SNAPSHOTS["home-fresh"])).toBe(true);
    // A page overlay (shop/settings) is not a home state.
    expect(pixelsmithStatePredicates["home-fresh"]({ homeShellVisible: true, shopOpen: true })).toBe(false);
  });

  it("gameplay states reuse the playing-level predicate (reject home/overlays)", () => {
    expect(pixelsmithStatePredicates["gameplay-opener"](SNAPSHOTS["gameplay-opener"])).toBe(true);
    expect(pixelsmithStatePredicates["gameplay-opener"](SNAPSHOTS["home-fresh"])).toBe(false);
    expect(pixelsmithStatePredicates["gameplay-opener"]({ ...SNAPSHOTS["gameplay-opener"], status: "complete" })).toBe(false);
  });

  it("returns false for an unknown state name without throwing", () => {
    expect(snapshotMatchesPixelsmithState("bogus" as PixelsmithState, {})).toBe(false);
  });
});
