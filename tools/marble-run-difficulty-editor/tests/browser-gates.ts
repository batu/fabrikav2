import { runFullCampaignPerformance } from './performance-harness.ts';
import { runPreviewSoak } from './preview-soak-harness.ts';

declare global { interface Window { __MARBLE_GATE__?: { readonly ok: boolean; readonly result?: unknown; readonly error?: string } } }

async function run(): Promise<void> {
  try {
    const gate = new URLSearchParams(location.search).get('gate');
    const result = gate === 'performance' ? await runFullCampaignPerformance() : gate === 'preview' ? await runPreviewSoak() : (() => { throw new Error(`Unknown browser gate ${String(gate)}.`); })();
    window.__MARBLE_GATE__ = { ok: true, result };
  } catch (error) {
    window.__MARBLE_GATE__ = { ok: false, error: error instanceof Error ? error.stack ?? error.message : String(error) };
  }
}

void run();
