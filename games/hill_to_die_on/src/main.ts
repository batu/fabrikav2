import './shell/hill.css';
import { assignWindowBindings } from '@fabrikav2/testkit/testing';
import { HillShell } from './shell/HillShell';
import { TITLE } from './game/catalog';
import { createHillHarness } from './shell/harness';
import { Progression, SAVE_KEY } from './core/progression';

declare const __BUILD_INFO__: { sha: string; builtAt: string; version: string; dirty: boolean };
const root = document.getElementById('app');
if (root) {
  document.title = TITLE;
  try {
    const qaProfile = import.meta.env.VITE_ENABLE_TEST_HARNESS === 'true' && import.meta.env.VITE_HILL_QA_PROFILE === 'true';
    const shell = new HillShell(root, new Progression(qaProfile ? `${SAVE_KEY}.device-qa` : SAVE_KEY));
    if (import.meta.env.DEV || import.meta.env.VITE_ENABLE_TEST_HARNESS === 'true') {
      const harness = createHillHarness(shell,__BUILD_INFO__);
      assignWindowBindings(window as unknown as Record<string,unknown>, { __HILL_TO_DIE_ON_HARNESS__: harness });
      // Native menu tests spend a fixture balance in a separate save namespace.
      if (qaProfile && shell.progression.save.attempts === 0 && shell.progression.save.salvage === 0) harness.grantCoins(1000);
      const stressCount=Number(import.meta.env.VITE_HILL_STRESS_COUNT ?? 0);
      if (Number.isFinite(stressCount) && stressCount>0) harness.verbs.stress.run(stressCount);
    }
  } catch (error) {
    root.textContent = error instanceof Error ? error.message : 'The game could not start. Please reopen it.';
    root.style.padding = '80px 24px'; console.error(error);
  }
}
