import { test, expect, type Page } from '@playwright/test';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SharedShellDriver,
  collectRun,
  writeFidelityGrid,
  resolveEvidenceOutDir,
  gotoAndWaitForHarness,
  callHarness,
  readHarness,
  pollHarness,
} from '@fabrikav2/testkit/playwright';
import { wrapSnapshot } from '@fabrikav2/testkit/harness';
import type { CaptureResult, PerfSample, AnalyticsEventLike, SnapshotEnvelope } from '@fabrikav2/testkit/harness';

/**
 * FIDELITY RE-RUN (card KEghp3x4 §1 "USE") — the harness-produced replacement
 * for the hand scripts that made the earlier fidelity evidence
 * (`evidence/2026-07-06-1052-v1v2-fidelity/` was captured by ad-hoc scripts; the
 * reskin-drill grid by `docs/evidence/2026-07-06-1359-reskin-drill/capture-reskin-screenshots.mjs`,
 * a standalone `node` bridge, NOT the testkit).
 *
 * This drives ONE continuous harness session through the four states the
 * Android reference `refs/captures/android-basegamelab/` locks (menu, settings,
 * level-start, level-mid), navigating with `SharedShellDriver` real DOM clicks
 * (the gear → settings modal path is a real click, so an intercepting overlay
 * FAILS the nav instead of silently no-opping), exercises the `capture()` canvas
 * witness, and assembles the run via `collectRun()`. It then pairs each v2
 * capture with its v1 reference PNG into a self-contained before/after grid.
 *
 * By DEFAULT the run lands in the gitignored `.work/` scratch (side-effect-free
 * suite). Set `PROMOTE_EVIDENCE=1` to (re)generate the committed
 * `evidence/2026-07-06-1534-fidelity-harness/` artifact.
 *
 * HONESTY: every v2 screenshot is a CHROMIUM / BROWSER capture (Playwright
 * viewport). The reference PNGs are the real Android device captures
 * (Pixel 6a, adb lane) shipped in `refs/`. No on-device v2 capture is claimed
 * (the device-capture path is an unwired stub — `captureToDeviceDocuments`).
 */

const WINDOW_KEY = '__MARBLE_RUN_HARNESS__';
// Portrait phone viewport matching the Android reference aspect (1080×2400).
const VIEWPORT = { width: 405, height: 900 };
const SETTINGS_CARD = '.mr-settings-card';
const RUN_DATE = '2026-07-06';
const RUN_TOPIC = 'fidelity-harness';
const BUILD_VERSION = 'e2e-fidelity-2026-07-06';

/** State list — one entry per Android reference in refs/captures/android-basegamelab/.
 *  `name` is BOTH the v2 screenshot name and the v1 reference file stem, so
 *  `writeFidelityGrid` pairs them by name; `axes` captions the grid row. */
const REF_DIR = fileURLToPath(new URL('../../refs/captures/android-basegamelab', import.meta.url));
const STATES = [
  { name: 'menu', axes: 'layout · palette · chrome (coin pill + gear, wooden banner, saga chain, single green LEVEL button)' },
  { name: 'settings', axes: 'chrome character (v1 = MODAL over dimmed menu; blue card, orange ribbon, X close, green toggles)' },
  { name: 'level-start', axes: 'layout · palette (top-down board; hearts TL, gear TR, coin pill BL, HINT+125 BR)' },
  { name: 'level-mid', axes: 'palette · motion (same board, ambient animation reference)' },
] as const;

interface Harness {
  gotoState(state: string): void;
  startLevel(id: number): void;
  snapshot(): { scene: string; status: string; inputReady: boolean };
  capture(): CaptureResult;
  perf(): PerfSample;
  drainEvents(): readonly AnalyticsEventLike[];
}

test('fidelity: capture the four reference-locked states via the harness and grid them against the Android refs', async ({ page }) => {
  test.slow();
  await page.setViewportSize(VIEWPORT);
  await gotoAndWaitForHarness<Harness>(page, '/', {
    windowKey: WINDOW_KEY,
    readyCheck: (h) => typeof h.capture === 'function',
  });

  const driver = new SharedShellDriver(page);
  const screenshots: Array<{ name: string; capture: CaptureResult }> = [];
  const snapshots: SnapshotEnvelope[] = [];

  async function capture(name: string): Promise<void> {
    await page.waitForTimeout(400); // let the frame settle
    const pngBase64 = (await page.screenshot()).toString('base64');
    screenshots.push({ name, capture: { pngBase64, ...VIEWPORT } });
    const inner = await readHarness<Harness, unknown>(page, WINDOW_KEY, (h) => h.snapshot());
    snapshots.push(wrapSnapshot(inner, { packageId: 'marble_run', buildVersion: BUILD_VERSION }));
  }

  // ── menu ─────────────────────────────────────────────────────────
  await callHarness<Harness, null, void>(page, WINDOW_KEY, (h) => h.gotoState('HomeMenu'), null);
  await expect(page.locator('[data-fab-action="play"]')).toBeVisible();
  await capture('menu');

  // ── settings (REAL gear click via the shared shell, not a harness jump) ──
  await driver.openSettings();
  await expect(page.locator(SETTINGS_CARD)).toBeVisible({ timeout: 4000 });
  await capture('settings');
  await page.locator(`${SETTINGS_CARD} .mr-level-cta`).click();
  await expect(page.locator(SETTINGS_CARD)).toBeHidden({ timeout: 4000 });

  // ── level-start + the capture() canvas witness ───────────────────
  await enterLevel(page, 1);
  await capture('level-start');
  const canvasWitness = await readHarness<Harness, CaptureResult>(page, WINDOW_KEY, (h) => h.capture());
  screenshots.push({ name: 'level-start-canvas-witness', capture: canvasWitness });

  // ── level-mid (same board a beat later — ambient-motion reference) ─
  await page.waitForTimeout(1200);
  await capture('level-mid');

  // ── drain witnesses ──────────────────────────────────────────────
  const events = await callHarness<Harness, null, readonly AnalyticsEventLike[]>(
    page,
    WINDOW_KEY,
    (h) => h.drainEvents(),
    null,
  );
  const perf = await readHarness<Harness, PerfSample>(page, WINDOW_KEY, (h) => h.perf());

  // ── assemble the run dir (node fs writer) ────────────────────────
  // testkit `resolveEvidenceOutDir` centralizes the .work-vs-evidence promotion
  // convention (was copy-pasted per spec — card KEghp3x4 friction #3).
  const outDir = resolveEvidenceOutDir({
    evidenceDir: fileURLToPath(new URL('../../evidence', import.meta.url)),
    workDir: fileURLToPath(new URL('../../.work', import.meta.url)),
  });
  const result = collectRun({
    outDir,
    topic: RUN_TOPIC,
    date: RUN_DATE,
    artifacts: { screenshots, snapshots, events, perf },
  });

  // ── pair each v2 capture with its v1 Android reference into a grid ─
  // testkit `writeFidelityGrid` copies the matched refs, writes the grid, and
  // reports paired/missing (was ~90 lines of hand-written HTML — friction #1/#2).
  const grid = writeFidelityGrid({
    dir: result.dir,
    refDir: REF_DIR,
    states: STATES,
    grid: {
      title: 'marble_run fidelity — v1 Android reference vs v2 harness capture',
      lede:
        'Harness-produced (card KEghp3x4 §1). Left: real Android device captures (adb lane) from ' +
        'refs/captures/android-basegamelab/. Right: v2 marble_run driven through the four ' +
        'reference-locked states in one continuous harness session (SharedShellDriver real clicks + collectRun). ' +
        'Every v2 frame is a Chromium/browser capture.',
      refLabel: 'v1 — Android reference (basegamelab, Pixel 6a)',
      candidateLabel: 'v2 — marble_run (harness / Chromium 405×900)',
      footer: `Generated by games/marble_run/tests/e2e/fidelity.spec.ts · run date ${RUN_DATE}.`,
    },
  });
  writeFileSync(join(result.dir, 'README.md'), readme(screenshots.map((s) => s.name), grid.paired, events.length, perf), 'utf8');

  // ── assert the artifact materialised and the grid is complete ─────
  expect(result.files.length).toBeGreaterThan(0);
  expect(existsSync(join(result.dir, 'manifest.json'))).toBe(true);
  expect(existsSync(grid.gridPath)).toBe(true);
  // All four reference states must have paired — a missing pair is a real gap,
  // not a soft skip (the whole point of the fidelity run is the four-way grid).
  expect(grid.missing).toEqual([]);
  expect(grid.paired).toEqual(STATES.map((s) => s.name));
  console.log(`[fidelity] wrote ${result.files.length} files + grid to ${result.dir}`);
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

function readme(names: string[], paired: readonly string[], eventCount: number, perf: PerfSample): string {
  return [
    '# Fidelity re-run evidence (marble_run) — harness-produced',
    '',
    'Card **KEghp3x4 §1 (USE)**. The v1-vs-v2 fidelity comparison re-run through the',
    'testkit (`SharedShellDriver` + `capture()` + `collectRun()`) instead of the',
    'earlier hand scripts. See `fidelity-grid.html` for the before/after grid.',
    '',
    '## Provenance',
    '',
    '- **v1 (left)**: real Android device captures (Pixel 6a, adb lane), shipped in',
    '  `games/marble_run/refs/captures/android-basegamelab/`, copied into `refs/` here',
    '  so the grid is self-contained.',
    '- **v2 (right)**: Chromium/browser captures (Playwright viewport 405×900) from a',
    '  single continuous harness session. The settings state is reached by a REAL gear',
    '  click through `SharedShellDriver.openSettings()` (dead-button-safe), not a harness jump.',
    '- On-device v2 capture is NOT used (unwired stub `captureToDeviceDocuments`).',
    '',
    '## Paired states',
    '',
    ...paired.map((name) => `- \`${name}\``),
    '',
    '## Run witnesses',
    '',
    ...names.map((n) => `- \`screenshots/${n}.png\``),
    `- \`snapshots.json\` — stamped snapshot envelopes.`,
    `- \`events.json\` — analytics trace (${eventCount} events).`,
    `- \`perf.json\` — frame-time buckets (${perf.frameCount} frames, worst ${perf.worstFrameMs.toFixed(1)}ms).`,
    '- `manifest.json` — run index.',
    '',
  ].join('\n');
}
