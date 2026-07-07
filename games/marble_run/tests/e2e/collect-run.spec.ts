import { test, expect, type Page } from '@playwright/test';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SharedShellDriver,
  collectRun,
  gotoAndWaitForHarness,
  callHarness,
  readHarness,
  pollHarness,
} from '@fabrikav2/testkit/playwright';
import { wrapSnapshot } from '@fabrikav2/testkit/harness';
import type { CaptureResult, PerfSample, AnalyticsEventLike, SnapshotEnvelope } from '@fabrikav2/testkit/harness';

/**
 * collectRun() EVIDENCE run — the deliverable that is the EVALUATION INPUT for
 * the next card (KEghp3x4). One continuous harness session is driven through the
 * reachable states; each is screenshotted (full Chromium composite: canvas +
 * DOM chrome), the browser `capture()` canvas witness is exercised, and the
 * accumulated snapshot envelopes / analytics trace / perf sample are drained at
 * the end. `collectRun` (node fs writer) assembles it into
 * `<date>-<topic>/`. By DEFAULT that lands in the gitignored `.work/` scratch so
 * the suite is side-effect-free; set `PROMOTE_EVIDENCE=1` to (re)generate the
 * committed `evidence/2026-07-06-1446-harness-first-run/` artifact (the .work
 * promotion rule — games/_template/.work/README.md).
 *
 * HONESTY (card §1): every screenshot is a CHROMIUM / BROWSER capture. The
 * on-device capture path is an unwired stub (`capture.ts` captureToDeviceDocuments)
 * and is NOT used here — the README in the run dir says so.
 */

const WINDOW_KEY = '__MARBLE_RUN_HARNESS__';
const VIEWPORT = { width: 390, height: 844 };
const HUD_PAUSE = '#hud [data-a="pause"]';
const PAUSE_CARD = '.fab-pause-card';
const SETTINGS_CARD = '.mr-settings-card';
const RUN_DATE = '2026-07-06';
const RUN_TOPIC = 'harness-first-run';
const BUILD_VERSION = 'e2e-collectRun-2026-07-06';

interface Harness {
  gotoState(state: string): void;
  startLevel(id: number): void;
  unlockAll(): void;
  solveStep(): unknown;
  snapshot(): { scene: string; status: string; inputReady: boolean };
  capture(): CaptureResult;
  perf(): PerfSample;
  drainEvents(): readonly AnalyticsEventLike[];
}

test('collectRun: capture every reachable state into a run bundle (.work by default, evidence/ on PROMOTE_EVIDENCE=1)', async ({ page }) => {
  test.slow();
  await page.setViewportSize(VIEWPORT);
  await gotoAndWaitForHarness<Harness>(page, '/', {
    windowKey: WINDOW_KEY,
    readyCheck: (h) => typeof h.capture === 'function',
  });

  const screenshots: Array<{ name: string; capture: CaptureResult }> = [];
  const snapshots: SnapshotEnvelope[] = [];

  async function capture(name: string): Promise<void> {
    await page.waitForTimeout(400); // let the frame settle
    const pngBase64 = (await page.screenshot()).toString('base64');
    screenshots.push({ name, capture: { pngBase64, ...VIEWPORT } });
    const inner = await readHarness<Harness, unknown>(page, WINDOW_KEY, (h) => h.snapshot());
    snapshots.push(wrapSnapshot(inner, { packageId: 'marble_run', buildVersion: BUILD_VERSION }));
  }

  // ── HomeMenu / SagaMap (the saga rail lives on the menu) ──────────
  await callHarness<Harness, null, void>(page, WINDOW_KEY, (h) => h.gotoState('HomeMenu'), null);
  await expect(page.locator('[data-fab-action="play"]')).toBeVisible();
  await capture('home-menu');

  // ── Settings (modal over the menu) ───────────────────────────────
  await callHarness<Harness, null, void>(page, WINDOW_KEY, (h) => h.gotoState('Settings'), null);
  await expect(page.locator(SETTINGS_CARD)).toBeVisible({ timeout: 4000 });
  await capture('settings');
  await page.locator(`${SETTINGS_CARD} [data-fab-action="settings-close"]`).click();
  await expect(page.locator(SETTINGS_CARD)).toBeHidden({ timeout: 4000 });

  // ── Playing (a live level) + the browser capture() canvas witness ─
  await enterLevel(page, 1);
  await capture('playing-level-1');
  const canvasWitness = await readHarness<Harness, CaptureResult>(page, WINDOW_KEY, (h) => h.capture());
  screenshots.push({ name: 'canvas-witness-playing', capture: canvasWitness });

  // ── PauseOverlay ─────────────────────────────────────────────────
  await page.locator(HUD_PAUSE).click();
  await expect(page.locator(PAUSE_CARD)).toBeVisible({ timeout: 4000 });
  await capture('pause-overlay');
  await new SharedShellDriver(page).pauseQuit();
  await expect(page.locator('[data-fab-action="play"]')).toBeVisible({ timeout: 4000 });

  // ── ResultCard (solve level 1 to a terminal card) ────────────────
  await winLevel1(page);
  const scene = await readHarness<Harness, string>(page, WINDOW_KEY, (h) => h.snapshot().scene);
  if (scene === 'complete' || scene === 'failed') await capture('result-card');

  // ── Drain the witnesses at the end of the continuous session ──────
  const events = await callHarness<Harness, null, readonly AnalyticsEventLike[]>(
    page,
    WINDOW_KEY,
    (h) => h.drainEvents(),
    null,
  );
  const perf = await readHarness<Harness, PerfSample>(page, WINDOW_KEY, (h) => h.perf());

  // ── Assemble the run dir (node fs writer) ────────────────────────
  // Side-effect-free by DEFAULT: write the run bundle into the game's gitignored
  // `.work/` scratch, so a plain test/CI/conductor run never dirties the tree.
  // Promotion to the COMMITTED `evidence/` artifact is an explicit opt-in
  // (`PROMOTE_EVIDENCE=1`), per the .work contract's promotion rule
  // (games/_template/.work/README.md). The evidence artifact stays committed;
  // regenerating it is a deliberate step, not an accident of running the suite.
  const promote = process.env.PROMOTE_EVIDENCE === '1';
  const outDir = fileURLToPath(
    new URL(promote ? '../../evidence' : '../../.work', import.meta.url),
  );
  const result = collectRun({
    outDir,
    topic: RUN_TOPIC,
    date: RUN_DATE,
    artifacts: { screenshots, snapshots, events, perf },
  });

  writeFileSync(join(result.dir, 'README.md'), readme(screenshots.map((s) => s.name), events.length, perf), 'utf8');

  // Verify the artifact actually materialised.
  expect(result.files.length).toBeGreaterThan(0);
  expect(existsSync(join(result.dir, 'manifest.json'))).toBe(true);
  expect(screenshots.length).toBeGreaterThanOrEqual(5);
  console.log(`[collectRun] wrote ${result.files.length} files to ${result.dir}`);
});

async function enterLevel(page: Page, id: number): Promise<void> {
  await callHarness<Harness, number, void>(
    page,
    WINDOW_KEY,
    (h, levelId) => {
      h.gotoState('HomeMenu');
      h.startLevel(levelId);
    },
    id,
  );
  await pollHarness<Harness, { scene: string; inputReady: boolean }>(
    page,
    WINDOW_KEY,
    (h) => ({ scene: h.snapshot().scene, inputReady: h.snapshot().inputReady }),
    (v) => v.scene === 'playing' && v.inputReady === true,
    10_000,
  );
}

async function winLevel1(page: Page): Promise<void> {
  await enterLevel(page, 1);
  for (let i = 0; i < 200; i += 1) {
    const status = await readHarness<Harness, string>(page, WINDOW_KEY, (h) => h.snapshot().status);
    if (status === 'won' || status === 'failed') break;
    await callHarness<Harness, null, unknown>(page, WINDOW_KEY, (h) => h.solveStep(), null);
    await page.waitForTimeout(120);
  }
  await pollHarness<Harness, string>(
    page,
    WINDOW_KEY,
    (h) => h.snapshot().scene,
    (v) => v === 'complete' || v === 'failed',
    10_000,
  );
}

function readme(names: string[], eventCount: number, perf: PerfSample): string {
  return [
    '# Harness first-run evidence (marble_run)',
    '',
    'Evaluation input for card **KEghp3x4** (Harness evaluation). Produced by',
    '`games/marble_run/tests/e2e/collect-run.spec.ts` via the testkit',
    '`collectRun()` writer over the `GameHarness` witnesses.',
    '',
    '## Capture provenance',
    '',
    '- **All screenshots are CHROMIUM / BROWSER captures** (Playwright viewport',
    `  ${VIEWPORT.width}×${VIEWPORT.height}). The on-device capture path is an`,
    '  unwired stub (`captureToDeviceDocuments`, insitu ledger gap 1) and was NOT',
    '  used. No claim of on-device capture is made.',
    '- `screenshots/canvas-witness-playing.png` is the in-game `harness.capture()`',
    '  browser canvas path (`captureCanvasPng`); the rest are full page composites.',
    '',
    '## Contents',
    '',
    ...names.map((n) => `- \`screenshots/${n}.png\``),
    `- \`snapshots.json\` — stamped snapshot envelopes (packageId + buildVersion guard).`,
    `- \`events.json\` — analytics trace (${eventCount} events) drained from the RingBufferSink.`,
    `- \`perf.json\` — frame-time buckets (${perf.frameCount} frames, worst ${perf.worstFrameMs.toFixed(1)}ms).`,
    '- `manifest.json` — the run index.',
    '',
  ].join('\n');
}
