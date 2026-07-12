import { seedStatesFromConfig } from "@fabrikav2/testkit/harness";
import { maybeRunInsituTour } from "@fabrikav2/testkit/testing";
import { gameConfig } from "../../game.config.ts";
import type { TemplateShellSnapshot } from "../core/TemplateShellController.ts";
import type { TemplateHarness } from "./harness.ts";

/**
 * The production allstates tour configuration for the template shell: the
 * game's declared screen vocabulary plus a stability predicate grounded in
 * the controller snapshot's exact `surface`. Testkit's default matcher only
 * recognizes the legacy six-state list, so custom states (Shop) would mark
 * `-FAILED` even after `driveTo` succeeds; the testkit default stays
 * untouched for legacy games.
 */
export function maybeRunTemplateInsituTour(harness: TemplateHarness): Promise<void> {
  return maybeRunInsituTour(harness, {
    states: seedStatesFromConfig(gameConfig),
    snapshotMatchesState: (state, snapshot) =>
      (snapshot as TemplateShellSnapshot).surface === state,
  });
}
