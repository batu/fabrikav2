import { createServer } from 'node:net';
import { startSmokeVite, launchSmokeBrowser } from './smoke-support.mjs';

const port = await freePort();
const baseUrl = `http://127.0.0.1:${port}`;
const sessionId = 'cutout_review_demo';
const secondSessionId = 'cutout_review_demo_2';

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

function png(color) {
  const pixels = {
    red: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
    green: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAwUBAcgnV3EAAAAASUVORK5CYII=',
    blue: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPgPAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  };
  return Buffer.from(pixels[color] ?? pixels.red, 'base64');
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

async function run() {
  const vite = startSmokeVite(port);
  let browser;
  try {
    await waitForServer();
    browser = await launchSmokeBrowser(baseUrl);
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    let completedRegens = 0;
    let batchSubmissions = 0;
    let submittedDogIndices = [];
    let submittedBirdIds = [];
    let submittedCropBoxesByBirdId = {};
    let submittedCropBoxes = {};
    let submittedCutoutOnly = false;
    let submittedPlacement = null;
    let submittedFlipX = false;
    let submittedFlipY = false;
    const submittedPlacementRevisions = [];
    let placementRequestCount = 0;
    let placementRequestCountAtBatch = 0;
    let submittedModel = null;
    let overlayRequests = 0;
    const candidateRequests = new Map();
    const promptRequests = new Map();
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('/derived-crops')) {
        // This fixture exercises manual padding review, which is enabled only
        // when the server's derived-crop diff gate asks for human review.
        await route.fulfill({ json: { crops: {}, needsReview: true } });
        return;
      }
      const isCandidateRequest =
        url.pathname === `/api/sessions/${sessionId}/sprite-candidates` ||
        url.pathname === `/api/sessions/${secondSessionId}/sprite-candidates`;
      if (isCandidateRequest) {
        const candidateSessionId = url.pathname.split('/')[3];
        candidateRequests.set(candidateSessionId, (candidateRequests.get(candidateSessionId) ?? 0) + 1);
        await route.fulfill({
          json: {
            contentRevision: completedRegens > 0 ? 'revision-after-job' : undefined,
            operationalRevision: completedRegens > 0 ? 'operation-after-job' : undefined,
            candidates: [
              {
                id: 'dog_00:sprite_000',
                birdId: 'bird-zero',
                dogIndex: 0,
                spriteIndex: 0,
                status: 'ready',
                reason: null,
                image: 'dogs/dog_00/sprite_000.png',
                mask: 'dogs/dog_00/sprite_mask_000.png',
                metadataPath: 'dogs/dog_00/sprite_000.json',
                width: 42,
                height: 50,
                sceneWidth: 400,
                sceneHeight: 300,
                spriteBox: [60, 60, 120, 110],
                cleanupBox: [50, 50, 130, 120],
                anchorX: 0.5,
                anchorY: 0.5,
                flipX: submittedFlipX,
                flipY: submittedFlipY,
                technique: 'sam2-box075-component-cutout-v1',
                quality: { pickupUsable: true, bboxCoverage: 0.18, visibleCoverage: 0.09, edgeTouches: 0 },
              },
              {
                id: 'dog_00:sprite_001',
                birdId: 'bird-zero',
                dogIndex: 0,
                spriteIndex: 1,
                status: 'ready',
                reason: null,
                image: 'dogs/dog_00/sprite_001.png',
                mask: 'dogs/dog_00/sprite_mask_001.png',
                metadataPath: 'dogs/dog_00/sprite_001.json',
                width: 110,
                height: 120,
                sceneWidth: 400,
                sceneHeight: 300,
                technique: 'semantic-rembg-isnet-cutout-v1',
                quality: { pickupUsable: true, bboxCoverage: 0.72, visibleCoverage: 0.51, edgeTouches: 3 },
              },
              {
                id: 'dog_01:sprite_000',
                birdId: 'bird-one',
                dogIndex: 1,
                spriteIndex: 0,
                status: 'ready',
                reason: null,
                image: 'dogs/dog_01/sprite_000.png',
                mask: 'dogs/dog_01/sprite_mask_000.png',
                metadataPath: 'dogs/dog_01/sprite_000.json',
                width: 94,
                height: 88,
                sceneWidth: 400,
                sceneHeight: 300,
                technique: 'semantic-rembg-isnet-cutout-v1',
                quality: { pickupUsable: true, bboxCoverage: 0.64, visibleCoverage: 0.42, edgeTouches: 2 },
              },
              ...(completedRegens > 0
                ? [{
                    id: 'dog_01:sprite_001',
                    birdId: 'bird-one',
                    dogIndex: 1,
                    spriteIndex: 1,
                    status: 'ready',
                    reason: null,
                    image: 'dogs/dog_01/sprite_001.png',
                    mask: 'dogs/dog_01/sprite_mask_001.png',
                    metadataPath: 'dogs/dog_01/sprite_001.json',
                    width: 44,
                    height: 48,
                    sceneWidth: 400,
                    sceneHeight: 300,
                    technique: 'sam2-box075-component-cutout-v1',
                    quality: { pickupUsable: true, bboxCoverage: 0.16, visibleCoverage: 0.08, edgeTouches: 0 },
                  }]
                : []),
              {
                id: 'dog_02:sprite_000',
                birdId: 'bird-two',
                dogIndex: 2,
                spriteIndex: 0,
                status: 'not_pickup_usable',
                reason: 'sprite metadata marks this pickup as unusable',
                image: 'dogs/dog_02/sprite_000.png',
                mask: null,
                metadataPath: 'dogs/dog_02/sprite_000.json',
                width: 18,
                height: 18,
                sceneWidth: 400,
                sceneHeight: 300,
                technique: 'diff-mask-connected-components-v1',
                quality: { pickupUsable: false },
              },
            ],
          },
        });
        return;
      }
      if (url.pathname.endsWith('/cutout-extraction-prompt')) {
        const promptSessionId = url.pathname.split('/')[3];
        promptRequests.set(promptSessionId, (promptRequests.get(promptSessionId) ?? 0) + 1);
        await route.fulfill({ json: {
          entity: 'bird',
          prompt: 'CUTOUT-ONLY TASK. Extract and faithfully duplicate exactly ONE selected cartoon bird.',
        } });
        return;
      }
      if (url.pathname.match(/^\/api\/sessions\/[^/]+\/sprite-candidates\/[^/]+\/overlay$/)) {
        overlayRequests += 1;
        await route.fulfill({ contentType: 'image/png', body: png('blue') });
        return;
      }
      if (url.pathname.match(/^\/api\/sessions\/[^/]+\/sprite-candidate\//)) {
        await route.fulfill({ contentType: 'image/png', body: png('green') });
        return;
      }
      if (url.pathname.startsWith(`/api/sessions/${sessionId}/sprite-candidates/`) && url.pathname.endsWith('/placement') && route.request().method() === 'PUT') {
        placementRequestCount += 1;
        const body = route.request().postDataJSON();
        submittedPlacement = body.spriteBox;
        submittedFlipX = body.flipX;
        submittedFlipY = body.flipY;
        submittedPlacementRevisions.push(body.expectedContentRevision);
        if (placementRequestCount === 1) {
          await new Promise((resolve) => setTimeout(resolve, 1600));
        }
        await route.fulfill({ json: {
          ok: true,
          spriteBox: submittedPlacement,
          contentRevision: `revision-${submittedPlacementRevisions.length + 1}`,
        } });
        return;
      }
      if (url.pathname === `/api/sessions/${sessionId}/dogs/retry-inpaint/jobs` && route.request().method() === 'POST') {
        batchSubmissions += 1;
        placementRequestCountAtBatch = placementRequestCount;
        const body = route.request().postDataJSON();
        submittedDogIndices = body.dogIndices;
        submittedBirdIds = body.birdIds;
        submittedCropBoxes = body.cropBoxes;
        submittedCropBoxesByBirdId = body.cropBoxesByBirdId;
        submittedCutoutOnly = body.cutoutOnly;
        submittedModel = body.inpaintModel;
        await route.fulfill({ json: {
          jobId: 'retry_job_1', status: 'queued', succeeded: 0, failed: 0, units: [], error: null,
        } });
        return;
      }
      if (url.pathname === `/api/sessions/${sessionId}/dogs/retry-inpaint/jobs/retry_job_1`) {
        completedRegens = 1;
        await route.fulfill({ json: {
          jobId: 'retry_job_1', status: 'failed_retryable', succeeded: 1, failed: 1, error: 'one failed',
          units: [
            { dogIndex: 1, status: 'succeeded', retryable: false, error: null, file: 'dogs/dog_01/sprite_000.png', variantIndex: 0 },
            { dogIndex: 2, status: 'failed_retryable', retryable: true, error: 'dog 2 failed', file: null, variantIndex: null },
          ],
        } });
        return;
      }
      if (url.pathname.startsWith(`/levels/${sessionId}/`) || url.pathname.startsWith(`/levels/${secondSessionId}/`)) {
        await route.fulfill({ contentType: 'image/png', body: png(url.pathname.includes('dog_01') ? 'green' : url.pathname.includes('dog_02') ? 'blue' : 'red') });
        return;
      }
      await route.fallback();
    });

    await page.addInitScript((key) => {
      window.localStorage.setItem(key, 'null');
    }, `ftd-cutout-review:${sessionId}`);
    await page.goto(`${baseUrl}/tests/cutout-review-panel-harness.html`);
    await page.waitForSelector('.cutout-review-card');
    await page.waitForTimeout(250);
    if ((candidateRequests.get(sessionId) ?? 0) !== 1) {
      throw new Error(`Revision callback caused a cutout refresh loop: ${JSON.stringify(Object.fromEntries(candidateRequests))}`);
    }
    await page.screenshot({ path: process.env.SMOKE_SHOT_DIR ? process.env.SMOKE_SHOT_DIR + '/ftb-cutout-inline-actions.png' : '/tmp/ftb-cutout-inline-actions.png', fullPage: true });
    if (await page.getByLabel('Model').inputValue() !== 'google/gemini-3.1-flash-image-preview') {
      throw new Error('Cutout model picker did not default to Gemini 3.1 Flash');
    }
    const overlayBounds = await page.locator('.cutout-review-overlay').first().boundingBox();
    if (!overlayBounds || Math.abs(overlayBounds.width - overlayBounds.height) > 1) {
      throw new Error(`Expected a square cutout review overlay, saw ${JSON.stringify(overlayBounds)}`);
    }
    if (overlayBounds.width < 400) {
      throw new Error(`Expected a large placement workspace, saw ${JSON.stringify(overlayBounds)}`);
    }
    const firstLabel = await page.locator('.cutout-review-card').first().locator('strong').innerText();
    if (!firstLabel.includes('sprite 000')) {
      throw new Error(`Expected active dog variant to use sprite 000, saw: ${firstLabel}`);
    }
    const firstCard = page.locator('.cutout-review-card').first();
    const spritePreview = firstCard.locator('.cutout-review-tool-image');
    const controls = firstCard.locator('.cutout-review-controls');
    const spriteImageCount = await spritePreview.locator('img').count();
    const controlGroupCount = await controls.locator('.cutout-crop-controls').count();
    if (spriteImageCount !== 1 || controlGroupCount !== 1) {
      throw new Error(`Expected one colored sprite with one toggled control panel on its right, saw ${JSON.stringify({ spriteImageCount, controlGroupCount })}`);
    }
    const spriteBounds = await spritePreview.boundingBox();
    const controlsBounds = await controls.boundingBox();
    if (!spriteBounds || !controlsBounds || controlsBounds.x <= spriteBounds.x + spriteBounds.width) {
      throw new Error(`Expected controls to the right of the sprite, saw ${JSON.stringify({ spriteBounds, controlsBounds })}`);
    }
    if (await controls.getByRole('tab', { name: 'Sprite' }).getAttribute('aria-selected') !== 'true') {
      throw new Error('Sprite controls should be active initially');
    }
    for (const label of ['Smaller', 'Larger', 'Wider', 'Narrower', 'Taller', 'Shorter']) {
      if (await controls.getByRole('button', { name: label, exact: true }).count() !== 1) {
        throw new Error(`Missing ${label} resize control`);
      }
    }
    if (await firstCard.getByRole('button', { name: 'Save placement' }).count() !== 0) {
      throw new Error('Placement should auto-save without an explicit save button');
    }
    const draggableOverlay = firstCard.locator('.cutout-review-overlay');
    if (await draggableOverlay.locator('img[draggable="false"]').count() !== 2) {
      throw new Error('Overlay preview still allows native image dragging');
    }
    const draggableBounds = await draggableOverlay.boundingBox();
    if (!draggableBounds) throw new Error('Missing draggable overlay bounds');
    const candidateRequestsBeforePlacement = candidateRequests.get(sessionId) ?? 0;
    await page.mouse.move(draggableBounds.x + draggableBounds.width / 2, draggableBounds.y + draggableBounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(draggableBounds.x + draggableBounds.width / 2 + 20, draggableBounds.y + draggableBounds.height / 2);
    await page.mouse.up();
    await firstCard.getByRole('tab', { name: 'Padding' }).click();
    await page.waitForTimeout(100);
    for (const label of ['Move left', 'Move right', 'Move up', 'Move down']) {
      if (await controls.getByRole('button', { name: label, exact: true }).count() !== 1) {
        throw new Error(`Missing ${label} padding movement control`);
      }
    }
    // CL-12 amended 2026-08-13: padding is regeneration-only, editable by
    // entering Padding mode; the hint states that purpose.
    const paddingTitle = await draggableOverlay.getAttribute('title');
    if (!paddingTitle || !paddingTitle.includes('ONLY when regenerating')) {
      throw new Error(`Padding mode did not explain its drag behavior: ${paddingTitle}`);
    }
    const paddingLeft = firstCard.getByLabel('dog #0 · sprite 000 padding left');
    const paddingTop = firstCard.getByLabel('dog #0 · sprite 000 padding top');
    const paddingRight = firstCard.getByLabel('dog #0 · sprite 000 padding right');
    const paddingBottom = firstCard.getByLabel('dog #0 · sprite 000 padding bottom');
    const paddingLeftBefore = Number(await paddingLeft.inputValue());
    const paddingTopBefore = Number(await paddingTop.inputValue());
    const paddingRightBefore = Number(await paddingRight.inputValue());
    const paddingBottomBefore = Number(await paddingBottom.inputValue());
    const overlayRequestsBeforePaddingDrag = overlayRequests;
    // 2026-08-13: padding now DEFAULTS to the sprite bounding box (tight
    // around the bird disc), so a pure translate has no slack — the intended
    // gesture is corner-resize outward before a regenerate.
    const seHandle = firstCard.locator('.padding-handle.handle-se').first();
    const seBounds = await seHandle.boundingBox();
    if (!seBounds) throw new Error('Missing padding se resize handle');
    await page.mouse.move(seBounds.x + seBounds.width / 2, seBounds.y + seBounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(seBounds.x + seBounds.width / 2 + 80, seBounds.y + seBounds.height / 2 + 80);
    await page.mouse.up();
    if (Number(await paddingRight.inputValue()) <= paddingRightBefore) {
      throw new Error('Corner-dragging in Padding mode did not grow the padding box');
    }
    if (process.env.SMOKE_SHOT_DIR) {
      await page.screenshot({ path: process.env.SMOKE_SHOT_DIR + '/panel-padding-mode.png' });
    }
    // Translation slack exists only where the grown box exceeds the disc:
    // after the se-grow, moving LEFT keeps the disc contained; assert the
    // translate preserves the grown size.
    const grownLeft = Number(await paddingLeft.inputValue());
    const grownWidth = Number(await paddingRight.inputValue()) - grownLeft;
    const grownHeight = Number(await paddingBottom.inputValue()) - Number(await paddingTop.inputValue());
    await controls.getByRole('button', { name: 'Move left', exact: true }).click();
    if (Number(await paddingLeft.inputValue()) >= grownLeft) {
      throw new Error('Move left did not translate the padding box');
    }
    const paddingWidthAfter = Number(await paddingRight.inputValue()) - Number(await paddingLeft.inputValue());
    const paddingHeightAfter = Number(await paddingBottom.inputValue()) - Number(await paddingTop.inputValue());
    if (paddingWidthAfter !== grownWidth || paddingHeightAfter !== grownHeight) {
      throw new Error(`Translating the padding box resized it: ${JSON.stringify({ grownWidth, paddingWidthAfter, grownHeight, paddingHeightAfter })}`);
    }
    if (overlayRequests !== overlayRequestsBeforePaddingDrag) {
      throw new Error('Padding drag should update client-side without requesting a new overlay');
    }
    await firstCard.getByRole('tab', { name: 'Sprite' }).click();
    await controls.getByRole('button', { name: 'Flip X', exact: true }).click();
    const southeastHandle = firstCard.locator('[data-resize-handle="se"]');
    await southeastHandle.waitFor();
    await southeastHandle.scrollIntoViewIfNeeded();
    const handleBounds = await southeastHandle.boundingBox();
    if (!handleBounds) throw new Error('Sprite southeast resize handle was not rendered');
    await page.mouse.move(handleBounds.x + handleBounds.width / 2, handleBounds.y + handleBounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBounds.x + handleBounds.width / 2 + 24, handleBounds.y + handleBounds.height / 2 + 18, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(3000);
    await page.waitForFunction(() => document.querySelector('.cutout-review-result')?.textContent?.includes('placement saved'));
    if (!submittedPlacement || submittedPlacement[0] <= 60 || submittedPlacement[2] <= 120 || submittedPlacement[2] - submittedPlacement[0] > 100) {
      throw new Error(`Manual placement was not submitted: ${JSON.stringify(submittedPlacement)}`);
    }
    if (submittedFlipX !== true || submittedFlipY !== false) {
      throw new Error(`Delayed drag autosave overwrote flip metadata: ${JSON.stringify({ submittedFlipX, submittedFlipY })}`);
    }
    if (submittedPlacement[2] - submittedPlacement[0] <= 60 || submittedPlacement[3] - submittedPlacement[1] <= 50) {
      throw new Error(`Dragging the sprite resize handle did not scale the placement box: ${JSON.stringify(submittedPlacement)}`);
    }
    if (submittedPlacementRevisions.length < 2 || submittedPlacementRevisions[1] !== 'revision-2') {
      throw new Error(`Consecutive placement saves reused a stale revision: ${JSON.stringify(submittedPlacementRevisions)}`);
    }
    if (await controls.getByRole('button', { name: 'Flip X', exact: true }).getAttribute('aria-pressed') !== 'true') {
      throw new Error('Flip X did not remain selected after delayed autosave');
    }
    if ((candidateRequests.get(sessionId) ?? 0) !== candidateRequestsBeforePlacement) {
      throw new Error(`Placement autosave refreshed every cutout: ${JSON.stringify(Object.fromEntries(candidateRequests))}`);
    }
    if (await page.getByLabel('Show only selected').count() !== 0 ||
        await page.getByRole('button', { name: /selected \(/i }).count() !== 0) {
      throw new Error('Batch selection UI is still present');
    }
    if (await firstCard.getByRole('button', { name: 'Extract', exact: true }).count() !== 1 ||
        await firstCard.getByRole('button', { name: 'Regenerate', exact: true }).count() !== 1) {
      throw new Error('Per-cutout Extract and Regenerate actions are missing');
    }
    await page.screenshot({ path: process.env.SMOKE_SHOT_DIR ? process.env.SMOKE_SHOT_DIR + '/ftb-cutout-inline-actions.png' : '/tmp/ftb-cutout-inline-actions.png', fullPage: true });
    await page.getByText('Extraction prompt', { exact: true }).click();
    await page.getByText(/Extract and faithfully duplicate exactly ONE/).waitFor();
    const dogOneCard = page.locator('.cutout-review-card').nth(1);
    await dogOneCard.getByRole('tab', { name: 'Padding' }).click();
    await dogOneCard.getByLabel('dog #1 · sprite 000 padding left').fill('100');
    await firstCard.getByRole('tab', { name: 'Padding' }).click();
    await firstCard.getByLabel('dog #0 · sprite 000 padding left').fill('45');
    await dogOneCard.getByRole('button', { name: 'Extract', exact: true }).click();
    await dogOneCard.getByText(/extraction saved at/).waitFor();
    if (await page.locator('#last-action').innerText() !== 'none') {
      throw new Error('Cutout extraction was incorrectly applied as a painted-scene variant');
    }
    if (batchSubmissions !== 1) throw new Error(`Expected one durable batch submission, saw ${batchSubmissions}`);
    if (placementRequestCountAtBatch < 2) {
      throw new Error(`Extraction started before pending placement autosave: ${JSON.stringify({ placementRequestCountAtBatch, placementRequestCount })}`);
    }
    if (submittedDogIndices !== undefined || submittedCropBoxes !== undefined) {
      throw new Error(`Canonical extraction leaked legacy fields: ${JSON.stringify({ submittedDogIndices, submittedCropBoxes })}`);
    }
    if (JSON.stringify(submittedBirdIds) !== JSON.stringify(['bird-one'])) {
      throw new Error(`Inline action targeted the wrong bird: ${JSON.stringify(submittedBirdIds)}`);
    }
    if (submittedCropBoxesByBirdId['bird-one']?.[0] !== 100 || submittedCropBoxesByBirdId['bird-one']?.[2] < 216) {
      throw new Error(`Stable-ID padding box was not submitted: ${JSON.stringify(submittedCropBoxesByBirdId)}`);
    }
    if (submittedCutoutOnly !== true) {
      throw new Error('Cutout review submitted a scene-edit job instead of extraction-only');
    }
    if (submittedModel !== 'google/gemini-3.1-flash-image-preview') {
      throw new Error(`Cutout review ignored the selected model: ${submittedModel}`);
    }
    if (await page.locator('#observed-revision').innerText() !== 'revision-after-job') {
      throw new Error('Completed extraction did not refresh the canonical content revision');
    }
    const refreshedLabel = await page.locator('.cutout-review-card').nth(1).locator('strong').innerText();
    if (!refreshedLabel.includes('sprite 000')) {
      throw new Error(`Extracted dog did not refresh its active cutout candidate: ${refreshedLabel}`);
    }
    await firstCard.getByRole('tab', { name: 'Sprite' }).click();
    await page.screenshot({ path: process.env.SMOKE_SHOT_DIR ? process.env.SMOKE_SHOT_DIR + '/pcdNQRrf-cutout-review-panel.png' : '/tmp/pcdNQRrf-cutout-review-panel.png', fullPage: true });
    await page.locator('#switch-session').click();
    await page.waitForSelector('.cutout-review-card');
    await page.waitForTimeout(100);
    if ((candidateRequests.get(secondSessionId) ?? 0) !== 1 || (promptRequests.get(secondSessionId) ?? 0) !== 1) {
      throw new Error(`Session switch duplicated cutout metadata requests: ${JSON.stringify({ candidates: Object.fromEntries(candidateRequests), prompts: Object.fromEntries(promptRequests) })}`);
    }
  } catch (error) {
    console.error(error);
    throw error;
  } finally {
    if (browser) await browser.close();
    vite.kill('SIGTERM');
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
