/**
 * Unit tests for content/level-tools/levels-gen.mjs internals.
 *
 * Locks parseYaml's edge-case behavior (BOM, tabs, comments, flow
 * sequences, quoted strings) + validateRecipe's range-checking +
 * emitTs's stable string output. Without these tests, extending the
 * parser for new DSL features risks corrupting every yaml silently.
 */

import { describe, expect, it } from "vitest";

// @ts-expect-error — JS module without types; we treat the exports as unknown.
import { parseYaml, validateRecipe, emitTs, LEVEL_FILENAME } from "../../content/level-tools/levels-gen.mjs";

const VALID_RECIPE = `cols: 5
rows: 7
arrowCount: 3
opts:
  minLen: 2
  maxLen: 3
  bendProb: 0.1
seed: 101
blockedT1: [0, 1]
meta:
  pack: first-steps
  indexInPack: 1
  title: Intro
  difficulty: easy
`;

describe("parseYaml", () => {
  it("parses a valid recipe", () => {
    const r = parseYaml(VALID_RECIPE, "test.yaml");
    expect(r.cols).toBe(5);
    expect(r.opts.bendProb).toBe(0.1);
    expect(r.blockedT1).toEqual([0, 1]);
    expect(r.meta.pack).toBe("first-steps");
    expect(r.meta.title).toBe("Intro");
  });

  it("strips a UTF-8 BOM on the first line", () => {
    const r = parseYaml("\uFEFF" + VALID_RECIPE, "test.yaml");
    expect(r.cols).toBe(5);
  });

  it("rejects tab indentation", () => {
    const src = VALID_RECIPE.replace("  minLen:", "\tminLen:");
    expect(() => parseYaml(src, "test.yaml")).toThrow(/tabs are not supported/);
  });

  it("strips # comments at whitespace boundaries", () => {
    const src = `cols: 5  # top comment\nrows: 7\narrowCount: 3\nopts:\n  minLen: 2\n  maxLen: 3\n  bendProb: 0.1\nseed: 101\nmeta:\n  pack: p\n  indexInPack: 1\n`;
    const r = parseYaml(src, "test.yaml");
    expect(r.cols).toBe(5);
  });

  it("preserves # inside double-quoted strings", () => {
    const src = VALID_RECIPE.replace("title: Intro", 'title: "Hash # Tag"');
    const r = parseYaml(src, "test.yaml");
    expect(r.meta.title).toBe("Hash # Tag");
  });

  it("throws on top-level key with empty value (non-MAP_KEY)", () => {
    const src = VALID_RECIPE.replace("seed: 101", "seed:");
    expect(() => parseYaml(src, "test.yaml")).toThrow(/missing a value/);
  });

  it("throws on flow sequence with empty entry", () => {
    const src = VALID_RECIPE.replace("blockedT1: [0, 1]", "blockedT1: [0, ]");
    expect(() => parseYaml(src, "test.yaml")).toThrow(/empty value/);
  });

  it("throws on value that isn't a number where number is expected", () => {
    const src = VALID_RECIPE.replace("cols: 5", "cols: five");
    expect(() => parseYaml(src, "test.yaml")).toThrow(/is not a number/);
  });

  it("rejects unknown meta fields", () => {
    const src = VALID_RECIPE + "  author: batu\n";
    expect(() => parseYaml(src, "test.yaml")).toThrow(/unknown meta field/);
  });
});

describe("validateRecipe", () => {
  function parse(extra: string): ReturnType<typeof parseYaml> {
    return parseYaml(VALID_RECIPE + extra, "test.yaml");
  }

  it("passes a valid recipe", () => {
    expect(() => validateRecipe(parse(""), "test.yaml")).not.toThrow();
  });

  it("rejects minLen < 2", () => {
    const r = parse("");
    r.opts.minLen = 1;
    expect(() => validateRecipe(r, "test.yaml")).toThrow(/opts.minLen must be int >= 2/);
  });

  it("rejects seed < 0", () => {
    const r = parse("");
    r.seed = -1;
    expect(() => validateRecipe(r, "test.yaml")).toThrow(/seed must be int in/);
  });

  it("rejects seed >= 2^30", () => {
    const r = parse("");
    r.seed = 2 ** 30;
    expect(() => validateRecipe(r, "test.yaml")).toThrow(/seed must be int in/);
  });

  it("rejects blockedT1 beyond arrowCount", () => {
    const r = parse("");
    r.blockedT1 = [0, 100];
    expect(() => validateRecipe(r, "test.yaml")).toThrow(/blockedT1\[1\] must be <= arrowCount/);
  });

  it("rejects pack slug with leading hyphen", () => {
    const r = parse("");
    r.meta.pack = "-bad";
    expect(() => validateRecipe(r, "test.yaml")).toThrow(/meta.pack must be kebab-case/);
  });

  it("rejects unknown top-level keys (typo defense)", () => {
    const r = parse("");
    (r as Record<string, unknown>).bendPrb = 0.3;
    expect(() => validateRecipe(r, "test.yaml")).toThrow(/unknown top-level key/);
  });

  it("rejects unknown opts keys", () => {
    const r = parse("");
    (r.opts as Record<string, unknown>).weirdKnob = 1;
    expect(() => validateRecipe(r, "test.yaml")).toThrow(/unknown opts key/);
  });

  it("accepts omitted blockedT1 (optional)", () => {
    const r = parse("");
    delete (r as Record<string, unknown>).blockedT1;
    expect(() => validateRecipe(r, "test.yaml")).not.toThrow();
  });

  it("accepts explicit art boards up to the documented 30x30 ceiling", () => {
    const r = parseYaml(`cols: 22
rows: 28
arrows: [[[0,0],[0,1]]]
meta:
  pack: pictograms
  indexInPack: 1
  title: Tall Art
  difficulty: easy
`, "test.yaml");
    expect(() => validateRecipe(r, "test.yaml")).not.toThrow();
  });
});

describe("emitTs", () => {
  it("produces a stable string snapshot for a known recipe", () => {
    const r = parseYaml(VALID_RECIPE, "test.yaml");
    validateRecipe(r, "test.yaml");
    const output = emitTs([r]);
    expect(output).toContain('pack: "first-steps", indexInPack: 1, title: "Intro", difficulty: "easy"');
    expect(output).toContain("cols: 5, rows: 7, arrowCount: 3");
    expect(output).toContain("seed: 101");
    expect(output).toContain("blockedT1: [0, 1]");
    // PACKS export includes the group.
    expect(output).toContain('slug: "first-steps"');
    expect(output).toContain("indices: [0]");
    expect(output).toContain('firstTitle: "Intro"');
  });

  it("omits blockedT1 when the recipe doesn't have one", () => {
    const r = parseYaml(VALID_RECIPE, "test.yaml");
    delete (r as Record<string, unknown>).blockedT1;
    const output = emitTs([r]);
    expect(output).not.toContain("blockedT1");
  });

  it("groups multiple recipes from different packs into distinct PACKS entries", () => {
    const r1 = parseYaml(VALID_RECIPE, "a.yaml");
    const r2 = parseYaml(VALID_RECIPE, "b.yaml");
    r2.seed = 202;
    r2.meta.pack = "bend-it";
    r2.meta.indexInPack = 1;
    r2.meta.title = "B1";
    const output = emitTs([r1, r2]);
    expect(output).toContain('slug: "first-steps", indices: [0]');
    expect(output).toContain('slug: "bend-it", indices: [1]');
  });
});

describe("LEVEL_FILENAME regex", () => {
  it("accepts valid forms", () => {
    expect(LEVEL_FILENAME.test("01-intro.yaml")).toBe(true);
    expect(LEVEL_FILENAME.test("10-hardest.yaml")).toBe(true);
    expect(LEVEL_FILENAME.test("99-bend-it-primer.yaml")).toBe(true);
  });

  it("rejects mispadded / malformed names", () => {
    expect(LEVEL_FILENAME.test("1-intro.yaml")).toBe(false); // not 2-digit
    expect(LEVEL_FILENAME.test("01_intro.yaml")).toBe(false); // underscore
    expect(LEVEL_FILENAME.test("01-Intro.yaml")).toBe(false); // uppercase
    expect(LEVEL_FILENAME.test("01-.yaml")).toBe(false); // empty slug
    expect(LEVEL_FILENAME.test("intro.yaml")).toBe(false); // no prefix
  });
});
