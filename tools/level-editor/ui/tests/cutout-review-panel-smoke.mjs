import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { chromium } from 'playwright';

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
  const vite = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['vite', '--host', '127.0.0.1', '--port', String(port)],
    { detached: process.platform !== 'win32', stdio: ['ignore', 'ignore', 'ignore'] },
  );
  let browser;
  try {
    await waitForServer();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    let completedRegens = 0;
    let batchSubmissions = 0;
    let submittedDogIndices = [];
    let submittedCropBoxes = {};
    let submittedCutoutOnly = false;
    let submittedPlacement = null;
    let submittedFlipX = false;
    let submittedFlipY = false;
    let submittedModel = null;
    let overlayRequests = 0;
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      const isCandidateRequest =
        url.pathname === `/api/sessions/${sessionId}/sprite-candidates` ||
        url.pathname === `/api/sessions/${secondSessionId}/sprite-candidates`;
      if (isCandidateRequest) {
        await route.fulfill({
          json: {
            candidates: [
              {
                id: 'dog_00:sprite_000',
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
      if (url.pathname === `/api/sessions/${sessionId}/sprite-candidates/dog_00%3Asprite_000/placement` && route.request().method() === 'PUT') {
        const body = route.request().postDataJSON();
        submittedPlacement = body.spriteBox;
        submittedFlipX = body.flipX;
        submittedFlipY = body.flipY;
        await route.fulfill({ json: { ok: true, spriteBox: submittedPlacement } });
        return;
      }
      if (url.pathname === `/api/sessions/${sessionId}/dogs/retry-inpaint/jobs` && route.request().method() === 'POST') {
        batchSubmissions += 1;
        const body = route.request().postDataJSON();
        submittedDogIndices = body.dogIndices;
        submittedCropBoxes = body.cropBoxes;
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
      await route.continue();
    });

    await page.goto(baseUrl);
    await page.evaluate((key) => {
      window.localStorage.setItem(key, 'null');
    }, `ftd-cutout-review:${sessionId}`);
    await page.goto(`${baseUrl}/tests/cutout-review-panel-harness.html`);
    await page.waitForSelector('.cutout-review-card');
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
    await page.mouse.move(draggableBounds.x + draggableBounds.width / 2, draggableBounds.y + draggableBounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(draggableBounds.x + draggableBounds.width / 2 + 20, draggableBounds.y + draggableBounds.height / 2);
    await page.mouse.up();
    await firstCard.getByRole('tab', { name: 'Padding' }).click();
    await page.waitForTimeout(100);
    const paddingLeft = firstCard.getByLabel('dog #0 · sprite 000 padding left');
    const paddingLeftBefore = Number(await paddingLeft.inputValue());
    const overlayRequestsBeforePaddingDrag = overlayRequests;
    const paddingDragBounds = await draggableOverlay.boundingBox();
    if (!paddingDragBounds) throw new Error('Missing padding drag bounds');
    await page.mouse.move(paddingDragBounds.x + paddingDragBounds.width / 2, paddingDragBounds.y + paddingDragBounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(paddingDragBounds.x + paddingDragBounds.width / 2 + 20, paddingDragBounds.y + paddingDragBounds.height / 2);
    await page.mouse.up();
    if (Number(await paddingLeft.inputValue()) <= paddingLeftBefore) {
      throw new Error('Dragging in Padding mode did not move the padding box');
    }
    if (overlayRequests !== overlayRequestsBeforePaddingDrag) {
      throw new Error('Padding drag should update client-side without requesting a new overlay');
    }
    await firstCard.getByRole('tab', { name: 'Sprite' }).click();
    await controls.getByRole('button', { name: 'Flip X', exact: true }).click();
    await page.waitForTimeout(1200);
    await page.waitForFunction(() => document.querySelector('.cutout-review-result')?.textContent?.includes('placement saved'));
    if (!submittedPlacement || submittedPlacement[0] <= 60 || submittedPlacement[2] <= 120 || submittedPlacement[2] - submittedPlacement[0] > 100) {
      throw new Error(`Manual placement was not submitted: ${JSON.stringify(submittedPlacement)}`);
    }
    if (submittedFlipX !== true || submittedFlipY !== false) {
      throw new Error(`Delayed drag autosave overwrote flip metadata: ${JSON.stringify({ submittedFlipX, submittedFlipY })}`);
    }
    if (await controls.getByRole('button', { name: 'Flip X', exact: true }).getAttribute('aria-pressed') !== 'true') {
      throw new Error('Flip X did not remain selected after delayed autosave');
    }
    const summary = await page.locator('.cutout-review-summary').innerText();
    if (!summary.includes('2 selected')) {
      throw new Error(`Unexpected initial summary: ${summary}`);
    }
    const selectedOnly = page.getByLabel('Show only selected');
    await selectedOnly.check();
    if (await page.locator('.cutout-review-card').count() !== 2) {
      throw new Error('Selected-only filter did not hide unselected cutouts');
    }
    if (!await page.getByRole('button', { name: 'Extract selected (2)' }).isEnabled()) {
      throw new Error('Selected-only filter changed the extraction target set');
    }
    await selectedOnly.uncheck();
    if (await page.locator('.cutout-review-card').count() !== 3) {
      throw new Error('Disabling selected-only filter did not restore all cutouts');
    }
    const firstOverlay = page.getByRole('button', { name: 'Select dog #0 · sprite 000 for cutout action' });
    if (await firstOverlay.getAttribute('aria-pressed') !== 'false') {
      throw new Error('Clean overlay unexpectedly started selected.');
    }
    await firstOverlay.click();
    await page.getByRole('button', { name: 'Extract selected (3)' }).waitFor();
    const selectedOverlays = await page.locator('.cutout-review-overlay[aria-pressed="true"]').count();
    if (selectedOverlays !== 3) throw new Error(`Expected three independently selected overlays, saw ${selectedOverlays}`);
    await page.getByRole('button', { name: 'Remove dog #0 · sprite 000 from cutout action' }).click();
    await page.getByRole('button', { name: 'Extract selected (2)' }).waitFor();
    await page.getByRole('button', { name: 'Regenerate selected (2)' }).waitFor();
    await page.getByText('Extraction prompt', { exact: true }).click();
    await page.getByText(/Extract and faithfully duplicate exactly ONE/).waitFor();
    const dogOneCard = page.locator('.cutout-review-card').nth(1);
    await dogOneCard.getByRole('tab', { name: 'Padding' }).click();
    await dogOneCard.getByLabel('dog #1 · sprite 000 padding left').fill('100');
    await page.getByText('Extract selected (2)').click();
    await page.getByText('1/2 extractions finished').waitFor();
    if (await page.locator('#last-action').innerText() !== 'none') {
      throw new Error('Cutout extraction was incorrectly applied as a painted-scene variant');
    }
    if (batchSubmissions !== 1) throw new Error(`Expected one durable batch submission, saw ${batchSubmissions}`);
    if (JSON.stringify(submittedDogIndices) !== JSON.stringify([1, 2])) {
      throw new Error(`Batch did not target the selected dog indices: ${JSON.stringify(submittedDogIndices)}`);
    }
    if (submittedCropBoxes['1']?.[0] !== 100) {
      throw new Error(`Adjusted padding box was not submitted: ${JSON.stringify(submittedCropBoxes)}`);
    }
    if (submittedCutoutOnly !== true) {
      throw new Error('Cutout review submitted a scene-edit job instead of extraction-only');
    }
    if (submittedModel !== 'google/gemini-3.1-flash-image-preview') {
      throw new Error(`Cutout review ignored the selected model: ${submittedModel}`);
    }
    await page.getByText('one failed').waitFor();
    const refreshedLabel = await page.locator('.cutout-review-card').nth(1).locator('strong').innerText();
    if (!refreshedLabel.includes('sprite 000')) {
      throw new Error(`Extracted dog did not refresh its active cutout candidate: ${refreshedLabel}`);
    }
    await page.screenshot({ path: '/tmp/pcdNQRrf-cutout-review-panel.png', fullPage: true });
    await page.locator('#switch-session').click();
    await page.waitForSelector('.cutout-review-summary');
  } finally {
    if (browser) await browser.close();
    if (process.platform === 'win32') {
      vite.kill('SIGTERM');
    } else if (vite.pid) {
      try {
        process.kill(-vite.pid, 'SIGTERM');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
