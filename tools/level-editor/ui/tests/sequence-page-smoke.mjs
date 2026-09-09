import { createServer } from 'node:net';
import process from 'node:process';
import { URL } from 'node:url';
import { startSmokeVite, launchSmokeBrowser } from './smoke-support.mjs';

const port = await freePort();
const baseUrl = `http://127.0.0.1:${port}`;

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === 'object') {
          resolve(address.port);
        } else {
          reject(new Error('Could not allocate a free port'));
        }
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
    if (process.platform === 'win32') {
      vite.kill();
    } else {
      process.kill(-vite.pid, 'SIGTERM');
    }
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
}

function diagnostic(code, message, severity = 'error') {
  return { code, severity, blocking: severity === 'error', message };
}

function row(levelId, overrides = {}) {
  return {
    levelId,
    draftIndex: 0,
    liveIndex: null,
    draftListed: true,
    liveListed: false,
    added: true,
    moved: false,
    removed: false,
    catalogStatus: 'available',
    catalogListable: true,
    bundledInApp: false,
    cohortRestricted: false,
    tombstoned: false,
    name: levelId.replaceAll('_', ' '),
    ...overrides,
  };
}

function makeState({
  levelIds,
  catalogRevision = 'catalog-000001',
  diagnostics = [],
  warnings = [],
  rows,
  copyFixPrompt = null,
  liveSequenceVersion = 'editor-default-7',
  liveLevelIds = ['starter_a'],
  draftRevision = `draft-${catalogRevision}-${liveSequenceVersion}-${levelIds.join('-') || 'empty'}`,
  activation,
}) {
  const blockingDiagnostics = diagnostics.filter((item) => item.blocking);
  const visibleRows = rows ?? [
    ...levelIds.map((id, index) => row(id, {
      draftIndex: index,
      liveIndex: liveLevelIds.includes(id) ? liveLevelIds.indexOf(id) : null,
      liveListed: liveLevelIds.includes(id),
      added: !liveLevelIds.includes(id),
      bundledInApp: id === 'starter_a',
      catalogStatus: id === 'missing_level' ? 'missing' : 'available',
    })),
    ...liveLevelIds
      .filter((id) => !levelIds.includes(id))
      .map((id) => row(id, {
        draftIndex: null,
        liveIndex: liveLevelIds.indexOf(id),
        draftListed: false,
        liveListed: true,
        added: false,
        removed: true,
        name: id.replaceAll('_', ' '),
      })),
  ];
  const activationState = activation ?? {
    schemaVersion: 1,
    activeVersion: liveSequenceVersion,
    versions: [],
    auditEvents: [],
    pendingAttempts: [],
    retention: { retainedLevelIds: [], retainedPackageIds: [] },
    updatedAt: null,
  };
  return {
    schemaVersion: 1,
    liveSequence: {
      sequenceVersion: liveSequenceVersion,
      catalogRevision,
      levelIds: liveLevelIds,
      source: 'bundled-manifest-default',
      updatedAt: null,
    },
    draft: {
      levelIds,
      baseLiveSequenceVersion: liveSequenceVersion,
      baseCatalogRevision: catalogRevision,
      updatedAt: '2026-05-25T00:00:00Z',
      draftRevision,
    },
    catalog: {
      available: true,
      catalogRevision,
      levelCount: 4,
      levels: [
        { id: 'starter_a', name: 'Starter A', packageId: 'starter_a:pkg', listable: true, bundledInApp: true, cohortBuckets: ['all'], allCohortAvailable: true, tombstonedAt: null },
        { id: 'catalog_ready', name: 'Catalog Ready', packageId: 'catalog_ready:pkg', listable: true, bundledInApp: false, cohortBuckets: ['all'], allCohortAvailable: true, tombstonedAt: null },
        { id: 'catalog_extra', name: 'Catalog Extra', packageId: 'catalog_extra:pkg', listable: true, bundledInApp: false, cohortBuckets: ['all'], allCohortAvailable: true, tombstonedAt: null },
        { id: 'cohort_level', name: 'Cohort Level', packageId: 'cohort_level:pkg', listable: false, bundledInApp: false, cohortBuckets: [[0, 50]], allCohortAvailable: false, tombstonedAt: null },
      ],
    },
    localPreview: {
      source: 'tools/ab-config.json + public/levels',
      levelCount: 3,
      starterLevelIds: ['starter_a'],
      missingStarterLevelIds: [],
      levels: [
        { id: 'starter_a', name: 'Starter A', inStarterPrefix: true, inRuntimeManifest: true, catalogUploaded: true, catalogListable: true },
        { id: 'catalog_ready', name: 'Catalog Ready', inStarterPrefix: false, inRuntimeManifest: false, catalogUploaded: true, catalogListable: true },
        { id: 'catalog_extra', name: 'Catalog Extra', inStarterPrefix: false, inRuntimeManifest: false, catalogUploaded: true, catalogListable: true },
      ],
    },
    supportedBuilds: {
      source: 'derived-from-bundled-manifest',
      platforms: ['android', 'ios'],
      starterLevelIds: ['starter_a'],
      diagnostics: [],
    },
    validation: {
      activatable: blockingDiagnostics.length === 0,
      dryRunnable: blockingDiagnostics.length === 0,
      diagnostics: [...diagnostics, ...warnings],
      blockingDiagnostics,
      warnings,
      diff: {
        addedIds: levelIds.filter((id) => !liveLevelIds.includes(id)),
        removedIds: liveLevelIds.filter((id) => !levelIds.includes(id)),
        movedIds: [],
        destructive: warnings.length > 0,
      },
      rows: visibleRows,
      missingCatalogLevelIds: levelIds.includes('missing_level') ? ['missing_level'] : [],
      copyFixPrompt,
    },
    activation: activationState,
  };
}

const missingPrompt = 'Find the Dog sequence draft is blocked because missing_level is missing from the production catalog. Upload assets to the production catalog only if already approved for production catalog availability. Do not activate or publish the live sequence.';
let workflowState = makeState({
  levelIds: ['starter_a', 'missing_level'],
  diagnostics: [diagnostic('catalogLevelMissing', 'Draft-listed level missing_level is missing from the production catalog.')],
  warnings: [diagnostic('sequenceDestructiveChange', 'Draft removes or moves live-listed levels.', 'warning')],
  copyFixPrompt: missingPrompt,
});
let staleOnNextSave = 0;
let holdJobResults = false;
const saveBodies = [];
let failNextDryRun = false;
let delayNextDryRun = false;
let delayNextSave = false;
let conflictOnNextActivate = false;
let appliedProjections = 0;
let activationRequests = 0;
let startRequests = 0;
let startJobCounter = 0;
let startJobGetCount = 0;
const startJobs = new Map();
let resumeDelayedDryRun;
let resumeDelayedSave;
let draftSaveCount = 0;
let thumbnailRequests = 0;
let publicColorRequests = 0;
let buildSizeResponse = {
  limitBytes: 200000000,
  artifact: {
    path: 'android/app/build/outputs/apk/debug/app-debug.apk',
    kind: 'apk',
    buildType: 'debug',
    sizeBytes: 220396113,
    modifiedAt: 1780420860,
    overLimit: true,
    budgetApplies: false,
    storeBudgetOverLimit: false,
  },
  distSizeBytes: 171000000,
  androidPublicAssetsSizeBytes: 171000000,
  levelAssetsSizeBytes: 147000000,
};

function startJob(id, overrides = {}) {
  return {
    id,
    parentJobId: null,
    kind: 'sequence_start',
    sessionId: 'sequence-workflow',
    idempotencyKey: `test-${id}`,
    inputHash: `test-${id}`,
    status: 'queued',
    stage: 'queued',
    retryable: false,
    errorCode: null,
    errorMessage: null,
    metadata: {},
    result: {},
    workerOwner: null,
    heartbeatAt: null,
    createdAt: '2026-06-12T00:00:00Z',
    updatedAt: '2026-06-12T00:00:00Z',
    completedAt: null,
    ...overrides,
  };
}

function dryRunPayload(changelogNote) {
  const rawPayload = JSON.stringify({
    schemaVersion: 1,
    sequenceVersion: 'seq-editor-dry-run-test',
    catalogRevision: workflowState.catalog.catalogRevision,
    levelIds: workflowState.draft.levelIds,
  });
  return {
    ok: true,
    changelogNote,
    payload: {
      schemaVersion: 1,
      sequenceVersion: 'seq-editor-dry-run-test',
      catalogRevision: workflowState.catalog.catalogRevision,
      levelIds: workflowState.draft.levelIds,
    },
    rawPayload,
    sha256Hex: 'abc123dryrunhash',
    diagnostics: workflowState.validation.diagnostics,
    state: workflowState,
    globalActivationMutated: false,
  };
}

function activationPayload(changelogNote) {
  const sequenceVersion = `seq-live-${draftSaveCount}`;
  const rawPayload = JSON.stringify({
    schemaVersion: 1,
    sequenceVersion,
    catalogRevision: workflowState.catalog.catalogRevision,
    levelIds: workflowState.draft.levelIds,
  });
  const version = {
    sequenceVersion,
    catalogRevision: workflowState.catalog.catalogRevision,
    levelIds: workflowState.draft.levelIds,
    rawPayload,
    sha256Hex: 'abc123activationhash',
    rollbackEligible: true,
    createdAt: '2026-05-26T00:00:00Z',
    changelogNote,
    packageIds: workflowState.draft.levelIds.map((id) => `${id}:pkg`),
  };
  const previousVersion = {
    sequenceVersion: workflowState.liveSequence.sequenceVersion,
    catalogRevision: workflowState.liveSequence.catalogRevision,
    levelIds: workflowState.liveSequence.levelIds,
    rawPayload: JSON.stringify({
      schemaVersion: 1,
      sequenceVersion: workflowState.liveSequence.sequenceVersion,
      catalogRevision: workflowState.liveSequence.catalogRevision,
      levelIds: workflowState.liveSequence.levelIds,
    }),
    sha256Hex: 'abc123previoushash',
    rollbackEligible: true,
    createdAt: '2026-05-25T00:00:00Z',
    changelogNote: 'Previous sequence.',
    packageIds: workflowState.liveSequence.levelIds.map((id) => `${id}:pkg`),
  };
  const activation = {
    schemaVersion: 1,
    activeVersion: sequenceVersion,
    versions: [previousVersion, version],
    auditEvents: [{ operation: 'activate', sequenceVersion, createdAt: '2026-05-26T00:00:01Z' }],
    pendingAttempts: [],
    retention: { retainedLevelIds: workflowState.draft.levelIds, retainedPackageIds: workflowState.draft.levelIds.map((id) => `${id}:pkg`) },
    updatedAt: '2026-05-26T00:00:01Z',
  };
  workflowState = makeState({
    levelIds: workflowState.draft.levelIds,
    liveLevelIds: workflowState.draft.levelIds,
    liveSequenceVersion: sequenceVersion,
    catalogRevision: workflowState.catalog.catalogRevision,
    draftRevision: `draft-after-${sequenceVersion}`,
    activation,
  });
  return { ok: true, version, state: activation, idempotent: false };
}

async function run() {
  const vite = startSmokeVite(port);
  let browser;
  try {
    await waitForServer();
    browser = await launchSmokeBrowser(baseUrl);
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });

    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/sessions') {
        await route.fulfill({ json: [] });
        return;
      }
      if (url.pathname.includes('/gallery-thumb/')) {
        thumbnailRequests += 1;
        await route.fulfill({ status: 404, body: 'missing thumbnail' });
        return;
      }
      if (url.pathname.startsWith('/public-levels/') && url.pathname.endsWith('/color.png')) {
        publicColorRequests += 1;
        await route.fulfill({ status: 200, body: '' });
        return;
      }
      if (url.pathname === '/api/config') {
        await route.fulfill({
          json: {
            views: { isometric: 'Isometric' },
            styles: { cartoon: 'Cartoon' },
            settings: { harbor: { label: 'Harbor', scenes: { market: 'Market scene' } } },
            entities: { dog: 'dog' },
            entityPromptTemplate: 'Add a {entity}.',
            models: [{ id: 'model-a', label: 'Model A' }],
            inpaintModels: [{ id: 'model-b', label: 'Model B' }],
            upscaleModels: [],
          },
        });
        return;
      }
      if (url.pathname === '/api/build-size') {
        await route.fulfill({
          json: buildSizeResponse,
        });
        return;
      }
      if (url.pathname === '/api/sequence-workflow/bundle-projection' && route.request().method() === 'GET') {
        // C1: dynamic boundary derived from the current draft order.
        const ids = workflowState.draft.levelIds;
        await route.fulfill({ json: {
          capBytes: 200 * 1024 * 1024,
          boundaryIndex: Math.min(1, ids.length),
          bundledBytes: 5 * 1024 * 1024,
          levels: ids.map((id, i) => ({ id, exported: true, sizeBytes: 5 * 1024 * 1024, cumulativeBytes: i === 0 ? 5 * 1024 * 1024 : null, bundled: i === 0 })),
        } });
        return;
      }
      if (url.pathname === '/api/sequence-workflow/apply-bundle-projection' && route.request().method() === 'POST') {
        appliedProjections += 1;
        await route.fulfill({ json: { applied: true, bundledIds: [workflowState.draft.levelIds[0]].filter(Boolean), projection: null } });
        return;
      }
      if (url.pathname === '/api/sequence-workflow' && route.request().method() === 'GET') {
        await route.fulfill({ json: workflowState });
        return;
      }
      if (url.pathname === '/api/sequence-workflow/draft' && route.request().method() === 'PUT') {
        const body = JSON.parse(route.request().postData() ?? '{}');
        saveBodies.push(body);
        if (staleOnNextSave) {
          staleOnNextSave -= 1;
          const staleState = makeState({
            levelIds: workflowState.draft.levelIds,
            catalogRevision: 'catalog-000002',
            liveSequenceVersion: 'seq-new-live',
            // The concurrent writer has a valid current draft; this request's
            // base is stale. A stale SERVER draft is a separate self-heal flow.
          });
          await route.fulfill({
            status: 409,
            json: { detail: { error: 'Sequence draft base is stale; reload current live/catalog state.', code: 'sequence_draft_stale', state: staleState } },
          });
          return;
        }
        draftSaveCount += 1;
        workflowState = makeState({ levelIds: body.levelIds, draftRevision: `draft-saved-${draftSaveCount}` });
        if (delayNextSave) {
          delayNextSave = false;
          await new Promise((resolve) => { resumeDelayedSave = resolve; });
        }
        await route.fulfill({ json: workflowState });
        return;
      }
      if (url.pathname === '/api/sequence-workflow/draft' && route.request().method() === 'DELETE') {
        workflowState = makeState({ levelIds: ['starter_a'], draftRevision: 'draft-reset' });
        await route.fulfill({ json: workflowState });
        return;
      }
      if (url.pathname === '/api/sequence-workflow/dry-run' && route.request().method() === 'POST') {
        const body = JSON.parse(route.request().postData() ?? '{}');
        if (failNextDryRun) {
          failNextDryRun = false;
          const failedState = makeState({
            levelIds: workflowState.draft.levelIds,
            diagnostics: [diagnostic('catalogLevelMissing', 'Synthetic dry-run blocker.')],
          });
          await route.fulfill({
            status: 422,
            json: { detail: { error: 'Sequence draft has blocking validation diagnostics.', code: 'sequence_validation_failed', state: failedState } },
          });
          return;
        }
        const rawPayload = JSON.stringify({ schemaVersion: 1, sequenceVersion: 'seq-editor-dry-run-test', catalogRevision: workflowState.catalog.catalogRevision, levelIds: workflowState.draft.levelIds });
        if (delayNextDryRun) {
          delayNextDryRun = false;
          await new Promise((resolve) => { resumeDelayedDryRun = resolve; });
        }
        await route.fulfill({ json: { ...dryRunPayload(body.changelogNote), rawPayload } });
        return;
      }
      if (url.pathname === '/api/sequence-workflow/start' && route.request().method() === 'POST') {
        startRequests += 1;
        const body = JSON.parse(route.request().postData() ?? '{}');
        const id = `sequence-start-${++startJobCounter}`;
        if (conflictOnNextActivate) {
          conflictOnNextActivate = false;
          startJobs.set(id, startJob(id, {
            status: 'failed_terminal',
            stage: 'failed_terminal',
            errorCode: 'remote_config_conflict',
            errorMessage: 'Remote Config template changed before publish; reload and retry.',
            result: { state: workflowState },
            completedAt: '2026-06-12T00:00:03Z',
          }));
          await route.fulfill({ json: startJob(id) });
          return;
        }
        appliedProjections += body.dynamicBundle === false ? 0 : 1;
        activationRequests += 1;
        const dryRun = dryRunPayload(body.changelogNote);
        const activation = activationPayload(body.changelogNote);
        startJobs.set(id, startJob(id, {
          status: 'succeeded',
          stage: 'succeeded',
          result: {
            dryRun,
            bundle: body.dynamicBundle === false ? null : { applied: true, bundledIds: [workflowState.draft.levelIds[0]].filter(Boolean), projection: null },
            activation,
            state: workflowState,
          },
          completedAt: '2026-06-12T00:00:03Z',
        }));
        await route.fulfill({ json: startJob(id) });
        return;
      }
      if (url.pathname.startsWith('/api/jobs/') && route.request().method() === 'GET') {
        startJobGetCount += 1;
        const id = decodeURIComponent(url.pathname.replace('/api/jobs/', ''));
        const job = startJobs.get(id);
        if (!job) {
          await route.fulfill({ status: 404, json: { detail: { error: 'Job not found' } } });
          return;
        }
        await route.fulfill({ json: holdJobResults ? startJob(id) : job });
        return;
      }
      await route.fallback();
    });

    await page.goto(`${baseUrl}/#sequence`);
    await page.waitForSelector('.sequence-page');
    const initialText = await page.locator('.sequence-page').innerText();
    for (const expected of ['LINEUP', 'catalogLevelMissing', 'Selected levels', 'destructive change']) {
      if (!initialText.includes(expected)) throw new Error(`Missing current Lineup state ${expected}: ${initialText}`);
    }
    const promptText = await page.locator('.sequence-copy-prompt').inputValue();
    if (!promptText.includes('only if already approved') || !promptText.includes('Do not activate')) {
      throw new Error(`Missing safe repair prompt: ${promptText}`);
    }
    await page.waitForTimeout(250);
    if (thumbnailRequests === 0 || publicColorRequests !== 0) {
      throw new Error(`Lineup preview must use thumbnail proxy: thumbs=${thumbnailRequests}, full=${publicColorRequests}`);
    }
    if (!await page.locator('.sequence-level-thumb-placeholder').first().isVisible()) {
      throw new Error('Missing thumbnail must show an inline placeholder.');
    }
    const thumbAspect = await page.locator('.sequence-level-thumb-wrap').first().evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width / rect.height;
    });
    if (Math.abs(thumbAspect - 1) > 0.02) throw new Error(`Expected current square campaign thumbnail, got ${thumbAspect}`);

    // Current Lineup autosaves. Keep the in-flight mutation guard assertion,
    // without invoking the retired Save order / diagnostics panel controls.
    delayNextSave = true;
    await page.locator('[data-sequence-row-id="missing_level"]').getByRole('button', { name: 'Remove' }).click();
    await page.waitForFunction(() => document.body.innerText.includes('Saving…'));
    if (await page.locator('[data-sequence-row-id="starter_a"]').getByRole('button', { name: 'Remove' }).isEnabled()) {
      throw new Error('Row mutation remained enabled during autosave.');
    }
    resumeDelayedSave?.();
    await page.waitForFunction(() => !document.body.innerText.includes('catalogLevelMissing'));
    if (draftSaveCount !== 1 || workflowState.draft.levelIds.join(',') !== 'starter_a') {
      throw new Error('Autosave did not persist the intended membership.');
    }

    conflictOnNextActivate = true;
    await page.locator('[data-sequence-start="true"]').click();
    await page.waitForSelector('[data-sequence-conflict="true"]');
    if (await page.locator('[data-sequence-start="true"]').isEnabled()) throw new Error('Conflicting Start must block retry until reload.');
    await page.getByRole('button', { name: 'Reload current state' }).click();
    await page.waitForFunction(() => !document.body.innerText.includes('Stale Lineup conflict'));

    // Keep the durable job pending across a real page reload, then complete
    // it. No publish occurs: the scripted transport owns every job response.
    holdJobResults = true;
    const getsBeforeReload = startJobGetCount;
    const expectedJob = `sequence-start-${startJobCounter + 1}`;
    await page.locator('[data-sequence-start="true"]').click();
    await page.getByText(expectedJob, { exact: true }).waitFor();
    await page.reload();
    await page.getByText(expectedJob, { exact: true }).waitFor();
    holdJobResults = false;
    await page.getByText('Complete', { exact: true }).waitFor();
    if (startRequests !== 2 || activationRequests !== 1 || appliedProjections !== 1 || startJobGetCount <= getsBeforeReload) {
      throw new Error(`Durable Start did not recover correctly: start=${startRequests}, activation=${activationRequests}, bundle=${appliedProjections}, polls=${startJobGetCount}`);
    }

    // Autosave rebases once onto a fresh server revision while preserving the
    // operator's intended ids. A second stale response must surface a conflict.
    staleOnNextSave = 1;
    const beforeRebase = draftSaveCount;
    await page.locator('[data-sequence-row-id="starter_a"]').getByRole('button', { name: 'Remove' }).click();
    await page.waitForFunction(() => !document.body.innerText.includes('Saving'));
    await page.waitForTimeout(500);
    if (draftSaveCount !== beforeRebase + 1 || workflowState.draft.levelIds.length !== 0) throw new Error('Single-conflict autosave failed to rebase intended membership.');
    const rebasedBody = saveBodies.at(-1);
    if (rebasedBody.baseCatalogRevision !== 'catalog-000002' || rebasedBody.baseLiveSequenceVersion !== 'seq-new-live') throw new Error('Retry ignored fresh server base revisions.');

    await page.getByRole('button', { name: 'Reset to current game order' }).click();
    await page.locator('[data-sequence-row-id="starter_a"]').waitFor();
    staleOnNextSave = 2;
    const beforeConflict = saveBodies.length;
    await page.locator('[data-sequence-row-id="starter_a"]').getByRole('button', { name: 'Remove' }).click();
    await page.waitForSelector('[data-sequence-conflict="true"]');
    await page.waitForTimeout(700);
    if (saveBodies.length !== beforeConflict + 2) throw new Error('Repeated stale save retried beyond its bounded second attempt.');
    if (await page.locator('[data-sequence-start="true"]').isEnabled()) throw new Error('Start remained enabled after repeated stale autosave.');
  } finally {
    await browser?.close();
    stopVite(vite);
  }
}

await run();
