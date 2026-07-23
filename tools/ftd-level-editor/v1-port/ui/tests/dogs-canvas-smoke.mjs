// DogsCanvas mock-network smoke test (spec -004 Slice 1/4). Mounts DogsCanvas in
// isolation with a fake API and asserts the WIRE contract on drag / place / delete:
//   - drag dog 1 -> the saved payload moves ONLY dog 1; dog 0 and dog 2 are
//     byte-identical (id + geometry). The "move dog 7, dog 8 frozen" guarantee.
//   - double-click empty -> a NEW hitbox is placed with a client-minted stable id.
//   - double-click a dog -> DELETE /dogs/by-id/{that id} fires.
//   - the strip labels each dog by its stable creation index ("dog N").
// No real backend / no wizard / no tunnel -> none of the live-harness gremlins.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { chromium } from 'playwright';

const port = await freePort();
const baseUrl = `http://127.0.0.1:${port}`;

const transparentPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64',
);

// The fixed session the mock GET returns. 3 dogs/hitboxes with KNOWN stable ids.
const SESSION = {
  id: 'test-session',
  orientation: 'portrait',
  style: 'pixelart',
  model: 'google/gemini-3.1-flash-image-preview',
  scenePrompt: '',
  dogPrompt: '',
  nDogs: 3,
  backgrounds: [],
  selectedBgIndex: 0,
  bgWidth: 1000,
  bgHeight: 1500,
  sections: [],
  exported: false,
  hitboxes: [
    { x: 200, y: 300, r: 50, id: 'id-0' },
    { x: 500, y: 600, r: 50, id: 'id-1' },
    { x: 800, y: 900, r: 50, id: 'id-2' },
  ],
  // NON-CONTIGUOUS dog indices (a tombstone gap: index != array position) so the
  // selection/rail/regen are forced to address by stable id, not array position
  // (review P1 #3). Hitbox at array position 2 carries id-2, whose dog.index is 4.
  dogs: [
    { index: 0, id: 'id-0', status: 'done', activeVariant: 0, promptOverride: null, variants: ['dogs/dog_00/variant_000.png'] },
    { index: 2, id: 'id-1', status: 'done', activeVariant: 0, promptOverride: null, variants: ['dogs/dog_02/variant_000.png'] },
    { index: 4, id: 'id-2', status: 'done', activeVariant: 0, promptOverride: null, variants: ['dogs/dog_04/variant_000.png'] },
  ],
};

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
        const r = await fetch(`${baseUrl}/tests/dogs-canvas-harness.html`);
        if (r.ok) return resolve();
      } catch { /* vite starting */ }
      if (Date.now() > deadline) return reject(new Error('Timed out waiting for Vite'));
      setTimeout(check, 250);
    };
    check();
  });
}

// Drive a synthetic gesture on the DogsCanvas overlay canvas in IMAGE coords
// (the harness controls bgWidth=1000, so scale = canvasWidth/1000).
async function gesture(page, kind, imgX, imgY, imgX2 = imgX, imgY2 = imgY) {
  await page.evaluate(({ kind, imgX, imgY, imgX2, imgY2 }) => {
    const c = document.querySelector('.dogs-canvas .overlay-canvas');
    if (!c) throw new Error('no DogsCanvas overlay canvas');
    const r = c.getBoundingClientRect();
    const s = r.width / 1000;
    const fire = (type, ix, iy) => c.dispatchEvent(new MouseEvent(type, {
      bubbles: true, cancelable: true, button: 0,
      clientX: r.left + ix * s, clientY: r.top + iy * s,
    }));
    if (kind === 'drag') { fire('mousedown', imgX, imgY); fire('mousemove', imgX2, imgY2); fire('mouseup', imgX2, imgY2); }
    else if (kind === 'dblclick') { fire('dblclick', imgX, imgY); }
  }, { kind, imgX, imgY, imgX2, imgY2 });
}

function assert(cond, msg) { if (!cond) throw new Error('ASSERT FAILED: ' + msg); }

async function run() {
  const vite = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['vite', '--host', '127.0.0.1', '--port', String(port)],
    { detached: process.platform !== 'win32', stdio: ['ignore', 'ignore', 'ignore'] },
  );
  const postBodies = [];
  const deleteUrls = [];
  let bgPreviewRequests = 0;
  let fullColorRequests = 0;
  let geometryRequests = 0;
  // STATEFUL mock state (final-rereview P2 #4): a DELETE removes the id from the
  // GET so a refetch can't resurrect it; a hitbox POST updates positions. The
  // static mock could not catch delete-resurrection or move-drop.
  const deletedIds = new Set();
  let latestHitboxes = null;
  const currentSession = () => ({
    ...SESSION,
    hitboxes: (latestHitboxes || SESSION.hitboxes).filter((h) => !deletedIds.has(h.id)),
    dogs: SESSION.dogs.filter((d) => !deletedIds.has(d.id)),
  });
  let browser;
  try {
    await waitForServer();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 700, height: 1100 } });

    // ── Mock the API ────────────────────────────────────────────────────────
    await page.route('**/api/sessions/test-session/hitboxes', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      postBodies.push(body);
      if (Array.isArray(body.hitboxes)) latestHitboxes = body.hitboxes;
      await route.fulfill({ status: 204, body: '' });
    });
    await page.route('**/api/sessions/test-session/dogs/by-id/**', async (route) => {
      const url = route.request().url();
      deleteUrls.push(url);
      if (route.request().method() === 'DELETE') {
        const m = url.match(/by-id\/([^/?]+)/);
        if (m) deletedIds.add(decodeURIComponent(m[1]));
      }
      await route.fulfill({ status: 204, body: '' });
    });
    await page.route('**/api/sessions/test-session/gallery-preview/**', (route) => {
      bgPreviewRequests += 1;
      return route.fulfill({ status: 200, contentType: 'image/webp', body: transparentPng });
    });
    await page.route('**/api/config/geometry', (route) => {
      geometryRequests += 1;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
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
        }),
      });
    });
    await page.route('**/api/sessions/test-session', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(currentSession()) }));
    await page.route('**/levels/**', (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('/color.png')) fullColorRequests += 1;
      return route.fulfill({ status: 200, contentType: 'image/png', body: transparentPng });
    });

    await page.goto(`${baseUrl}/tests/dogs-canvas-harness.html`);
    await page.getByTestId('dogs-canvas').waitFor({ timeout: 10_000 });
    assert(geometryRequests > 0, 'DogsCanvas LevelCanvas did not request server geometry config.');
    assert(bgPreviewRequests > 0, 'DogsCanvas did not request gallery-preview proxy background.');
    assert(fullColorRequests === 0, `DogsCanvas should not request full color.png; got ${fullColorRequests}`);

    // ── 1. Strip renders one cell per dog, labeled by stable creation index ──
    const labels = await page.locator('.dog-strip-label').allInnerTexts();
    assert(labels.length === 3, `expected 3 strip cells, got ${labels.length}`);
    // labels are the stable creation index dog.index (non-contiguous here) — never
    // the array position. (The 3rd dog is index 4, not 2.)
    assert(labels.join(',') === 'dog 0,dog 2,dog 4', `strip labels = ${labels.join(',')}`);

    // ── 2. Drag dog 1 (middle) -> only dog 1 changes in the saved payload ────
    await gesture(page, 'drag', 500, 600, 700, 600); // move id-1 +200px in x
    await page.waitForTimeout(700); // debounced save (400ms) + margin
    const dragSave = postBodies.at(-1);
    assert(dragSave && Array.isArray(dragSave.hitboxes), 'drag did not POST hitboxes');
    const byId = Object.fromEntries(dragSave.hitboxes.map((h) => [h.id, h]));
    assert(byId['id-0'].x === 200 && byId['id-0'].y === 300, `dog 0 moved! ${JSON.stringify(byId['id-0'])}`);
    assert(byId['id-2'].x === 800 && byId['id-2'].y === 900, `dog 2 moved! ${JSON.stringify(byId['id-2'])}`);
    assert(byId['id-1'].x === 700 && byId['id-1'].y === 600, `dog 1 not at moved pos: ${JSON.stringify(byId['id-1'])}`);

    // ── 3. Double-click empty space -> place a NEW hitbox with a minted id ────
    const beforePlace = postBodies.length;
    await gesture(page, 'dblclick', 150, 1200); // empty area (no hitbox near)
    await page.waitForTimeout(700);
    assert(postBodies.length > beforePlace, 'place did not POST');
    const placeSave = postBodies.at(-1);
    assert(placeSave.hitboxes.length === 4, `expected 4 hitboxes after place, got ${placeSave.hitboxes.length}`);
    const newHb = placeSave.hitboxes.find((h) => !['id-0', 'id-1', 'id-2'].includes(h.id));
    assert(newHb && typeof newHb.id === 'string' && newHb.id.length >= 8, `new hitbox has no minted id: ${JSON.stringify(newHb)}`);

    // ── 4. Selection targets by stable id, NOT array position (P1 #3) ─────────
    // (Run BEFORE the delete, while all 3 dogs are present.) The hitbox at array
    // position 2 carries id-2, whose dog.index is 4. Clicking it must select that
    // dog (rail shows "dog 4"); a position-keyed selection would resolve
    // dog.index===2 → id-1 and show "dog 2".
    await gesture(page, 'drag', 800, 900, 800, 900); // click-select the position-2 hitbox
    await page.waitForTimeout(300);
    const railText = await page.getByTestId('dog-rail').innerText();
    assert(/dog 4/.test(railText), `gap-select hit the wrong dog: rail="${railText.replace(/\n/g, ' ')}" (expected "dog 4")`);

    // ── 5. Delete dog 0 -> DELETE fires AND the strip drops to 2 (no resurrect) ─
    // The STATEFUL mock removes id-0 from the GET, so the post-DELETE invalidate
    // refetch must NOT restore it (final-rereview P2 #4). A static mock would snap
    // the optimistic 2-dog strip back to 3 here and this assertion would fail.
    // The gap-select's zero-distance drag armed a 400ms save timer; deleting
    // within that window exercises the delete-then-flush re-save path.
    await gesture(page, 'dblclick', 200, 300); // dog 0's center (within the 400ms window)
    await page.waitForTimeout(600); // DELETE + re-save + invalidate refetch settle
    assert(deleteUrls.some((u) => u.endsWith('/dogs/by-id/id-0')), `no DELETE for id-0: ${JSON.stringify(deleteUrls)}`);
    const afterDelete = await page.locator('.dog-strip-label').allInnerTexts();
    assert(afterDelete.length === 2, `strip did not drop to 2 after delete (resurrection?): ${afterDelete.join(',')}`);
    assert(!afterDelete.includes('dog 0'), `'dog 0' resurrected after delete: ${afterDelete.join(',')}`);
    // NON-VACUOUS check (final-rereview iter3): the delete-then-flush re-save must
    // NOT contain the deleted id — assert on the POST body, which the stateful GET
    // can't mask. A resurrecting re-save (or one keyed on a stale snapshot) fails.
    const lastSave = postBodies.filter((b) => Array.isArray(b.hitboxes)).at(-1);
    assert(
      lastSave && !lastSave.hitboxes.some((h) => h.id === 'id-0'),
      `post-delete re-save resurrected id-0: ${JSON.stringify(lastSave && lastSave.hitboxes.map((h) => h.id))}`,
    );

    console.log('dogs-canvas-smoke: PASS (render + drag-isolation + place-mints-id + gap-select-by-id + delete-no-resurrect + resave-no-id0)');
  } finally {
    if (browser) await browser.close();
    if (process.platform === 'win32') vite.kill();
    else process.kill(-vite.pid, 'SIGTERM');
  }
}

await run();
