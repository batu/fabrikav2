import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import process from 'node:process';
import { URL } from 'node:url';
import { chromium } from 'playwright';

const transparentPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64',
);

const port = await freePort();
const baseUrl = `http://127.0.0.1:${port}`;

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === 'object') resolve(address.port);
        else reject(new Error('Could not allocate a free port'));
      });
    });
  });
}

function waitForServer() {
  const deadline = Date.now() + 20_000;
  return new Promise((resolve, reject) => {
    const check = async () => {
      try {
        const response = await fetch(baseUrl);
        if (response.ok) {
          resolve();
          return;
        }
      } catch {
        // Vite is still starting.
      }
      if (Date.now() > deadline) {
        reject(new Error('Timed out waiting for Vite dev server'));
        return;
      }
      setTimeout(check, 250);
    };
    check();
  });
}

function stopVite(vite) {
  try {
    if (process.platform === 'win32') vite.kill();
    else process.kill(-vite.pid, 'SIGTERM');
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitUntil(predicate, message, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(message);
}

const geometryConfig = {
  hudFraction: 0.139,
  bannerFraction: 0.071,
  sectionBoundaryBuffer: 60,
  landscapeEdgeSafeArea: 128,
  viewportSafeFraction: 0.8,
  nSections: 3,
  portraitReference: {
    width: 768,
    height: 1376,
    deadzones: [
      { label: 'HUD', x: 0, y: 0, w: 768, h: 191 },
      { label: 'AD', x: 0, y: 1278, w: 768, h: 98 },
      { label: 'HINT', x: 566, y: 1068, w: 182, h: 182 },
      { label: 'CROP L', x: 0, y: 0, w: 77, h: 1376 },
      { label: 'CROP R', x: 691, y: 0, w: 77, h: 1376 },
    ],
  },
};

const config = {
  views: { isometric: 'Isometric hidden-object view.' },
  styles: { clean_old_cartoon: 'Clean old cartoon style.' },
  settings: {
    japan: {
      label: 'Japan',
      scenes: { japan_garden: 'Garden with lanterns.' },
      shortDescriptions: { japan_garden: 'Garden with lanterns.' },
    },
  },
  entities: { dog: 'dog' },
  entityPromptTemplate: 'Add exactly one {entity}.',
  models: [{ id: 'openai/gpt-image-2', label: 'GPT Image' }],
  inpaintModels: [{ id: 'openai/gpt-image-2', label: 'GPT Image' }],
  upscaleModels: [],
};

const sessionListItem = {
  id: 'wide-complete-session',
  name: 'Complete Session',
  createdAt: '2026-06-12T12:00:00Z',
  orientation: 'landscape',
  style: 'clean_old_cartoon',
  setting: 'japan',
  scene: 'japan_garden',
  entity: 'dog',
  model: 'openai/gpt-image-2',
  bgModel: 'openai/gpt-image-2',
  nDogs: 1,
  variants: ['gemini'],
  exported: true,
  exportedVariant: 'gemini',
  catalogUploaded: true,
  catalogListable: true,
  catalogTombstoned: false,
  bundledInApp: false,
  archived: false,
  archivedVariants: [],
  tags: ['featured', 'garden'],
  selectedBgIndex: 0,
  assetVersion: 4,
};

const missingAssetSessionListItem = {
  ...sessionListItem,
  id: 'missing-asset-session',
  name: 'Missing Asset Session',
  orientation: 'portrait',
  scene: 'japan_market',
  exported: true,
  exportedVariant: 'gemini',
  hasImage: false,
  hasThumbnail: false,
  tags: ['broken'],
  assetVersion: 1,
};

const sessionResponse = {
  ...sessionListItem,
  scenePrompt: 'scene prompt',
  dogPrompt: 'dog prompt',
  backgrounds: [{ file: 'bg_00.png', url: '/levels/wide-complete-session/bg_00.png' }],
  selectedBgIndex: 0,
  bgWidth: 1800,
  bgHeight: 1000,
  sections: [
    { index: 0, left: 0, right: 600 },
    { index: 1, left: 600, right: 1200 },
    { index: 2, left: 1200, right: 1800 },
  ],
  hitboxes: [{ x: 420, y: 520, r: 45, id: 'dog-0' }],
  dogs: [
    { index: 0, id: 'dog-0', status: 'done', activeVariant: 0, promptOverride: null, variants: ['dogs/dog_00/variant_000.png'] },
  ],
  maskParams: { radial: 0, feather: 0 },
};

const lineupState = {
  schemaVersion: 1,
  liveSequence: {
    sequenceVersion: 'editor-default-1',
    catalogRevision: 'catalog-1',
    levelIds: [],
    source: 'test',
    updatedAt: null,
  },
  draft: {
    levelIds: [],
    baseLiveSequenceVersion: 'editor-default-1',
    baseCatalogRevision: 'catalog-1',
    updatedAt: null,
    draftRevision: 'draft-1',
  },
  catalog: { available: true, catalogRevision: 'catalog-1', levelCount: 0, levels: [] },
  localPreview: {
    source: 'test',
    levelCount: 1,
    starterLevelIds: [],
    missingStarterLevelIds: [],
    levels: [],
  },
  supportedBuilds: { source: 'test', platforms: ['android'], starterLevelIds: [], diagnostics: [] },
  validation: {
    activatable: true,
    dryRunnable: true,
    diagnostics: [],
    blockingDiagnostics: [],
    warnings: [],
    diff: { addedIds: [], removedIds: [], movedIds: [], destructive: false },
    rows: [],
    missingCatalogLevelIds: [],
    copyFixPrompt: null,
  },
  activation: {
    schemaVersion: 1,
    activeVersion: 'editor-default-1',
    versions: [],
    auditEvents: [],
    pendingAttempts: [],
    retention: { retainedLevelIds: [], retainedPackageIds: [] },
    updatedAt: null,
  },
};

let currentLineupState = JSON.parse(JSON.stringify(lineupState));
let sequenceGetCount = 0;
let sequenceSaveCount = 0;
let visibilityBatchCount = 0;
let thumbnailRequests = 0;
let previewRequests = 0;
let levelImageRequests = 0;
let geometryRequests = 0;

async function run() {
  const vite = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['vite', '--host', '127.0.0.1', '--port', String(port)],
    { detached: process.platform !== 'win32', stdio: ['ignore', 'ignore', 'ignore'] },
  );
  let browser;
  try {
    await waitForServer();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });

    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/config') {
        await route.fulfill({ json: config });
        return;
      }
      if (url.pathname === '/api/config/geometry') {
        geometryRequests += 1;
        await route.fulfill({ json: geometryConfig });
        return;
      }
      if (url.pathname === '/api/sessions' && route.request().method() === 'GET') {
        await route.fulfill({ json: [sessionListItem, missingAssetSessionListItem] });
        return;
      }
      if (url.pathname === '/api/sequence-workflow' && route.request().method() === 'GET') {
        sequenceGetCount += 1;
        await route.fulfill({ json: currentLineupState });
        return;
      }
      if (url.pathname === '/api/sequence-workflow/draft' && route.request().method() === 'PUT') {
        sequenceSaveCount += 1;
        const body = JSON.parse(route.request().postData() ?? '{}');
        currentLineupState = {
          ...currentLineupState,
          draft: {
            ...currentLineupState.draft,
            levelIds: body.levelIds,
            draftRevision: `draft-${sequenceSaveCount + 1}`,
            updatedAt: '2026-06-12T12:01:00Z',
          },
        };
        await route.fulfill({ json: currentLineupState });
        return;
      }
      if (url.pathname === '/api/sessions/visibility-checks') {
        visibilityBatchCount += 1;
        await route.fulfill({
          json: {
            reports: {
              [sessionListItem.id]: { ok: true, issues: [], viewports: [] },
              [missingAssetSessionListItem.id]: { ok: true, issues: [], viewports: [] },
            },
          },
        });
        return;
      }
      if (url.pathname === `/api/sessions/${sessionListItem.id}`) {
        await route.fulfill({ json: sessionResponse });
        return;
      }
      if (url.pathname === `/api/sessions/${sessionListItem.id}/hitboxes`) {
        await route.fulfill({ status: 204, body: '' });
        return;
      }
      if (url.pathname.includes('/gallery-thumb/')) {
        thumbnailRequests += 1;
        await route.fulfill({ status: 404, body: 'missing thumbnail' });
        return;
      }
      if (url.pathname.includes('/gallery-preview/')) {
        previewRequests += 1;
        await route.fulfill({ status: 200, contentType: 'image/png', body: transparentPng });
        return;
      }
      if (url.pathname.startsWith('/levels/')) {
        levelImageRequests += 1;
        await route.fulfill({ status: 200, contentType: 'image/png', body: transparentPng });
        return;
      }
      await route.continue();
    });

    await page.goto(`${baseUrl}/#gallery`);
    await page.getByText('Complete Session').waitFor({ timeout: 10_000 });
    await waitUntil(() => visibilityBatchCount > 0, 'Gallery did not load server visibility from /api/sessions/visibility-checks');
    assert(sequenceGetCount > 0, 'Gallery did not load Lineup state from /api/sequence-workflow');
    assert(thumbnailRequests > 0, 'Gallery did not request thumbnail proxy previews.');
    assert(levelImageRequests === 0, `Gallery browsing should not request full /levels images, got ${levelImageRequests}`);

    const card = page.locator('[data-gallery-card-id="wide-complete-session::gemini"]');
    await card.getByText('No preview').waitFor({ timeout: 10_000 });
    const missingAssetCard = page.locator('[data-gallery-card-id="missing-asset-session::gemini"]');
    await missingAssetCard.getByText('Missing composite image asset.').waitFor({ timeout: 10_000 });
    const missingAssetAdd = missingAssetCard.getByRole('button', { name: 'Add to Lineup' });
    assert(await missingAssetAdd.isDisabled(), 'Missing-asset Gallery card should not be selectable for Lineup.');

    await card.getByRole('button', { name: 'Add to Lineup' }).click();
    await page.waitForFunction(() => (
      document.querySelector('[data-gallery-card-id="wide-complete-session::gemini"]')?.getAttribute('data-lineup-selected') === 'true'
    ));
    assert(sequenceSaveCount === 1, 'Gallery selection did not save through /api/sequence-workflow/draft');

    const searchBox = page.getByPlaceholder('Search name, setting, scene, tags');
    await searchBox.fill('does-not-match');
    await page.getByText('No cards match the current filters.').waitFor({ timeout: 10_000 });
    await searchBox.fill('featured');
    await page.waitForFunction(() => (
      document.querySelector('[data-gallery-card-id="wide-complete-session::gemini"]')?.getAttribute('data-lineup-selected') === 'true'
    ));

    let bodyText = await page.locator('body').innerText();
    for (const retiredText of [
      'Preview locally',
      'Previewed locally',
      'Approve and upload assets to catalog',
      'Catalog-uploaded',
      'catalog upload',
      'local preview',
      'landscape',
      'Clear timed-out',
    ]) {
      assert(!bodyText.toLowerCase().includes(retiredText.toLowerCase()), `Retired Gallery text is visible: ${retiredText}`);
    }

    await page.locator('[data-gallery-card-id="wide-complete-session::gemini"] button').first().click();
    await page.getByRole('dialog').waitFor({ timeout: 10_000 });
    await waitUntil(() => geometryRequests > 0, 'Gallery review LevelCanvas did not request server geometry config.');
    assert(previewRequests > 0, 'Gallery review did not request proxy preview image.');
    bodyText = await page.getByRole('dialog').innerText();
    for (const retiredText of [
      'Preview locally',
      'Previewed locally',
      'Approve and upload assets to catalog',
      'Catalog-uploaded',
      'Remove preview',
      'revoke',
      'catalog upload',
      'local preview',
      'landscape',
    ]) {
      assert(!bodyText.toLowerCase().includes(retiredText.toLowerCase()), `Retired modal text is visible: ${retiredText}`);
    }

    console.log('gallery-retired-actions-smoke: PASS');
  } finally {
    if (browser) await browser.close();
    stopVite(vite);
  }
}

await run();
