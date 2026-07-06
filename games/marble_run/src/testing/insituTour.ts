/**
 * Dev-gated on-device tour: drives the game to states unreachable by blind
 * taps (win, fail) so an external screenshotter (XCUITest / adb / conductor)
 * can capture them in situ. Active ONLY when the test harness is enabled AND
 * the page URL carries ?insituTour=<script>. Never bundles behavior into
 * production: TEST_HARNESS_ENABLED gates the caller in main.ts.
 *
 * Scripts: "winfail" (default) — menu dwell, play level 1 to WIN via the
 * tapUnlockedMarble verb, dwell on the result card, return to menu, then
 * play again to FAIL via tapBlockedMarble, dwell on the fail card.
 */
import type { App } from '../shell/App';

const DWELL_MS = 6000;
const STEP_MS = 450;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function maybeRunInsituTour(app: App): Promise<void> {
  // Trigger from a build-time env flag (baked into a bundled dev build — no
  // network/URL needed on device) OR a URL param (web dev server).
  const script =
    (import.meta.env.VITE_INSITU_TOUR as string | undefined) ||
    new URLSearchParams(window.location.search).get('insituTour');
  if (!script) return;
  const h = app.harness();

  const playUntil = async (
    verb: 'tapUnlockedMarble' | 'tapBlockedMarble',
    done: (status: string) => boolean,
  ): Promise<void> => {
    for (let i = 0; i < 300; i += 1) {
      const s = h.snapshot() as Record<string, unknown>;
      if (done(String(s.status))) return;
      h.verbs[verb].run(Math.random());
      await sleep(STEP_MS);
    }
  };

  await sleep(3000); // menu dwell (external shot: menu)
  h.startLevel(1);
  await sleep(2500);
  await playUntil('tapUnlockedMarble', (s) => s === 'won');
  await sleep(DWELL_MS); // result-card WIN dwell (external shot)

  h.gotoMenu();
  await sleep(2000);
  h.startLevel(1);
  await sleep(2500);
  await playUntil('tapBlockedMarble', (s) => s === 'failed');
  await sleep(DWELL_MS); // result-card FAIL dwell (external shot)
}
