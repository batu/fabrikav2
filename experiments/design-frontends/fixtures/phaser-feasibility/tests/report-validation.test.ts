import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - plain .mjs helper without type declarations
import { expectedOverall, privacyProblems, validateAgainstSchema, validateEvidencePointers, validateOfflineEvidence } from "../scripts/verify-report.mjs";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - plain .mjs helper without type declarations
import { buildManifest } from "../scripts/hash.mjs";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - plain .mjs helper without type declarations
import { fixtureRoot } from "../scripts/lib.mjs";

const readJson = (path: string) => JSON.parse(readFileSync(join(fixtureRoot, path), "utf8"));

describe("machine report contract", () => {
  it("enforces the declared schema beyond required-key presence", () => {
    const report = readJson("report/report.json");
    const schema = readJson("report/report.schema.json");
    expect(validateAgainstSchema(report, schema)).toEqual([]);

    expect(validateAgainstSchema({ ...report, overall: "green" }, schema)).toContain(
      "report.overall must be one of pass, no-go, blocked"
    );
    expect(validateAgainstSchema({ ...report, card: "wrong" }, schema)).toContain(
      "report.card must equal 43Qvbih7"
    );
    expect(
      validateAgainstSchema({ ...report, ledger: { ...report.ledger, attempts: "one" } }, schema)
    ).toContain("report.ledger.attempts must be number");
  });

  it("derives the only honest top-level verdict from acceptance legs", () => {
    expect(expectedOverall([{ verdict: "pass" }, { verdict: "pass" }])).toBe("pass");
    expect(expectedOverall([{ verdict: "pass" }, { verdict: "blocked" }])).toBe("blocked");
    expect(expectedOverall([{ verdict: "blocked" }, { verdict: "no-go" }])).toBe("no-go");
  });

  it("keeps every evidence pointer inside the fixture and bound by hashes.json", () => {
    const report = readJson("report/report.json");
    const manifest = buildManifest();
    expect(validateEvidencePointers(report.acceptance, manifest, fixtureRoot)).toEqual([]);

    const escaped = structuredClone(report.acceptance);
    escaped["live-copy-preview"].evidence = ["../../package.json"];
    expect(validateEvidencePointers(escaped, manifest, fixtureRoot)).toContain(
      "acceptance.live-copy-preview: evidence pointer escapes fixture: ../../package.json"
    );
  });

  it("checks the content behind an offline-runtime-build pass", () => {
    const record = readJson("evidence/offline-build/offline-build.json");
    const transcript = readFileSync(join(fixtureRoot, record.transcript), "utf8");
    expect(validateOfflineEvidence(record, transcript)).toEqual([]);

    expect(
      validateOfflineEvidence(
        { ...record, environment: { ...record.environment, network: "available" } },
        transcript
      )
    ).toContain("offline evidence does not record a network-blocked verification run");
    expect(validateOfflineEvidence(record, transcript.replace("7 pass, 0 fail", "6 pass, 1 fail"))).toContain(
      "offline transcript does not contain a zero-failure full verify summary"
    );
    expect(validateOfflineEvidence({ ...record, source: { ...record.source, cleanCheckout: false } }, transcript)).toContain(
      "offline evidence is not bound to a clean committed checkout"
    );
    expect(validateOfflineEvidence({ ...record, environment: { ...record.environment, editorInstalled: true } }, transcript)).toContain(
      "offline evidence does not prove Phaser Editor was absent"
    );
  });

  it("detects private paths in editor-writable text", () => {
    expect(privacyProblems("clean", "fixture.txt")).toEqual([]);
    const privatePath = ["", "Users", "private", "game"].join("/");
    expect(privacyProblems(JSON.stringify({ playUrl: privatePath }), "editor-project/config.json")).toContain(
      "privacy: home path in editor-project/config.json"
    );
  });
});
