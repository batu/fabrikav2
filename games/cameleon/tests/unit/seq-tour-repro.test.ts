import { describe, expect, it } from "vitest";
import { CAMELEON_DEVICE_TOUR_STATES, createCameleonController, snapshotMatchesCameleonTourState } from "../../src/game/CameleonController.ts";
import { loadLidoFixture } from "./lidoFixture.ts";

describe("sequential canonical tour (device order)", () => {
  it("drives menu→level→settings→pause→win→fail in ONE controller like the insitu tour", async () => {
    const controller = createCameleonController({ level: loadLidoFixture() });
    for (const state of CAMELEON_DEVICE_TOUR_STATES) {
      const ok = await controller.driveToTourState(state);
      expect(ok, `driveTo(${state})`).toBe(true);
      expect(snapshotMatchesCameleonTourState(state, controller.snapshot()), `matcher(${state})`).toBe(true);
    }
  });
});
