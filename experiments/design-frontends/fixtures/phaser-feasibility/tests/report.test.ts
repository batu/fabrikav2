// U7: report.json must schema-validate, every evidence pointer must resolve,
// hashes must match committed bytes, and the privacy scan must be clean.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - plain .mjs helper without type declarations
import { validateReport } from "../scripts/verify-report.mjs";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - plain .mjs helper without type declarations
import { fixtureRoot } from "../scripts/lib.mjs";

describe("feasibility report integrity (R12-R15)", () => {
  it("report.json validates with resolvable evidence, matching hashes, clean privacy scan", () => {
    expect(validateReport()).toEqual([]);
  });

  // The generic gate only requires evidence pointers to resolve; without this
  // check an android-webview-boot pass could point at any committed file. A
  // pass verdict must be backed by the actual device capture set.
  it("android-webview-boot pass is backed by real device evidence", () => {
    const report = JSON.parse(readFileSync(join(fixtureRoot, "report", "report.json"), "utf8"));
    const leg = report.acceptance["android-webview-boot"];
    if (leg.verdict !== "pass") return;

    for (const ev of [
      "evidence/device/boot.png",
      "evidence/device/device-boot.json",
      "evidence/device/logcat-webgl.txt",
    ]) {
      expect(leg.evidence).toContain(ev);
    }

    const device = JSON.parse(
      readFileSync(join(fixtureRoot, "evidence/device/device-boot.json"), "utf8")
    );
    expect(device.verdict).toBe("pass");
    expect(device.sentinelVisible).toBe(true);
    expect(device.webglContextCreated).toBe(true);
    expect(device.screenshot).toBe("evidence/device/boot.png");
    expect(device.logcat).toBe("evidence/device/logcat-webgl.txt");
    // model/OS/WebView only — no device identifier may ride along
    expect(JSON.stringify(device)).not.toMatch(/serial|imei|android[_-]?id/i);

    const png = readFileSync(join(fixtureRoot, "evidence/device/boot.png"));
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

    const log = readFileSync(join(fixtureRoot, "evidence/device/logcat-webgl.txt"), "utf8");
    expect(log).toMatch(/Phaser v4\.2\.1 \(WebGL/);
  });
});
