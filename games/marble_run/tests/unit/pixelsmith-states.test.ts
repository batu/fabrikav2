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
  // UI-truth: win = a mounted+visible level-complete overlay; pause = the in-game
  // settings modal; settings = the menu (Close) settings modal. Internal flags
  // (status/lifecycleSuspended/settingsOpen) alone no longer satisfy — the
  // corrected predicates assert the actual surface (MRV2-8 defects 3/4).
  win: { activeScene: "GameScene", homeShellVisible: false, levelCompleteOverlayVisible: true },
  pause: { activeScene: "GameScene", homeShellVisible: false, settingsVariant: "ingame" },
  settings: { homeShellVisible: true, settingsVariant: "menu" },
};

describe("pixelsmith state vocabulary", () => {
  it("exposes the no-shop card-order states", () => {
    expect(PIXELSMITH_TOUR_STATES).toEqual([
      "home-fresh",
      "level-map",
      "gameplay-opener",
      "gameplay-plugs",
      "gameplay-voids",
      "gameplay-teach",
      "win",
      "pause",
      "settings",
    ]);
  });

  it("maps each gameplay-* state to a designated level index", () => {
    // v1 sugar3d parity against the byte-identical 110-level set (plugs = first
    // 'X' board @ 8, voids = first '#' board @ 6, opener/teach share level 1).
    expect(PIXELSMITH_STATE_LEVELS).toEqual({
      "gameplay-opener": 1,
      "gameplay-plugs": 8,
      "gameplay-voids": 6,
      "gameplay-teach": 1,
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

  it("rejects a stray shop surface from settings and home states", () => {
    // Menu settings = home shell + Close-variant modal (UI-truth); a bare
    // settingsOpen flag is no longer sufficient.
    expect(pixelsmithStatePredicates.settings({ homeShellVisible: true, settingsVariant: "menu" })).toBe(true);
    expect(pixelsmithStatePredicates.settings({ settingsOpen: true, homeShellVisible: true })).toBe(false);
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
