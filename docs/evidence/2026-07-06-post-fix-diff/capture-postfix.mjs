// Post-fix re-verify capture (card MR6uIsba).
//
// Drives the LANDED v2 harness (window.__MARBLE_RUN_HARNESS__.driveTo) through
// every canonical state, and — the whole point of this card — enforces a
// CAPTURE-INTEGRITY gate before every screenshot: driveTo() must resolve true
// AND the live snapshot() must satisfy the state's expected scene/flag. This is
// what kills the B5/N1 "menu screenshot mislabeled as level/pause" bug: a shot
// is only saved when the game is provably IN that state.
//
// v2 lane  = vite dev (harness enabled by default in dev mode) + Playwright
//            Chromium at 390x844 (the manifest v2 viewport). Browser capture —
//            WKWebView-family — sufficient for asset/color/layout fidelity.
// ref lane = committed OFFLINE Android refs (refs/captures/android-basegamelab/).
//
// Then it pairs each v2 capture with its Android reference and emits grid.html
// via refcap-compare's own grid module (resolution-independent perceptual diff).
//
// Output: docs/evidence/2026-07-06-post-fix-diff/ ONLY. Touches no game/tool src.

import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng } from '../../../tools/refcap-compare/src/png.mjs';
import { signature, digest } from '../../../tools/refcap-compare/src/phash.mjs';
import { diffThumbnail } from '../../../tools/refcap-compare/src/diff.mjs';
import { buildGridHtml } from '../../../tools/refcap-compare/src/grid.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const REF_DIR = path.join(REPO, 'games/marble_run/refs/captures/android-basegamelab');
const SHOTS = path.join(HERE, 'shots');
const WINDOW_KEY = '__MARBLE_RUN_HARNESS__';
const BASE_URL = 'http://localhost:5210/';
const VIEWPORT = { width: 390, height: 844 };
const SETTLE_MS = 700; // let the rotating board / animated bg settle

fs.mkdirSync(SHOTS, { recursive: true });

// state -> { ref file (null = documented gap), expected snapshot predicate }.
// driveTo's own confirm gate uses these scene names (see src/testing/driveTo.ts):
// menu->scene 'menu'; level->scene 'playing'; settings->settingsOpen flag (modal
// over menu, no distinct scene); pause->'paused'; win->'complete'; fail->'failed'.
const STATES = [
  { name: 'menu',     ref: 'menu.png',        expect: (s) => s.scene === 'menu',            expectDesc: "scene==='menu'" },
  { name: 'level',    ref: 'level-start.png', expect: (s) => s.scene === 'playing',          expectDesc: "scene==='playing'" },
  { name: 'settings', ref: 'settings.png',    expect: (s) => s.settingsOpen === true,        expectDesc: 'settingsOpen===true (modal over menu)' },
  { name: 'pause',    ref: null,              expect: (s) => s.scene === 'paused',           expectDesc: "scene==='paused'", refGap: 'no reference pause capture exists (refs README) — documented gap' },
  { name: 'win',      ref: 'win-ref.png',     expect: (s) => s.scene === 'complete',         expectDesc: "scene==='complete'" },
  { name: 'fail',     ref: 'fail-ref.png',    expect: (s) => s.scene === 'failed',           expectDesc: "scene==='failed'" },
];

function refCell(name, refFile, refGap) {
  if (!refFile) return { gap: refGap || `no reference — documented gap`, lane: 'reference' };
  const abs = path.join(REF_DIR, refFile);
  const buffer = fs.readFileSync(abs);
  const img = decodePng(buffer);
  return {
    lane: 'reference', state: name, gap: null,
    source: `refs/captures/android-basegamelab/${refFile}`,
    alt: `${name} reference (android)`,
    base64: buffer.toString('base64'),
    img,
    sig: digest(signature(img)),
    package: 'com.basegamelab.marblerun',
    version: 'android-basegamelab',
    resolution: `${img.width}x${img.height}`,
  };
}

function v2Cell(name, pngBuffer, snap) {
  const img = decodePng(pngBuffer);
  return {
    lane: 'v2', state: name, gap: null,
    source: `shots/${name}.png`,
    alt: `${name} v2 (harness/chromium)`,
    base64: pngBuffer.toString('base64'),
    img,
    sig: digest(signature(img)),
    package: 'com.fabrikav2.marble_run',
    version: `dev · scene=${snap.scene}${snap.settingsOpen ? ' · settingsOpen' : ''}`,
    resolution: `${img.width}x${img.height}`,
  };
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 2 });

const integrity = [];
const rows = [];

async function freshLoad() {
  // Reload before every state so each capture starts from a pristine cold boot —
  // no cross-state DOM leak (e.g. a still-mounted settings modal from a prior
  // driveTo). This makes the capture-integrity gate airtight: the ONLY thing on
  // screen is the state we drove to and confirmed.
  await page.goto(BASE_URL, { waitUntil: 'load' });
  await page.waitForFunction(
    (key) => typeof window[key]?.driveTo === 'function' && typeof window[key]?.snapshot === 'function',
    WINDOW_KEY,
    { timeout: 20000 },
  );
}

for (const st of STATES) {
  await freshLoad();
  // Drive + CONFIRM. driveTo resolves true only after its OWN snapshot() poll
  // confirms arrival; we then re-read snapshot() and assert our expected scene.
  const reached = await page.evaluate(async (args) => {
    const h = window[args.key];
    const ok = await h.driveTo(args.name);
    return { ok, snap: h.snapshot() };
  }, { key: WINDOW_KEY, name: st.name });

  const snap = reached.snap;
  const sceneOk = st.expect(snap);
  const pass = reached.ok === true && sceneOk;
  integrity.push({
    state: st.name,
    driveToReturned: reached.ok,
    expected: st.expectDesc,
    actualScene: snap.scene,
    settingsOpen: !!snap.settingsOpen,
    inputReady: !!snap.inputReady,
    integrityPass: pass,
  });
  if (!pass) {
    console.error(`[integrity] FAIL ${st.name}: driveTo=${reached.ok} expected ${st.expectDesc} got scene='${snap.scene}' settingsOpen=${!!snap.settingsOpen}`);
    throw new Error(`capture-integrity gate failed for state "${st.name}" — refusing to save a mislabeled shot (B5/N1).`);
  }

  await page.waitForTimeout(SETTLE_MS);
  const pngBuffer = await page.screenshot();
  fs.writeFileSync(path.join(SHOTS, `${st.name}.png`), pngBuffer);
  console.log(`[capture] ${st.name}: OK (scene='${snap.scene}'${snap.settingsOpen ? ', settingsOpen' : ''}) -> shots/${st.name}.png`);

  const reference = refCell(st.name, st.ref, st.refGap);
  const v2 = v2Cell(st.name, pngBuffer, snap);
  let diff = null;
  if (!reference.gap) {
    const d = diffThumbnail(reference.img, v2.img);
    diff = { base64: d.png.toString('base64'), changedFraction: d.changedFraction, meanDelta: d.meanDelta };
  }
  const strip = (c) => { const { img: _i, ...r } = c; return r; };
  rows.push({ state: st.name, reference: strip(reference), v2: strip(v2), diff });
}

await browser.close();

// Grid HTML via the tool's own module (fixed timestamp — no Date.now in-band).
const html = buildGridHtml({
  game: 'marble_run',
  generatedAt: '2026-07-06 (post-fix re-verify, card MR6uIsba)',
  mode: 'v2 harness driveTo (capture-integrity gated) vs offline android refs',
  rows,
});
fs.writeFileSync(path.join(HERE, 'grid.html'), html, 'utf8');
fs.writeFileSync(path.join(HERE, 'integrity.json'), JSON.stringify({
  method: 'v2 = vite-dev harness driveTo(state) @390x844 Chromium; every shot gated on driveTo()===true && expected snapshot scene/flag. ref = committed android-basegamelab PNGs.',
  captured: integrity,
}, null, 2), 'utf8');

console.log('\n[integrity summary]');
for (const r of integrity) console.log(`  ${r.integrityPass ? 'PASS' : 'FAIL'}  ${r.state.padEnd(9)} scene='${r.actualScene}'${r.settingsOpen ? ' settingsOpen' : ''}`);
console.log(`\nWrote grid.html + integrity.json + shots/ to ${HERE}`);
