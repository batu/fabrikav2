/**
 * Dev-gated on-device tour that drives the game through every canonical state
 * so an external screenshotter (XCUITest / adb / conductor) can capture states
 * that blind input can't reach. Active ONLY when the harness is enabled AND
 * either VITE_INSITU_TOUR is set (bundled dev build) or ?insituTour=<script> is
 * present (`main.ts`'s `TEST_HARNESS_ENABLED` gates the caller).
 *
 * Templatized from `games/marble_run/src/testing/insituTour.ts` (card vFSI5FwY),
 * generalized to drive any `GameHarness` (not a concrete `App`) so a fresh
 * `create-game` output inherits the tour unmodified; a port only fills in the
 * harness's `driveTo`/`winLevel`/`failLevel` transitions.
 *
 * GAMEPLAY MUST BE SOLVER-BOUND, NOT LLM/RANDOM-BOUND (Batu, 2026-07-06): the
 * harness's `winLevel`/`failLevel` (or `driveTo`'s `autoWin`/`autoFail` deps)
 * must replay a deterministic in-game AI, never an llm/random policy. Every
 * transition here is CONFIRMED by querying `snapshot()` — the tour never
 * assumes a state it hasn't verified (the "did I actually win?" failure this
 * fixes).
 *
 * CONDUCTOR RULING (card Hi6nHsXv, 2026-07-07): the 'allstates' tour below is
 * permitted under the autonomy law ONLY as a deterministic scripted fixture.
 * It has a fixed state list and no judgment; it exists because XCUITest cannot
 * call JS directly inside WKWebView. Do not add branching, heuristic state
 * choice, visual judgment, retry policy, or convergence loops here. Those
 * belong in the agent or in an external one-shot tool that returns.
 */
import type { GameHarness } from '@fabrikav2/testkit/harness';

/** The canonical device-capture states the 'allstates' script drives through
 *  (mirrors `driveTo.ts`'s `DriveState` / `tools/refcap-compare` `CANONICAL_STATES`). */
const ALLSTATES = ['menu', 'level', 'settings', 'pause', 'win', 'fail'] as const;

// Long dwell so an ELEMENT-gated external capturer (XCUITest waits for each
// state's signature text, not a timer) reliably catches every state even
// though driveTo steps take variable time. Timed capture drifts — see the
// fidelity-diff mistakes ledger (settings/fail mislabeled as menu/level).
const ALLSTATES_DWELL_MS = 11000;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function maybeRunInsituTour(harness: GameHarness): Promise<void> {
  // Trigger from a build-time env flag (baked into a bundled dev build — no
  // network/URL needed on device) OR a URL param (web dev server).
  const script =
    (import.meta.env.VITE_INSITU_TOUR as string | undefined) ||
    new URLSearchParams(window.location.search).get('insituTour');
  if (!script) return;

  const scene = (): string => String((harness.snapshot() as Record<string, unknown>).scene);

  const log = (m: string): void => {
    // Surfaced in device logs (idevicesyslog / Xcode console / browser console)
    // so the tour's state decisions are inspectable, not silent.
    console.info(`[insituTour] ${m}`);
  };

  // Mark the current state on <body data-tour-state> so an external capturer
  // (XCUITest / adb) can CONFIRM the state before shooting — device-side
  // capture-integrity, not timed guessing.
  const mark = (s: string): void => {
    document.body.setAttribute('data-tour-state', s);
    // Surface the state to the native accessibility tree so an external capturer
    // (XCUITest) can WAIT for `tourstate:<s>` before shooting — element-gated
    // capture-integrity on device, replacing timed guessing. Element-gate
    // contract (`tools/verify-device/runner/.../InsituTourTests.swift`): a
    // fixed off-screen element, `aria-label` AND `textContent` both set to the
    // exact `tourstate:<s>` string.
    let el = document.getElementById('__tourstate__');
    if (!el) {
      el = document.createElement('div');
      el.id = '__tourstate__';
      el.setAttribute('role', 'text');
      // Off-screen (not opacity-faded) so it NEVER shows in a capture but stays
      // in the a11y tree for XCUITest to query — the faint on-screen ghost of
      // an opacity:0.01 marker contaminated a panel's own captures (see the
      // insitu-testing-capability-notes retro).
      el.style.cssText =
        'position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;pointer-events:none;';
      document.body.appendChild(el);
    }
    const tag = `tourstate:${s}`;
    el.setAttribute('aria-label', tag);
    el.textContent = tag;
    log(`state=${s} scene=${scene()}`);
  };

  // 'allstates' = drive to EVERY canonical state via driveTo (each confirmed),
  // dwelling for a device capture. This is the required device-verification tour.
  if (script === 'allstates' && typeof harness.driveTo === 'function') {
    for (const s of ALLSTATES) {
      const ok = await harness.driveTo(s);
      mark(ok ? s : `${s}-FAILED`);
      await sleep(ALLSTATES_DWELL_MS);
    }
    mark('done');
    return;
  }

  log(`unsupported insituTour script "${script}" (or harness has no driveTo) — no-op`);
}
