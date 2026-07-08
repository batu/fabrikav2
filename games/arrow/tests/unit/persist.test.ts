/**
 * Progress persistence — schema versioning, v1→v2 migration, corrupt-payload
 * fallback, quota-exceeded resilience. Touches localStorage directly, so tests
 * run in happy-dom.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  LEGACY_PROGRESS_KEY,
  PROGRESS_KEY,
  load,
  packCompleted,
  recordJuice,
  recordLevelComplete,
  save,
} from "../../src/game/persist.js";
import { DEFAULT_JUICE } from "../../src/game/juice.js";

const KEY = PROGRESS_KEY;

// happy-dom doesn't always expose a working localStorage in this setup,
// so stub it with a map-backed implementation for these tests.
const store = new Map<string, string>();
const mockLocalStorage = {
  getItem: (k: string): string | null => store.get(k) ?? null,
  setItem: (k: string, v: string): void => { store.set(k, v); },
  removeItem: (k: string): void => { store.delete(k); },
  clear: (): void => { store.clear(); },
  key: (i: number): string | null => Array.from(store.keys())[i] ?? null,
  get length(): number { return store.size; },
};
vi.stubGlobal("localStorage", mockLocalStorage);

beforeEach(() => {
  store.clear();
});

describe("persist (v2)", () => {
  it("returns defaults when no saved progress exists", () => {
    const p = load();
    expect(p).toEqual({
      schema: "arrow-progress",
      version: 2,
      packProgress: {},
      mute: false,
      tutorialSeen: false,
      bestTimeSeconds: 0,
      completions: 0,
      juice: DEFAULT_JUICE,
    });
  });

  it("round-trips a valid save", () => {
    save({
      schema: "arrow-progress",
      version: 2,
      packProgress: { all: 4 },
      mute: true,
      tutorialSeen: true,
      bestTimeSeconds: 312,
      completions: 2,
      juice: DEFAULT_JUICE,
    });
    expect(load()).toEqual({
      schema: "arrow-progress",
      version: 2,
      packProgress: { all: 4 },
      mute: true,
      tutorialSeen: true,
      bestTimeSeconds: 312,
      completions: 2,
      juice: DEFAULT_JUICE,
    });
  });

  it("fills juice with defaults when a payload has no juice field", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        schema: "arrow-progress",
        version: 2,
        packProgress: { all: 7 },
      }),
    );
    const p = load();
    expect(packCompleted(p, "all")).toBe(7);
    expect(p.juice).toEqual(DEFAULT_JUICE);
  });

  it("rejects payloads with the wrong schema", () => {
    localStorage.setItem(KEY, JSON.stringify({ schema: "other", version: 2 }));
    const p = load();
    expect(p.schema).toBe("arrow-progress");
    expect(p.packProgress).toEqual({});
  });

  it("rejects payloads with an unknown version", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ schema: "arrow-progress", version: 99, packProgress: { foo: 5 } }),
    );
    const p = load();
    expect(p.packProgress).toEqual({});
  });

  it("handles malformed JSON without throwing", () => {
    localStorage.setItem(KEY, "{not-json");
    expect(() => load()).not.toThrow();
    expect(load().packProgress).toEqual({});
  });

  it("clamps packProgress counts at the carried pack length", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        schema: "arrow-progress",
        version: 2,
        packProgress: { all: 999999 },
      }),
    );
    expect(load().packProgress).toEqual({ all: 40 });
  });

  it("rejects array-typed packProgress (numeric-key slugs must not sneak through)", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ schema: "arrow-progress", version: 2, packProgress: [5, 3, 7] }),
    );
    expect(load().packProgress).toEqual({});
  });

  it("sanitizes packProgress: drops invalid slugs and non-finite counts", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        schema: "arrow-progress",
        version: 2,
        packProgress: {
          all: 5,
          "BAD SLUG": 3, // uppercase + space
          "ok-pack": -1, // negative
          "also-ok": "hello", // NaN
          "legit-two": 2,
        },
      }),
    );
    const p = load();
    expect(p.packProgress).toEqual({ all: 5, "legit-two": 2 });
  });

  it("recordLevelComplete only advances, never rewinds, per pack", () => {
    const p0 = load();
    const p1 = recordLevelComplete(p0, "all", 3);
    expect(packCompleted(p1, "all")).toBe(3);
    const p2 = recordLevelComplete(p1, "all", 2);
    expect(packCompleted(p2, "all")).toBe(3);
    const p3 = recordLevelComplete(p2, "all", 5);
    expect(packCompleted(p3, "all")).toBe(5);
  });

  it("recordLevelComplete tracks multiple packs independently", () => {
    const p0 = load();
    const p1 = recordLevelComplete(p0, "all", 10);
    const p2 = recordLevelComplete(p1, "bend-it", 3);
    expect(packCompleted(p2, "all")).toBe(10);
    expect(packCompleted(p2, "bend-it")).toBe(3);
  });

  it("recordJuice replaces just the juice field", () => {
    const p0 = load();
    const p1 = recordJuice(p0, {
      ...DEFAULT_JUICE,
      preset: "custom",
      slitherCellsPerSec: 20,
    });
    expect(p1.juice.slitherCellsPerSec).toBe(20);
    expect(p1.juice.preset).toBe("custom");
    expect(p1.packProgress).toEqual(p0.packProgress);
  });
});

describe("persist v1→v2 migration", () => {
  it("maps v1.highestLevelCompleted into packProgress.all", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        schema: "arrow-progress",
        version: 1,
        highestLevelCompleted: 6,
        mute: true,
        tutorialSeen: true,
        bestTimeSeconds: 200,
        completions: 1,
      }),
    );
    const p = load();
    expect(p.version).toBe(2);
    expect(p.packProgress).toEqual({ all: 6 });
    expect(p.mute).toBe(true);
    expect(p.tutorialSeen).toBe(true);
    expect(p.bestTimeSeconds).toBe(200);
    expect(p.completions).toBe(1);
  });

  it("caps the migrated count at the carried pack length", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ schema: "arrow-progress", version: 1, highestLevelCompleted: 42 }),
    );
    const p = load();
    expect(packCompleted(p, "all")).toBe(40);
  });

  it("reads the legacy v1 storage key when the v2 key has not been written", () => {
    localStorage.setItem(
      LEGACY_PROGRESS_KEY,
      JSON.stringify({ schema: "arrow-progress", version: 1, highestLevelCompleted: 3 }),
    );
    expect(load().packProgress).toEqual({ all: 3 });
  });

  it("migrates a zero-progress v1 to empty packProgress (not a 0 entry)", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ schema: "arrow-progress", version: 1, highestLevelCompleted: 0 }),
    );
    const p = load();
    expect(p.packProgress).toEqual({});
  });

  it("clamps negative v1 values to zero", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ schema: "arrow-progress", version: 1, highestLevelCompleted: -5 }),
    );
    expect(load().packProgress).toEqual({});
  });
});
