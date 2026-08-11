import { chromium } from 'playwright';
import { createServer } from 'vite';
import process from 'node:process';
import { URL } from 'node:url';

const server = await createServer({ configFile: new URL('../vite.config.ts', import.meta.url).pathname, server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const address = server.httpServer.address();
if (address === null || typeof address === 'string') throw new Error('Vite did not expose a browser gate port.');
const browser = await chromium.launch({ headless: true });

async function runGate(name, timeout) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${address.port}/tests/browser-gates.html?gate=${name}`);
  // Poll on a timer so Playwright's own wait loop does not occupy the rAF slot
  // whose ownership the preview soak is measuring.
  await page.waitForFunction(() => window.__MARBLE_GATE__ !== undefined, undefined, { timeout, polling: 100 });
  const gate = await page.evaluate(() => window.__MARBLE_GATE__);
  await page.close();
  if (!gate?.ok) throw new Error(`${name} gate failed: ${gate?.error ?? errors.join('\n')}`);
  return gate.result;
}

try {
  const selected = process.argv[2] ?? 'all';
  const performance = selected === 'preview' ? null : await runGate('performance', 150_000);
  if (performance !== null) {
  const performanceFailures = [
    performance.acceptedCount === 110 || `accepted ${performance.acceptedCount}/110`,
    performance.ascending || 'results were not ascending',
    performance.exactShippedBoards || 'default draft changed shipped board bytes',
    performance.workerWithinBaseline || `worker compute ${performance.workerComputeMs}ms exceeded baseline ceiling`,
    performance.maxMainThreadTaskMs <= 50 || `main-thread task reached ${performance.maxMainThreadTaskMs}ms`,
    performance.inputToPaintP95Ms < 100 || `input-to-paint p95 reached ${performance.inputToPaintP95Ms}ms`,
    performance.latestStartLatencyMs !== null && performance.latestStartLatencyMs <= 250 || `worker start latency was ${performance.latestStartLatencyMs}ms`,
    performance.staleResultCount === 0 || `published ${performance.staleResultCount} stale results`,
  ].filter((result) => result !== true);
  if (performanceFailures.length > 0) throw new Error(`performance assertions failed: ${performanceFailures.join('; ')}`);
  }

  const preview = selected === 'performance' ? null : await runGate('preview', 60_000);
  if (preview !== null) {
  const previewFailures = [
    preview.cycles === 30 || `completed ${preview.cycles}/30 cycles`,
    preview.peakCanvases <= 1 || `mounted ${preview.peakCanvases} canvases`,
    preview.peakContexts <= 1 || `held ${preview.peakContexts} live contexts`,
    preview.retainedContexts === 0 || `retained ${preview.retainedContexts} contexts`,
    preview.peakAnimationFrames <= 1 || `ran ${preview.peakAnimationFrames} animation frames`,
    preview.activeAnimationFrames === 0 || `retained ${preview.activeAnimationFrames} animation frames`,
    preview.activeResizeListeners + preview.activeWindowPointerListeners + preview.activeCanvasPointerListeners === 0 || 'retained event listeners',
    preview.hostRetained || 'detached the shared preview host',
  ].filter((result) => result !== true);
  if (previewFailures.length > 0) throw new Error(`preview assertions failed: ${previewFailures.join('; ')}`);
  }
  process.stdout.write(`${JSON.stringify({ performance, preview }, null, 2)}\n`);
} finally {
  await browser.close();
  await server.close();
}
