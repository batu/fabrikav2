/**
 * U1 experiment-record guard: the frozen protocol, fences, schemas, and
 * baseline records under experiments/design-frontends/ stay parseable and
 * consistent with the proof games they govern. This file is part of the
 * frozen behavior set and is byte-identical in both proof games.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const EXPERIMENT_ROOT = resolve(process.cwd(), "../../experiments/design-frontends");

function readJson(relativePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(EXPERIMENT_ROOT, relativePath), "utf8")) as Record<
    string,
    unknown
  >;
}

describe("frozen experiment records", () => {
  it("keeps the protocol, fences, schemas, and baseline records valid JSON", () => {
    for (const file of [
      "protocol.json",
      "fences.json",
      "implementation-ledger.schema.json",
      "evidence.schema.json",
      "task-sets/operation-classes.json",
      "baseline/behavior-hashes.json",
      "baseline/dependencies.json",
      "baseline/device-profile.json",
      "assets/icon-control-shop.provenance.json",
    ]) {
      expect(() => readJson(file), file).not.toThrow();
    }
  });

  it("binds the protocol to the seven-state v2 contract and both lanes", () => {
    const protocol = readJson("protocol.json") as {
      contract: { contractId: string; states: string[]; rendererProfiles: string[] };
      lanes: Array<{ id: string; game: string; rendererProfile: string; devPort: number }>;
      freeze: { baselineCommit: string | null };
    };
    expect(protocol.contract.contractId).toBe("shell-presentation-v2");
    expect(protocol.contract.states).toEqual([
      "menu",
      "level",
      "shop",
      "settings",
      "pause",
      "win",
      "fail",
    ]);
    expect(protocol.contract.rendererProfiles).toEqual(["dom-css", "phaser-native"]);
    expect(protocol.lanes.map((lane) => lane.game)).toEqual([
      "games/shell_proof_grapes",
      "games/shell_proof_phaser",
    ]);
    expect(new Set(protocol.lanes.map((lane) => lane.devPort)).size).toBe(2);
    // Null until the conductor seals the freeze; never a truthy placeholder.
    expect(
      protocol.freeze.baselineCommit === null ||
        /^[0-9a-f]{7,40}$/.test(String(protocol.freeze.baselineCommit)),
    ).toBe(true);
  });

  it("keeps the embedded schemas closed-root JSON Schemas", () => {
    for (const file of ["implementation-ledger.schema.json", "evidence.schema.json"]) {
      const schema = readJson(file);
      expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
      expect(schema.type).toBe("object");
      expect(schema.additionalProperties).toBe(false);
    }
  });

  it("names both proof games as the frozen-behavior comparison set", () => {
    const fences = readJson("fences.json") as {
      nonTargets: { paths: string[] };
      frozenBehavior: { dirs: string[] };
    };
    expect(fences.nonTargets.paths).toContain("games/_template/**");
    expect(fences.nonTargets.paths).toContain("tools/create-game/**");
    expect(fences.frozenBehavior.dirs).toEqual(["src", "design", "content", "tests/unit"]);
  });
});
