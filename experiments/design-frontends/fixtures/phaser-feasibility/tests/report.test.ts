// U7: report.json must schema-validate, every evidence pointer must resolve,
// hashes must match committed bytes, and the privacy scan must be clean.
import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - plain .mjs helper without type declarations
import { validateReport } from "../scripts/verify-report.mjs";

describe("feasibility report integrity (R12-R15)", () => {
  it("report.json validates with resolvable evidence, matching hashes, clean privacy scan", () => {
    expect(validateReport()).toEqual([]);
  });
});
