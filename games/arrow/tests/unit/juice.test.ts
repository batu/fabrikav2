import { describe, expect, it } from "vitest";

import {
  DEFAULT_JUICE,
  applyPreset,
  setKnob,
  toAnimConfig,
  validate,
  type JuiceSettings,
} from "../../src/game/juice.js";

describe("DEFAULT_JUICE", () => {
  it("is the medium preset", () => {
    expect(DEFAULT_JUICE.preset).toBe("medium");
    expect(DEFAULT_JUICE.windupEnabled).toBe(true);
    expect(DEFAULT_JUICE.neighborJiggle).toBe(false);
  });
});

describe("applyPreset", () => {
  it("off preset disables every toggle and zeroes optional magnitudes", () => {
    const j = applyPreset("off", DEFAULT_JUICE);
    expect(j.preset).toBe("off");
    expect(j.windupEnabled).toBe(false);
    expect(j.exitStreakFade).toBe(false);
    expect(j.headRecoil).toBe(false);
    expect(j.bodyShake).toBe(false);
    expect(j.redFlashPulse).toBe(false);
    expect(j.neighborJiggle).toBe(false);
    expect(j.jiggleMagnitudePx).toBe(0);
  });

  it("minimal preset keeps flash + normal speed but no motion juice", () => {
    const j = applyPreset("minimal", DEFAULT_JUICE);
    expect(j.preset).toBe("minimal");
    expect(j.redFlashPulse).toBe(true);
    expect(j.windupEnabled).toBe(false);
    expect(j.headRecoil).toBe(false);
    expect(j.bodyShake).toBe(false);
    expect(j.exitStreakFade).toBe(false);
    expect(j.neighborJiggle).toBe(false);
  });

  it("medium preset is the shipping default: windup + fade + recoil + shake + flash, no jiggle", () => {
    const j = applyPreset("medium", DEFAULT_JUICE);
    expect(j.preset).toBe("medium");
    expect(j.windupEnabled).toBe(true);
    expect(j.exitStreakFade).toBe(true);
    expect(j.headRecoil).toBe(true);
    expect(j.bodyShake).toBe(true);
    expect(j.redFlashPulse).toBe(true);
    expect(j.neighborJiggle).toBe(false);
    expect(j.jiggleMagnitudePx).toBe(0);
  });

  it("full preset enables everything including jiggle", () => {
    const j = applyPreset("full", DEFAULT_JUICE);
    expect(j.preset).toBe("full");
    expect(j.neighborJiggle).toBe(true);
    expect(j.jiggleMagnitudePx).toBeGreaterThan(0);
  });

  it("custom preserves the user's current values and just flips the preset label", () => {
    const custom: JuiceSettings = {
      ...DEFAULT_JUICE,
      preset: "medium",
      slitherCellsPerSec: 18,
      neighborJiggle: true,
      jiggleMagnitudePx: 5,
    };
    const j = applyPreset("custom", custom);
    expect(j.preset).toBe("custom");
    expect(j.slitherCellsPerSec).toBe(18);
    expect(j.neighborJiggle).toBe(true);
    expect(j.jiggleMagnitudePx).toBe(5);
  });
});

describe("setKnob", () => {
  it("updates a single boolean and auto-promotes preset to custom", () => {
    const before: JuiceSettings = { ...DEFAULT_JUICE }; // preset: medium
    const after = setKnob(before, "bodyShake", false);
    expect(after.bodyShake).toBe(false);
    expect(after.preset).toBe("custom");
    // Unrelated fields untouched.
    expect(after.windupDurationMs).toBe(before.windupDurationMs);
  });

  it("updates a numeric knob and auto-promotes preset to custom", () => {
    const before: JuiceSettings = { ...DEFAULT_JUICE };
    const after = setKnob(before, "slitherCellsPerSec", 18);
    expect(after.slitherCellsPerSec).toBe(18);
    expect(after.preset).toBe("custom");
  });

  it("setting a value already in custom state stays custom", () => {
    const before: JuiceSettings = { ...DEFAULT_JUICE, preset: "custom" };
    const after = setKnob(before, "windupDurationMs", 50);
    expect(after.preset).toBe("custom");
    expect(after.windupDurationMs).toBe(50);
  });

  it("is a no-op when value matches current (no reallocation needed semantically, but safe)", () => {
    const before: JuiceSettings = { ...DEFAULT_JUICE };
    const after = setKnob(before, "windupEnabled", before.windupEnabled);
    expect(after.windupEnabled).toBe(before.windupEnabled);
    // Preset still flips to custom because the API is always-promote;
    // this guards against a shortcut bug where same-value is treated
    // specially.
    expect(after.preset).toBe("custom");
  });
});

describe("validate", () => {
  it("returns a full JuiceSettings from an empty partial (falls back to DEFAULT)", () => {
    const j = validate({});
    expect(j).toEqual(DEFAULT_JUICE);
  });

  it("clamps slitherCellsPerSec below its minimum", () => {
    const j = validate({ slitherCellsPerSec: -5 });
    expect(j.slitherCellsPerSec).toBe(6);
  });

  it("clamps slitherCellsPerSec above its maximum", () => {
    const j = validate({ slitherCellsPerSec: 999 });
    expect(j.slitherCellsPerSec).toBe(24);
  });

  it("clamps windupDurationMs to [0, 200]", () => {
    expect(validate({ windupDurationMs: -50 }).windupDurationMs).toBe(0);
    expect(validate({ windupDurationMs: 500 }).windupDurationMs).toBe(200);
  });

  it("clamps collisionHoldMs to [100, 400]", () => {
    expect(validate({ collisionHoldMs: 0 }).collisionHoldMs).toBe(100);
    expect(validate({ collisionHoldMs: 9999 }).collisionHoldMs).toBe(400);
  });

  it("clamps jiggleMagnitudePx to [0, 6]", () => {
    expect(validate({ jiggleMagnitudePx: -1 }).jiggleMagnitudePx).toBe(0);
    expect(validate({ jiggleMagnitudePx: 42 }).jiggleMagnitudePx).toBe(6);
  });

  it("clamps animSkipMs to [0, 200]", () => {
    expect(validate({ animSkipMs: -100 }).animSkipMs).toBe(0);
    expect(validate({ animSkipMs: 9999 }).animSkipMs).toBe(200);
  });

  it("defaults animSkipMs to 0 when missing", () => {
    expect(validate({}).animSkipMs).toBe(0);
  });

  it("coerces non-boolean truthy values to true and non-boolean falsy to false", () => {
    // Simulates a corrupt stored value like string "true"
    const raw = { windupEnabled: "true" as unknown as boolean };
    const j = validate(raw);
    expect(j.windupEnabled).toBe(true);
  });

  it("accepts a valid Custom preset full payload verbatim", () => {
    const payload: JuiceSettings = {
      preset: "custom",
      windupEnabled: false,
      windupDurationMs: 40,
      slitherCellsPerSec: 18,
      collisionHoldMs: 200,
      exitStreakFade: true,
      headRecoil: false,
      bodyShake: true,
      redFlashPulse: true,
      neighborJiggle: true,
      jiggleMagnitudePx: 4,
      animSkipMs: 60,
    };
    expect(validate(payload)).toEqual(payload);
  });

  it("rejects an unknown preset string and falls back to DEFAULT preset", () => {
    const j = validate({ preset: "gremlin" as unknown as "custom" });
    expect(j.preset).toBe(DEFAULT_JUICE.preset);
  });
});

describe("toAnimConfig", () => {
  it("extracts the animation-relevant subset of a JuiceSettings", () => {
    const cfg = toAnimConfig(DEFAULT_JUICE);
    expect(cfg).toEqual({
      windupEnabled: DEFAULT_JUICE.windupEnabled,
      windupDurationMs: DEFAULT_JUICE.windupDurationMs,
      slitherCellsPerSec: DEFAULT_JUICE.slitherCellsPerSec,
      collisionHoldMs: DEFAULT_JUICE.collisionHoldMs,
      exitStreakFade: DEFAULT_JUICE.exitStreakFade,
      headRecoil: DEFAULT_JUICE.headRecoil,
      bodyShake: DEFAULT_JUICE.bodyShake,
      animSkipMs: DEFAULT_JUICE.animSkipMs,
    });
  });

  it("forwards animSkipMs into the anim config for pre-roll skip", () => {
    const s: JuiceSettings = { ...DEFAULT_JUICE, animSkipMs: 80 };
    expect(toAnimConfig(s).animSkipMs).toBe(80);
  });

  it("does not leak the UI-only fields (preset, flash pulse, jiggle)", () => {
    const cfg = toAnimConfig(DEFAULT_JUICE) as unknown as Record<string, unknown>;
    expect(cfg.preset).toBeUndefined();
    expect(cfg.redFlashPulse).toBeUndefined();
    expect(cfg.neighborJiggle).toBeUndefined();
    expect(cfg.jiggleMagnitudePx).toBeUndefined();
  });
});
