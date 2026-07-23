/* global MessageEvent, URL, process */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { chromium } from 'playwright';

const port = await freePort();
const baseUrl = `http://127.0.0.1:${port}`;

const nowIso = '2026-06-12T00:00:00Z';
const liveSequenceVersion = 'seq-live-journey-0';
const catalogRevision = 'catalog-journey-1';

const config = {
  views: { isometric: 'Isometric hidden-object view.' },
  styles: { clean_old_cartoon: 'Clean old cartoon style.' },
  settings: {
    japan: {
      label: 'Japan',
      scenes: {
        japan_garden: 'A garden with bridges and stone lanterns.',
        japan_market: 'A compact market with stalls and crates.',
      },
      shortDescriptions: {
        japan_garden: 'Garden with bridges.',
        japan_market: 'Market with stalls.',
      },
    },
  },
  entities: { dog: 'dog' },
  entityPromptTemplate: 'Add exactly one {entity}.',
  models: [{ id: 'openai/gpt-image-2', label: 'GPT Image' }],
  inpaintModels: [{ id: 'openai/gpt-image-2', label: 'GPT Image' }],
  upscaleModels: [],
};

const geometryConfig = {
  hudFraction: 0.139,
  bannerFraction: 0.071,
  sectionBoundaryBuffer: 60,
  landscapeEdgeSafeArea: 60,
  viewportSafeFraction: 0.12,
  nSections: 3,
  portraitReference: {
    width: 768,
    height: 1376,
    deadzones: [
      { label: 'HUD', x: 0, y: 0, w: 768, h: 191 },
      { label: 'AD', x: 0, y: 1278, w: 768, h: 98 },
      { label: 'CROP L', x: 0, y: 0, w: 90, h: 1376 },
      { label: 'CROP R', x: 678, y: 0, w: 90, h: 1376 },
      { label: 'HINT', x: 551, y: 1151, w: 137, h: 100 },
    ],
  },
};

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64',
);

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

function sceneLabel(scene) {
  return scene.replace('japan_', '').replaceAll('_', ' ');
}

function makeSession(id, scene, overrides = {}) {
  return {
    id,
    name: `Journey ${sceneLabel(scene)}`,
    orientation: 'portrait',
    style: 'clean_old_cartoon',
    model: 'openai/gpt-image-2',
    bgModel: 'openai/gpt-image-2',
    inpaintModel: 'openai/gpt-image-2',
    scenePrompt: `assembled scene ${scene}`,
    dogPrompt: 'assembled dog prompt',
    nDogs: 30,
    backgrounds: [],
    selectedBgIndex: null,
    bgWidth: 0,
    bgHeight: 0,
    sections: [],
    hitboxes: [],
    dogs: [],
    setting: 'japan',
    scene,
    entity: 'dog',
    maskParams: { radial: 0, feather: 0 },
    exported: false,
    exportedVariant: null,
    catalogUploaded: false,
    catalogListable: false,
    catalogTombstoned: false,
    bundledInApp: false,
    variants: [],
    archived: false,
    archivedVariants: [],
    tags: ['journey'],
    createdAt: nowIso,
    assetVersion: 1,
    hasImage: false,
    hasThumbnail: false,
    ...overrides,
  };
}

function backgroundFor(scene) {
  return {
    index: 0,
    file: `bg_${scene}.png`,
    generationTime: 1,
    width: 1024,
    height: 1536,
    kind: 'generated',
    provider: 'mock',
    status: 'succeeded',
  };
}

function markBackgroundReady(session) {
  session.backgrounds = [backgroundFor(session.scene)];
  session.variants = ['gemini_bg_only'];
  session.hasImage = true;
  session.hasThumbnail = true;
  session.assetVersion += 1;
}

function hitboxesFor(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `dog-${index + 1}`,
    x: 240 + index * 130,
    y: 360 + index * 170,
    r: 45,
  }));
}

function markCompleted(session) {
  if (session.hitboxes.length === 0) session.hitboxes = hitboxesFor(2);
  session.dogs = session.hitboxes.map((hitbox, index) => ({
    index,
    id: hitbox.id,
    status: 'done',
    activeVariant: 0,
    promptOverride: null,
    variants: [`dogs/${hitbox.id}/variant_000.png`],
  }));
  session.exported = true;
  session.exportedVariant = 'gemini';
  session.variants = ['gemini'];
  session.hasImage = true;
  session.hasThumbnail = true;
  session.assetVersion += 1;
}

function sessionListItem(session) {
  return {
    id: session.id,
    name: session.name,
    createdAt: session.createdAt,
    orientation: session.orientation,
    style: session.style,
    setting: session.setting,
    scene: session.scene,
    entity: session.entity,
    model: session.model,
    bgModel: session.bgModel,
    nDogs: session.nDogs,
    variants: session.variants,
    exported: session.exported,
    exportedVariant: session.exportedVariant,
    catalogUploaded: session.catalogUploaded,
    catalogListable: session.catalogListable,
    catalogTombstoned: session.catalogTombstoned,
    bundledInApp: session.bundledInApp,
    archived: session.archived,
    archivedVariants: session.archivedVariants,
    tags: session.tags,
    selectedBgIndex: session.selectedBgIndex,
    assetVersion: session.assetVersion,
    hasImage: session.hasImage,
    hasThumbnail: session.hasThumbnail,
  };
}

function sequenceRow(levelId, draftIndex) {
  const session = sessions.get(levelId);
  return {
    levelId,
    draftIndex,
    liveIndex: null,
    draftListed: true,
    liveListed: false,
    added: true,
    moved: false,
    removed: false,
    catalogStatus: session?.exported ? 'available' : 'missing',
    catalogListable: !!session?.exported,
    bundledInApp: false,
    cohortRestricted: false,
    tombstoned: false,
    name: session?.name ?? levelId,
  };
}

function makeWorkflowState({ diagnostics = [], activation = null } = {}) {
  const rows = draftIds.map((id, index) => sequenceRow(id, index));
  const blockingDiagnostics = diagnostics.filter((item) => item.blocking);
  return {
    schemaVersion: 1,
    liveSequence: {
      sequenceVersion: liveSequenceVersion,
      catalogRevision,
      levelIds: [],
      source: 'journey-smoke',
      updatedAt: null,
    },
    draft: {
      levelIds: draftIds,
      baseLiveSequenceVersion: liveSequenceVersion,
      baseCatalogRevision: catalogRevision,
      updatedAt: nowIso,
      draftRevision,
    },
    catalog: {
      available: true,
      catalogRevision,
      levelCount: sessions.size,
      levels: draftIds.map((id) => ({
        id,
        name: sessions.get(id)?.name ?? id,
        packageId: `${id}:pkg`,
        listable: true,
        bundledInApp: false,
        cohortBuckets: ['all'],
        allCohortAvailable: true,
        tombstonedAt: null,
      })),
    },
    localPreview: {
      source: 'journey-smoke',
      levelCount: draftIds.length,
      starterLevelIds: [],
      missingStarterLevelIds: [],
      levels: draftIds.map((id) => ({
        id,
        name: sessions.get(id)?.name ?? id,
        inStarterPrefix: false,
        inRuntimeManifest: false,
        catalogUploaded: false,
        catalogListable: true,
      })),
    },
    supportedBuilds: {
      source: 'journey-smoke',
      platforms: ['android'],
      starterLevelIds: [],
      diagnostics: [],
    },
    validation: {
      activatable: blockingDiagnostics.length === 0,
      dryRunnable: blockingDiagnostics.length === 0,
      diagnostics,
      blockingDiagnostics,
      warnings: [],
      diff: {
        addedIds: draftIds,
        removedIds: [],
        movedIds: [],
        destructive: false,
      },
      rows,
      missingCatalogLevelIds: rows.filter((row) => row.catalogStatus === 'missing').map((row) => row.levelId),
      copyFixPrompt: null,
    },
    activation: activation ?? {
      schemaVersion: 1,
      activeVersion: liveSequenceVersion,
      versions: [],
      auditEvents: [],
      pendingAttempts: [],
      retention: { retainedLevelIds: [], retainedPackageIds: [] },
      updatedAt: null,
    },
  };
}

function dryRunPayload(changelogNote) {
  const rawPayload = JSON.stringify({
    schemaVersion: 1,
    sequenceVersion: 'seq-journey-dry-run',
    catalogRevision,
    levelIds: draftIds,
  });
  return {
    ok: true,
    changelogNote,
    payload: {
      schemaVersion: 1,
      sequenceVersion: 'seq-journey-dry-run',
      catalogRevision,
      levelIds: draftIds,
    },
    rawPayload,
    sha256Hex: 'journey-dryrun-hash',
    diagnostics: [],
    state: makeWorkflowState(),
    globalActivationMutated: false,
  };
}

function activationPayload(changelogNote) {
  const sequenceVersion = `seq-journey-start-${startRequests}`;
  const rawPayload = JSON.stringify({
    schemaVersion: 1,
    sequenceVersion,
    catalogRevision,
    levelIds: draftIds,
  });
  return {
    ok: true,
    version: {
      sequenceVersion,
      catalogRevision,
      levelIds: draftIds,
      rawPayload,
      sha256Hex: 'journey-start-hash',
      rollbackEligible: true,
      createdAt: nowIso,
      changelogNote,
      packageIds: draftIds.map((id) => `${id}:pkg`),
    },
    state: {
      schemaVersion: 1,
      activeVersion: sequenceVersion,
      versions: [],
      auditEvents: [{ operation: 'activate', sequenceVersion, createdAt: nowIso }],
      pendingAttempts: [],
      retention: {
        retainedLevelIds: draftIds,
        retainedPackageIds: draftIds.map((id) => `${id}:pkg`),
      },
      updatedAt: nowIso,
    },
    idempotent: false,
  };
}

function startJob(id, overrides = {}) {
  return {
    id,
    parentJobId: null,
    kind: 'sequence_start',
    sessionId: 'sequence-workflow',
    idempotencyKey: `journey-${id}`,
    inputHash: `journey-${id}`,
    status: 'queued',
    stage: 'queued',
    retryable: false,
    errorCode: null,
    errorMessage: null,
    metadata: {},
    result: {},
    workerOwner: null,
    heartbeatAt: null,
    createdAt: nowIso,
    updatedAt: nowIso,
    completedAt: null,
    artifacts: [],
    events: [],
    ...overrides,
  };
}

function buildSize() {
  return {
    limitBytes: 200_000_000,
    artifact: {
      path: 'android/app/build/outputs/bundle/release/app-release.aab',
      kind: 'aab',
      buildType: 'release',
      sizeBytes: 180_000_000,
      modifiedAt: 1780420960,
      overLimit: false,
      budgetApplies: true,
      storeBudgetOverLimit: false,
    },
    distSizeBytes: 120_000_000,
    androidPublicAssetsSizeBytes: 120_000_000,
    levelAssetsSizeBytes: 40_000_000,
  };
}

async function dragBefore(page, sourceSelector, targetSelector) {
  await page.evaluate(({ sourceSelector: sourceSel, targetSelector: targetSel }) => {
    const source = document.querySelector(sourceSel);
    const target = document.querySelector(targetSel);
    if (!(source instanceof HTMLElement) || !(target instanceof HTMLElement)) {
      throw new Error('Expected source and target cards to be visible for drag reorder.');
    }
    const sourceBox = source.getBoundingClientRect();
    const targetBox = target.getBoundingClientRect();
    const startX = sourceBox.left + sourceBox.width / 2;
    const startY = sourceBox.top + sourceBox.height / 2;
    const endX = targetBox.left + targetBox.width / 2;
    const endY = targetBox.top + targetBox.height * 0.25;
    const originalSetPointerCapture = source.setPointerCapture;
    source.setPointerCapture = () => {};
    try {
      source.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        pointerId: 7,
        pointerType: 'mouse',
        button: 0,
        buttons: 1,
        clientX: startX,
        clientY: startY,
      }));
      document.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true,
        cancelable: true,
        pointerId: 7,
        pointerType: 'mouse',
        button: 0,
        buttons: 1,
        clientX: endX,
        clientY: endY,
      }));
      document.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true,
        cancelable: true,
        pointerId: 7,
        pointerType: 'mouse',
        button: 0,
        buttons: 0,
        clientX: endX,
        clientY: endY,
      }));
    } finally {
      source.setPointerCapture = originalSetPointerCapture;
    }
  }, { sourceSelector, targetSelector });
}

async function assertAbsentNormalFlowText(page, selector) {
  const text = await page.locator(selector).innerText();
  for (const retired of [
    'Preview locally',
    'Approve and upload',
    'catalog-uploaded',
    'Remote sequence workflow',
    'Scene Variation',
    'N-options',
    'landscape',
  ]) {
    assert(!text.includes(retired), `Normal flow still exposes retired text: ${retired}`);
  }
}

const sessions = new Map();
let createCounter = 0;
let draftIds = [];
let draftRevision = 'draft-journey-0';
let backgroundJobStarts = 0;
let inpaintJobStarts = 0;
let geometryRequests = 0;
let dogProxyRequests = 0;
let galleryThumbRequests = 0;
let galleryPreviewRequests = 0;
let fullColorRequests = 0;
let visibilityBatchRequests = 0;
let draftSaveCount = 0;
let startRequests = 0;
let startJobGets = 0;
let startJobCounter = 0;
const startJobs = new Map();
const createBodies = [];
const draftSaveBodies = [];

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
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    const browserDiagnostics = [];
    page.on('console', (message) => {
      if (['error', 'warning'].includes(message.type())) {
        browserDiagnostics.push(`${message.type()}: ${message.text()}`);
      }
    });
    page.on('pageerror', (error) => {
      browserDiagnostics.push(`pageerror: ${error.message}`);
    });
    await page.addInitScript(() => {
      window.__journeyEventSources = [];
      class FakeEventSource {
        constructor(url) {
          this.url = url;
          this.listeners = new Map();
          window.__journeyEventSources.push(this);
        }
        addEventListener(type, listener) {
          this.listeners.set(type, [...(this.listeners.get(type) || []), listener]);
        }
        close() {
          this.closed = true;
        }
        emit(type, data = {}) {
          for (const listener of this.listeners.get(type) || []) {
            listener(new MessageEvent(type, { data: JSON.stringify(data) }));
          }
        }
      }
      window.EventSource = FakeEventSource;
    });

    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      const method = route.request().method();

      if (url.pathname.startsWith('/levels/') && url.pathname.endsWith('/color.png')) {
        fullColorRequests += 1;
        await route.fulfill({ status: 200, contentType: 'image/png', body: png });
        return;
      }
      if (url.pathname.includes('/gallery-thumb/')) {
        galleryThumbRequests += 1;
        await route.fulfill({ status: 200, contentType: 'image/png', body: png });
        return;
      }
      if (url.pathname.includes('/gallery-preview/')) {
        if (url.pathname.includes('/gemini_bg_only')) dogProxyRequests += 1;
        else galleryPreviewRequests += 1;
        await route.fulfill({ status: 200, contentType: 'image/png', body: png });
        return;
      }
      if (url.pathname.endsWith('.png') || url.pathname.includes('/dogs/')) {
        await route.fulfill({ status: 200, contentType: 'image/png', body: png });
        return;
      }
      if (url.pathname === '/api/config') {
        await route.fulfill({ json: config });
        return;
      }
      if (url.pathname === '/api/config/geometry') {
        geometryRequests += 1;
        await route.fulfill({ json: geometryConfig });
        return;
      }
      if (url.pathname.startsWith('/api/prompts/')) {
        await route.fulfill({ json: { default_version: 0, versions: [] } });
        return;
      }
      if (url.pathname === '/api/actions/assemble-recipe-prompts') {
        const body = JSON.parse(route.request().postData() ?? '{}');
        await route.fulfill({
          json: {
            scenePrompt: `assembled scene ${body.scene}`,
            dogPrompt: 'assembled dog prompt',
            promptContext: { source: 'server-recipe-prompt-v1' },
          },
        });
        return;
      }
      if (url.pathname === '/api/sessions' && method === 'POST') {
        const body = JSON.parse(route.request().postData() ?? '{}');
        assert(!('scenePrompt' in body), 'Create-session should not send client prompt text.');
        assert(!('dogPrompt' in body), 'Create-session should not send client dog prompt text.');
        createBodies.push(body);
        const sessionId = `${body.scene}_journey_${++createCounter}`;
        const session = makeSession(sessionId, body.scene, { nDogs: body.nDogs ?? 30 });
        sessions.set(sessionId, session);
        await route.fulfill({
          json: {
            sessionId,
            scenePrompt: session.scenePrompt,
            dogPrompt: session.dogPrompt,
            promptContext: { source: 'server-recipe-prompt-v1' },
          },
        });
        return;
      }
      if (url.pathname === '/api/sessions' && method === 'GET') {
        await route.fulfill({
          json: Array.from(sessions.values()).map(sessionListItem),
        });
        return;
      }
      if (url.pathname === '/api/sessions/visibility-checks' && method === 'POST') {
        visibilityBatchRequests += 1;
        const body = JSON.parse(route.request().postData() ?? '{}');
        const ids = Array.isArray(body.sessionIds) ? body.sessionIds : [];
        await route.fulfill({
          json: {
            reports: Object.fromEntries(ids.map((id) => [id, { issues: [] }])),
          },
        });
        return;
      }

      const sessionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)$/);
      if (sessionMatch && method === 'GET') {
        const id = decodeURIComponent(sessionMatch[1]);
        const session = sessions.get(id);
        if (!session) {
          await route.fulfill({ status: 404, json: { detail: { error: 'session not found' } } });
          return;
        }
        await route.fulfill({ json: session });
        return;
      }
      const selectMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/select-bg$/);
      if (selectMatch && method === 'POST') {
        const id = decodeURIComponent(selectMatch[1]);
        const session = sessions.get(id);
        assert(session, `Missing session ${id}`);
        markBackgroundReady(session);
        session.selectedBgIndex = 0;
        session.bgWidth = 1024;
        session.bgHeight = 1536;
        session.sections = [{ id: 'full', x: 0, y: 0, width: 1024, height: 1536 }];
        session.hitboxes = [];
        session.dogs = [];
        await route.fulfill({
          json: {
            selectedBgIndex: 0,
            bgWidth: session.bgWidth,
            bgHeight: session.bgHeight,
            sections: session.sections,
          },
        });
        return;
      }
      const bgJobMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/background-generation\/jobs$/);
      if (bgJobMatch && method === 'POST') {
        backgroundJobStarts += 1;
        const id = decodeURIComponent(bgJobMatch[1]);
        await route.fulfill({
          json: {
            jobId: `bg-job-${id}`,
            status: 'queued',
            succeeded: 0,
            failed: 0,
            backgrounds: [],
            error: null,
          },
        });
        return;
      }
      const autoPlaceMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/auto-hitboxes$/);
      if (autoPlaceMatch && method === 'POST') {
        const id = decodeURIComponent(autoPlaceMatch[1]);
        const session = sessions.get(id);
        assert(session, `Missing session ${id}`);
        const body = JSON.parse(route.request().postData() ?? '{}');
        assert(body.nDogs === 30, `Expected default auto-place nDogs=30, got ${JSON.stringify(body)}.`);
        session.hitboxes = hitboxesFor(body.nDogs);
        await route.fulfill({ json: { hitboxes: session.hitboxes } });
        return;
      }
      const visibilityMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/mobile-visibility$/);
      if (visibilityMatch && method === 'GET') {
        await route.fulfill({ json: { issues: [] } });
        return;
      }
      const inpaintJobMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/inpaint\/jobs$/);
      if (inpaintJobMatch && method === 'POST') {
        inpaintJobStarts += 1;
        const id = decodeURIComponent(inpaintJobMatch[1]);
        await route.fulfill({
          json: {
            jobId: `inpaint-job-${id}`,
            status: 'queued',
            succeeded: 0,
            failed: 0,
            total: sessions.get(id)?.hitboxes.length ?? 0,
            error: null,
          },
        });
        return;
      }
      const inpaintStatusMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/inpaint\/jobs\/([^/]+)$/);
      if (inpaintStatusMatch && method === 'GET') {
        const id = decodeURIComponent(inpaintStatusMatch[1]);
        const session = sessions.get(id);
        assert(session, `Missing session ${id}`);
        markCompleted(session);
        await route.fulfill({
          json: {
            jobId: decodeURIComponent(inpaintStatusMatch[2]),
            status: 'succeeded',
            succeeded: session.dogs.length,
            failed: 0,
            total: session.dogs.length,
            error: null,
          },
        });
        return;
      }
      const bgStatusMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/background-generation\/jobs\/([^/]+)$/);
      if (bgStatusMatch && method === 'GET') {
        const id = decodeURIComponent(bgStatusMatch[1]);
        const session = sessions.get(id);
        assert(session, `Missing session ${id}`);
        markBackgroundReady(session);
        await route.fulfill({
          json: {
            jobId: decodeURIComponent(bgStatusMatch[2]),
            status: 'succeeded',
            succeeded: 1,
            failed: 0,
            backgrounds: session.backgrounds,
            error: null,
          },
        });
        return;
      }
      if (url.pathname === '/api/sequence-workflow' && method === 'GET') {
        await route.fulfill({ json: makeWorkflowState() });
        return;
      }
      if (url.pathname === '/api/sequence-workflow/bundle-projection' && method === 'GET') {
        await route.fulfill({
          json: {
            capBytes: 200 * 1024 * 1024,
            boundaryIndex: Math.min(1, draftIds.length),
            bundledBytes: 7 * 1024 * 1024,
            levels: draftIds.map((id, index) => ({
              id,
              exported: true,
              sizeBytes: 7 * 1024 * 1024,
              cumulativeBytes: (index + 1) * 7 * 1024 * 1024,
              bundled: index === 0,
            })),
          },
        });
        return;
      }
      if (url.pathname === '/api/build-size' && method === 'GET') {
        await route.fulfill({ json: buildSize() });
        return;
      }
      if (url.pathname === '/api/sequence-workflow/draft' && method === 'PUT') {
        const body = JSON.parse(route.request().postData() ?? '{}');
        draftSaveBodies.push(body);
        draftSaveCount += 1;
        draftIds = body.levelIds;
        draftRevision = `draft-journey-${draftSaveCount}`;
        await route.fulfill({ json: makeWorkflowState() });
        return;
      }
      if (url.pathname === '/api/sequence-workflow/dry-run' && method === 'POST') {
        const body = JSON.parse(route.request().postData() ?? '{}');
        await route.fulfill({ json: dryRunPayload(body.changelogNote) });
        return;
      }
      if (url.pathname === '/api/sequence-workflow/start' && method === 'POST') {
        startRequests += 1;
        const body = JSON.parse(route.request().postData() ?? '{}');
        const id = `journey-start-${++startJobCounter}`;
        startJobs.set(id, {
          polls: 0,
          body,
          queued: startJob(id),
        });
        await route.fulfill({ json: startJob(id) });
        return;
      }
      if (url.pathname.startsWith('/api/jobs/') && method === 'GET') {
        startJobGets += 1;
        const id = decodeURIComponent(url.pathname.replace('/api/jobs/', ''));
        const record = startJobs.get(id);
        if (!record) {
          await route.fulfill({ status: 404, json: { detail: { error: 'Job not found' } } });
          return;
        }
        record.polls += 1;
        if (record.polls === 1) {
          await route.fulfill({ json: record.queued });
          return;
        }
        const activation = activationPayload(record.body.changelogNote);
        await route.fulfill({
          json: startJob(id, {
            status: 'succeeded',
            stage: 'succeeded',
            result: {
              dryRun: dryRunPayload(record.body.changelogNote),
              bundle: { applied: true, bundledIds: [draftIds[0]].filter(Boolean), projection: null },
              activation,
              state: makeWorkflowState({ activation: activation.state }),
            },
            completedAt: nowIso,
          }),
        });
        return;
      }

      await route.continue();
    });

    await page.goto(baseUrl);
    await page.getByText('Configure').waitFor();
    await assertAbsentNormalFlowText(page, 'body');

    await page.getByRole('button', { name: 'Generate Level' }).click();
    await page.waitForFunction(() => window.__journeyEventSources.length === 1);
    const singleSessionId = createBodies[0].scene + '_journey_1';
    await page.evaluate((background) => {
      const source = window.__journeyEventSources.at(-1);
      source.emit('bg_ready', background);
      source.emit('generate_complete', {});
    }, backgroundFor('japan_garden'));
    markBackgroundReady(sessions.get(singleSessionId));

    await page.getByAltText('Background 0').click();
    await page.locator('.dogs-canvas').waitFor();
    if (await page.getByRole('button', { name: 'Auto-place', exact: true }).count() === 0) {
      throw new Error(`Auto-place missing after background selection. Diagnostics:\n${browserDiagnostics.join('\n')}\nBody:\n${await page.locator('body').innerText()}`);
    }
    await page.getByRole('button', { name: 'Auto-place', exact: true }).click();
    try {
      await page.waitForFunction(() => document.body.innerText.includes('30 hitboxes'), null, { timeout: 5_000 });
    } catch (error) {
      throw new Error(`Auto-place did not update hitbox count. Diagnostics:\n${browserDiagnostics.join('\n')}\nBody:\n${await page.locator('body').innerText()}\n${error.message}`);
    }
    await page.getByRole('button', { name: /Inpaint All dogs \(30\)/ }).click();
    await page.waitForFunction(() => document.body.innerText.includes('Regenerate All Dogs (30)'));

    assert(backgroundJobStarts >= 1, `Expected a durable background job for single generation, got ${backgroundJobStarts}.`);
    assert(inpaintJobStarts === 1, `Expected one durable inpaint job, got ${inpaintJobStarts}.`);
    assert(geometryRequests > 0, 'Expected Dogs canvas to fetch server-authoritative geometry.');
    assert(dogProxyRequests > 0, 'Expected Dogs canvas to use the stable bg-only proxy URL.');

    await page.getByTitle('Reset the wizard to an empty Step 1').click();
    await page.getByTestId('mode-many-scenes').click();
    await page.getByTestId('scene-check-japan_market').check();
    await page.getByTestId('generate-many-scenes').click();
    await page.waitForFunction(() => window.__journeyEventSources.length === 3);
    await page.evaluate((backgrounds) => {
      for (const [index, background] of backgrounds.entries()) {
        const source = window.__journeyEventSources[index + 1];
        source.emit('bg_ready', background);
        source.emit('generate_complete', {});
      }
    }, [backgroundFor('japan_garden'), backgroundFor('japan_market')]);
    for (const session of sessions.values()) {
      if (session.id !== singleSessionId) {
        markBackgroundReady(session);
        markCompleted(session);
      }
    }
    await page.waitForSelector('[data-testid="many-scene-job-japan_garden"] >> text=ready');
    await page.waitForSelector('[data-testid="many-scene-job-japan_market"] >> text=ready');

    const createdScenes = createBodies.map((body) => body.scene).sort();
    assert(JSON.stringify(createdScenes) === JSON.stringify(['japan_garden', 'japan_garden', 'japan_market']), `Expected single plus two many-scene create calls, got ${JSON.stringify(createdScenes)}.`);
    assert(backgroundJobStarts === 3, `Expected three durable background jobs, got ${backgroundJobStarts}.`);

    await page.getByRole('button', { name: 'Gallery' }).click();
    await page.waitForSelector('[data-gallery-card-id]');
    await assertAbsentNormalFlowText(page, 'body');
    await page.waitForFunction(() => document.body.innerText.includes('3 / 3 cards'));
    await page.waitForTimeout(500);
    assert(visibilityBatchRequests > 0, 'Expected Gallery to validate mobile visibility before Lineup selection.');

    const completedIds = Array.from(sessions.values()).filter((session) => session.exported).map((session) => session.id);
    const selectedIds = [singleSessionId, completedIds.find((id) => id !== singleSessionId)].filter(Boolean);
    assert(selectedIds.length === 2, `Expected two completed sessions for Lineup selection, got ${JSON.stringify(completedIds)}.`);
    for (const id of selectedIds) {
      const card = page.locator(`[data-gallery-card-id="${id}::gemini"]`);
      await card.getByRole('button', { name: 'Add to Lineup' }).click();
      await page.waitForSelector(`[data-gallery-card-id="${id}::gemini"][data-lineup-selected="true"]`);
    }
    assert(JSON.stringify(draftIds) === JSON.stringify(selectedIds), `Gallery should own Lineup membership; got ${JSON.stringify(draftIds)}.`);

    await page.getByRole('button', { name: 'Lineup', exact: true }).click();
    await page.waitForSelector('.sequence-page');
    await assertAbsentNormalFlowText(page, '.sequence-page');
    await page.waitForTimeout(250);
    assert(galleryThumbRequests > 0, 'Expected Gallery/Lineup to request thumbnail proxy URLs.');
    assert(fullColorRequests === 0, `Hot paths should avoid full-resolution color.png, got ${fullColorRequests} requests.`);

    await dragBefore(
      page,
      `[data-sequence-card-id="${selectedIds[1]}"]`,
      `[data-sequence-card-id="${selectedIds[0]}"]`,
    );
    await page.waitForFunction(() => document.body.innerText.includes('Unsaved order changes'));
    await page.getByRole('button', { name: 'Save order' }).click();
    await page.waitForFunction(() => !document.body.innerText.includes('Unsaved order changes'));
    assert(JSON.stringify(draftIds) === JSON.stringify([selectedIds[1], selectedIds[0]]), `Expected reordered Lineup draft, got ${JSON.stringify(draftIds)}.`);
    assert(JSON.stringify(draftSaveBodies.at(-1).levelIds) === JSON.stringify(draftIds), 'Expected reordered draft body to be persisted.');

    await page.getByText('Diagnostics and recovery').click();
    await page.getByRole('button', { name: 'Validation check only' }).click();
    await page.waitForSelector('[data-sequence-dry-run-result="true"]');
    const dryRunText = await page.locator('[data-sequence-dry-run-result="true"]').innerText();
    assert(dryRunText.includes('Validation payload ready'), `Expected validation result, got: ${dryRunText}`);

    await page.locator('[data-sequence-start="true"]').click();
    await page.waitForSelector('text=journey-start-1');
    await page.reload();
    await page.waitForSelector('[data-sequence-activation-result="true"]', { state: 'attached' });
    const activationText = await page.locator('[data-sequence-activation-result="true"]').textContent() ?? '';
    assert(activationText.includes('Lineup updated.'), `Expected recovered Start activation result, got: ${activationText}`);
    assert(startRequests === 1, `Expected one Start request, got ${startRequests}.`);
    assert(startJobGets >= 2, `Expected reload/poll recovery through durable job GETs, got ${startJobGets}.`);
    assert(galleryPreviewRequests === 0, `Normal selection/order flow should not fetch full gallery previews, got ${galleryPreviewRequests}.`);
  } finally {
    if (browser) await browser.close();
    stopVite(vite);
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
