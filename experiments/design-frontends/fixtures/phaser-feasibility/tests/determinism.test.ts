// R7/AE3: two unchanged generations must be byte-identical or normalize to an
// identical canonical publication under the enumerated volatile registry.
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - plain .mjs helper without type declarations
import { normalize, compareGenerations, VOLATILE_REGISTRY } from "../scripts/normalize.mjs";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - plain .mjs helper without type declarations
import { sha256File } from "../scripts/lib.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("normalization mechanics (KTD8)", () => {
  it("byte-identical generations need no normalization", () => {
    expect(compareGenerations("const a = 1;", "const a = 1;")).toEqual({
      verdict: "byte-identical",
      applied: [],
    });
  });

  it("volatile-only differences normalize identically and report the applied facts", () => {
    const registry = [
      { name: "generated-timestamp", pattern: /\/\/ generated at .*/g, replacement: "// generated at <t>" },
    ];
    const gen1 = "// generated at 2026-01-01\nconst a = 1;";
    const gen2 = "// generated at 2026-01-02\nconst a = 1;";
    expect(compareGenerations(gen1, gen2, registry)).toEqual({
      verdict: "normalized-identical",
      applied: ["generated-timestamp"],
    });
  });

  it("semantic differences are a determinism failure, never normalized away", () => {
    const registry = [
      { name: "generated-timestamp", pattern: /\/\/ generated at .*/g, replacement: "// generated at <t>" },
    ];
    const gen1 = '// generated at 2026-01-01\nconst copy = "hello";';
    const gen2 = '// generated at 2026-01-01\nconst copy = "goodbye";';
    expect(compareGenerations(gen1, gen2, registry).verdict).toBe("determinism-failure");
  });

  it("normalization preserves semantic content (ids, copy, bindings)", () => {
    const generated = readFileSync(join(root, "editor-project", "src", "scenes", "Probe.ts"), "utf8");
    const { text } = normalize(generated);
    for (const marker of ["PROBE-43QVBIH7", "shell.counter.primary", "currency:primary"]) {
      expect(text).toContain(marker);
    }
  });
});

describe("recorded double generation (R7, AE3)", () => {
  it("the pinned toolchain's volatile registry is empty because generations were byte-identical", () => {
    // If a future editor version introduces volatile output, this test forces
    // the registry entry AND the recorded evidence to move together.
    const ledgerPath = join(root, "evidence", "sessions", "session-ledger.json");
    expect(existsSync(ledgerPath), "session ledger missing").toBe(true);
    const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
    const gen1 = ledger.entries.filter((e: { step: string; phase: string }) => e.step === "compile-1" && e.phase === "end").at(-1);
    const gen2 = ledger.entries.filter((e: { step: string; phase: string }) => e.step === "compile-2" && e.phase === "end").at(-1);
    expect(gen1, "compile-1 bracket missing").toBeDefined();
    expect(gen2, "compile-2 bracket missing").toBeDefined();
    const generated = Object.keys(gen1.files).filter((f) => /\.(ts|js)$/.test(f));
    expect(generated.length).toBeGreaterThan(0);
    for (const f of generated) {
      expect(gen2.files[f], `generation drift in ${f}`).toBe(gen1.files[f]);
      const abs = join(root, f);
      expect(existsSync(abs), `recorded generated file missing: ${f}`).toBe(true);
      expect(sha256File(abs), `committed ${f} differs from recorded generation`).toBe(gen1.files[f]);
    }
    expect(VOLATILE_REGISTRY).toHaveLength(0);
  });
});
