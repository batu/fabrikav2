import { describe, expect, it } from "vitest";
import { maybeRunInsituTour } from "@fabrikav2/testkit/testing";
import { bootGame } from "../../src/main.ts";
import { createCameleonHarness } from "../../src/shell/harness.ts";
import { CAMELEON_DEVICE_TOUR_STATES, snapshotMatchesCameleonTourState } from "../../src/game/CameleonController.ts";
import { loadLidoFixture } from "./lidoFixture.ts";

describe("insitu tour repro (device wiring, no phaser)", () => {
  it("runs the allstates tour to done with no FAILED markers", async () => {
    const mountInto = document.createElement("div");
    document.body.appendChild(mountInto);
    const boot = await bootGame(mountInto, { level: loadLidoFixture(), startRuntime: false });
    const harness = createCameleonHarness({
      packageId: "com.basegamelab.cameleon.dev",
      controller: boot.controller,
      screen: boot.screen,
    });
    const logs: string[] = [];
    await maybeRunInsituTour(harness, {
      script: "allstates",
      states: CAMELEON_DEVICE_TOUR_STATES,
      snapshotMatchesState: snapshotMatchesCameleonTourState,
      sleep: () => Promise.resolve(),
      logger: (m: string) => logs.push(m),
    });
    const failed = logs.filter((l) => l.includes("FAILED") || l.includes("timed out"));
    expect(failed, logs.join("\n")).toEqual([]);
    const marker = document.getElementById("__tourstate__");
    expect(marker?.textContent ?? "").toContain("done");
  });
});
