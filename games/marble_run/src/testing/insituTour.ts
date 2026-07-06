/**
 * Dev-gated on-device tour that drives the game to WIN and FAIL result cards so
 * an external screenshotter (XCUITest / adb / conductor) can capture states that
 * blind input can't reach. Active ONLY when the harness is enabled AND either
 * VITE_INSITU_TOUR is set (bundled dev build) or ?insituTour=<script> is present.
 * TEST_HARNESS_ENABLED gates the caller in main.ts.
 *
 * GAMEPLAY IS SOLVER-BOUND, NOT LLM/RANDOM-BOUND (Batu, 2026-07-06): winning
 * replays the in-game A-star search solver's tap order (h.autoWin), losing taps
 * genuinely-blocked marbles (h.autoFail). Every transition is then CONFIRMED by
 * querying h.snapshot().scene/status — the tour never assumes a state it hasn't
 * verified (the "did I actually win?" failure this fixes).
 */
import type { App } from '../shell/App';

const DWELL_MS = 6000;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function maybeRunInsituTour(app: App): Promise<void> {
  // Trigger from a build-time env flag (baked into a bundled dev build — no
  // network/URL needed on device) OR a URL param (web dev server).
  const script =
    (import.meta.env.VITE_INSITU_TOUR as string | undefined) ||
    new URLSearchParams(window.location.search).get('insituTour');
  if (!script) return;
  const h = app.harness();

  const status = (): string => String((h.snapshot() as Record<string, unknown>).status);
  const scene = (): string => String((h.snapshot() as Record<string, unknown>).scene);

  const log = (m: string): void => {
    // Surfaced in device logs (idevicesyslog / Xcode console) so the tour's
    // state decisions are inspectable, not silent.
    console.info(`[insituTour] ${m}`);
  };

  // Wait until the harness reports a live state before each confirmed capture:
  // drive to state, CONFIRM state (query the scene), THEN dwell for the shot.
  const confirmScene = async (want: string): Promise<boolean> => {
    for (let i = 0; i < 20 && scene() !== want; i += 1) await sleep(250);
    return scene() === want;
  };

  await sleep(3000); // menu dwell (external shot: menu)
  log(`menu scene=${scene()}`);

  // ── WIN: solver-bound, state-confirmed ──────────────────────────────────
  h.startLevel(1);
  await sleep(2200);
  const won = await h.autoWin();
  const winConfirmed = await confirmScene('complete');
  log(`autoWin returned ${won}; confirmed=${winConfirmed} status=${status()} scene=${scene()}`);
  await sleep(DWELL_MS); // WIN result-card dwell (external shot)

  // ── FAIL: blocked-marble taps, state-confirmed ──────────────────────────
  h.gotoMenu();
  await sleep(1500);
  h.startLevel(1);
  await sleep(2200);
  const failed = await h.autoFail();
  const failConfirmed = await confirmScene('failed');
  log(`autoFail returned ${failed}; confirmed=${failConfirmed} status=${status()} scene=${scene()}`);
  await sleep(DWELL_MS); // FAIL result-card dwell (external shot)
  log('tour complete');
}
