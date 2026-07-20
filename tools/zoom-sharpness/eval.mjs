#!/usr/bin/env node
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { decodePng, encodePng } from '../refcap-compare/src/png.mjs';
import { MAX_ZOOM, MS_SSIM_WEIGHTS, SEED, cropImage, hashBytes, median, resampleLanczos, rounded, scorePair, scrollForCenter, selectPoses, sourceCropForCapture, worstDecile } from './lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const gameRoot = path.join(root, 'games/find_the_dog');
const levelsRoot = path.join(gameRoot, 'public/levels');
const DEFAULT_LEVELS = [
  'mexico_oaxaca_market_dog_53f5', 'alpine_meadow_snowmelt_creek_bridges_dog_89a8',
  'playground_park_picnic_play_lawn_dog_4b41', 'circus_fairground_acrobat_props_yard_dog_718c',
  'nordic_cold_icelandic_geothermal_town_dog_04a4', 'japan_festival_grounds_dog_3f7c',
  'uk_cotswolds_village_dog_b486', 'hawaii_luau_sunset_courtyard_dog_fbf2',
  'spaceship_habitat_starship_common_room_dog_8e43', 'italy_venice_canal_morning_dog_d570',
  'playground_park_treehouse_rope_play_dog_88c7', 'spaceship_habitat_asteroid_research_nook_dog_8c9d',
  'france_provence_lavender_village_dog_cbbe', 'hawaii_hidden_easy_phone', 'france_alsace_wine_village_dog_f12c',
];
const args = process.argv.slice(2);
const smoke = args.includes('--smoke');
const outIndex = args.indexOf('--out');
const output = path.resolve(outIndex >= 0 ? args[outIndex + 1] : path.join(root, 'tools/zoom-sharpness/baseline'));
const levelIds = smoke ? [DEFAULT_LEVELS[0], DEFAULT_LEVELS[1]] : DEFAULT_LEVELS;
const viewport = { width: 390, height: 844 };

async function run(command, commandArgs, options = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { cwd: root, stdio: 'inherit', ...options });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)));
  });
}

async function makeManifest(distDir) {
  const levels = [];
  for (const id of levelIds) {
    const levelPath = path.join(levelsRoot, id, 'level.json');
    const level = JSON.parse(await fs.readFile(levelPath, 'utf8'));
    const asset = async (relativePath) => {
      const bytes = await fs.readFile(path.join(gameRoot, 'public', relativePath));
      return { hash: hashBytes(bytes), size: bytes.length, path: relativePath };
    };
    const levelDir = path.join(levelsRoot, id);
    const bgNames = (await fs.readdir(levelDir)).filter((name) => /^bg_\d+\.webp$/.test(name)).sort();
    const dogSprites = [];
    for (const dogDir of (await fs.readdir(path.join(levelDir, 'dogs'), { withFileTypes: true }).catch(() => [])).filter((entry) => entry.isDirectory())) {
      for (const sprite of (await fs.readdir(path.join(levelDir, 'dogs', dogDir.name))).filter((name) => name.endsWith('.png')).sort()) {
        dogSprites.push(await asset(`levels/${id}/dogs/${dogDir.name}/${sprite}`));
      }
    }
    levels.push({ id, name: level.name ?? id, width: level.width, height: level.height, cohort_buckets: ['all'], bundled: true, assets: { levelJson: await asset(`levels/${id}/level.json`), colorImage: await asset(`levels/${id}/color.webp`), bgImages: await Promise.all(bgNames.map((name) => asset(`levels/${id}/${name}`))), dogSprites } });
  }
  await fs.writeFile(path.join(distDir, 'levels/bundled-manifest.json'), JSON.stringify({ version: 1, generatedAt: 'zoom-eval', manifestRevision: 'zoom-eval', experimentId: 'zoom-eval', levels }));
}

async function serve(directory) {
  const server = http.createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
      const filename = path.resolve(directory, relative);
      if (!filename.startsWith(`${path.resolve(directory)}${path.sep}`)) throw new Error('bad path');
      const bytes = await fs.readFile(filename);
      response.writeHead(200, { 'content-type': filename.endsWith('.html') ? 'text/html' : filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.json') ? 'application/json' : filename.endsWith('.png') ? 'image/png' : filename.endsWith('.webp') ? 'image/webp' : 'application/octet-stream' });
      response.end(bytes);
    } catch { response.writeHead(404); response.end('not found'); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

function dataUrlPng(value) {
  return decodePng(Buffer.from(value.slice(value.indexOf(',') + 1), 'base64'));
}

function escapeHtml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function reportHtml(report) {
  const cards = report.perLevel.flatMap((level) => level.poses.flatMap((pose) => pose.captures.map((capture) => `<article><h3>${escapeHtml(level.levelId)} · ${pose.name} · ${capture.zoomLabel}</h3><p>score ${capture.score.composite}</p><div class="pair"><figure><img src="${capture.candidate}"><figcaption>candidate</figcaption></figure><figure><img src="${capture.reference}"><figcaption>reference</figcaption></figure></div><details><summary>1:1 view</summary><div class="actual"><img src="${capture.candidate}"><img src="${capture.reference}"></div></details></article>`)).join(''));
  return `<!doctype html><meta charset="utf-8"><title>Zoom fidelity baseline</title><style>body{font:14px system-ui;margin:24px;background:#17191d;color:#eee}a{color:#8cf}nav{position:sticky;top:0;background:#17191dee;padding:12px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}.pair img{width:100%;height:360px;object-fit:contain;background:#000}.actual{display:flex;gap:12px;overflow:auto}.actual img{max-width:none}article{border-top:1px solid #555;padding:20px 0}figure{margin:0}code{color:#fea}</style><h1>Max-zoom fidelity fast-tier baseline</h1><p>Headline max-zoom median: <code>${report.median.maxZoom}</code>; worst decile: <code>${report.worstDecile.maxZoom}</code>; zoom-1 guard: <code>${report.median.zoom1}</code>.</p><p>Chromium fast-tier only; this is not device verification.</p><nav>${report.perLevel.map((level) => `<a href="#${escapeHtml(level.levelId)}">${escapeHtml(level.levelId)}</a>`).join(' · ')}</nav>${cards}`;
}

async function main() {
  if (!smoke && levelIds.length < 15) throw new Error('baseline requires at least 15 levels');
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'zoom-eval-'));
  const dist = path.join(temp, 'dist');
  let browser; let server;
  try {
    await run('npm', ['exec', 'vite', '--', 'build', '--mode', 'zoom-eval', '--outDir', dist, '--emptyOutDir'], { cwd: gameRoot, env: { ...process.env, VITE_ENABLE_TEST_HARNESS: 'true', VITE_CDN_ORIGIN: '' } });
    await makeManifest(dist);
    const hosted = await serve(dist); server = hosted.server;
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport, deviceScaleFactor: 3 });
    page.on('console', (message) => { if (message.type() === 'error') console.error(`[page] ${message.text()}`); });
    page.on('pageerror', (error) => console.error(`[page] ${error}`));
    await page.goto(hosted.url, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => typeof window.__zoomEval === 'function', null, { timeout: 30_000 });
    // Classic mode + no tutorial: restoration mode re-lays-out the scene as its
    // reveal progresses (timing-dependent imgScale) and the tutorial draws a
    // hint ring over the scene — both contaminate deterministic captures.
    await page.evaluate(() => window.__FIND_DOG_HARNESS__.setSettings({ gameMode: 'classic', tutorialEnabled: false }));
    await fs.rm(output, { recursive: true, force: true });
    await fs.mkdir(path.join(output, 'pairs'), { recursive: true });
    const perLevel = [];
    for (const levelId of levelIds) {
      const level = JSON.parse(await fs.readFile(path.join(levelsRoot, levelId, 'level.json'), 'utf8'));
      const sourceBytes = await fs.readFile(path.join(levelsRoot, levelId, 'color.png'));
      const source = decodePng(sourceBytes);
      const initial = await page.evaluate(async (id) => window.__zoomEval({ levelId: id, zoom: 1, scrollX: 0, scrollY: 0 }), levelId);
      const cropSize = { width: initial.canvasWidth / (initial.imgScale * MAX_ZOOM), height: initial.canvasHeight / (initial.imgScale * MAX_ZOOM) };
      const poses = selectPoses(level, source, cropSize);
      const levelResult = { levelId, aspectClass: level.width >= 1.5 * level.height ? 'wide-landscape' : 'portrait', poses: [] };
      for (const pose of poses) {
        const poseResult = { name: pose.name, center: { x: rounded(pose.centerX), y: rounded(pose.centerY) }, captures: [] };
        for (const [zoomLabel, zoom] of [['maxZoom', MAX_ZOOM], ['zoom1', 1]]) {
          const scroll = scrollForCenter(pose, initial, zoom);
          const capture = await page.evaluate(async (request) => window.__zoomEval(request), { levelId, zoom, ...scroll });
          const canvas = dataUrlPng(capture.pngDataUrl);
          const mapped = sourceCropForCapture(capture);
          const candidate = cropImage(canvas, mapped.canvas);
          const reference = resampleLanczos(source, mapped.source, candidate.width, candidate.height);
          const stem = `${levelId}--${pose.name}--${zoomLabel}`;
          const candidateRelative = `pairs/${stem}--candidate.png`; const referenceRelative = `pairs/${stem}--reference.png`;
          const candidateBytes = encodePng(candidate.width, candidate.height, candidate.data); const referenceBytes = encodePng(reference.width, reference.height, reference.data);
          await fs.writeFile(path.join(output, candidateRelative), candidateBytes); await fs.writeFile(path.join(output, referenceRelative), referenceBytes);
          const score = Object.fromEntries(Object.entries(scorePair(candidate, reference)).map(([key, value]) => [key, rounded(value)]));
          poseResult.captures.push({ zoomLabel, zoom, candidate: candidateRelative, reference: referenceRelative, candidateHash: hashBytes(candidateBytes), referenceHash: hashBytes(referenceBytes), dimensions: { width: candidate.width, height: candidate.height }, crop: Object.fromEntries(Object.entries(mapped.source).map(([key, value]) => [key, rounded(value)])), score });
        }
        levelResult.poses.push(poseResult);
      }
      levelResult.maxZoom = rounded(levelResult.poses.reduce((sum, pose) => sum + pose.captures[0].score.composite, 0) / 3);
      levelResult.zoom1 = rounded(levelResult.poses.reduce((sum, pose) => sum + pose.captures[1].score.composite, 0) / 3);
      perLevel.push(levelResult);
      console.log(`${levelId}: max=${levelResult.maxZoom} zoom1=${levelResult.zoom1}`);
    }
    const revision = await new Promise((resolve, reject) => {
      const child = spawn('git', ['rev-parse', 'HEAD'], { cwd: root }); let out = '';
      child.stdout.on('data', (value) => { out += value; });
      child.once('exit', (code) => code === 0 ? resolve(out.trim()) : reject(new Error('git revision failed')));
    });
    const report = { metadata: { tier: 'chromium-fast-tier-not-device', levels: levelIds, viewport, deviceScaleFactor: 3, maxZoom: MAX_ZOOM, seed: SEED, revision, evaluatorHash: crypto.createHash('sha256').update(await fs.readFile(fileURLToPath(import.meta.url))).update(await fs.readFile(new URL('./lib.mjs', import.meta.url))).digest('hex'), metrics: { formula: '100 * (0.5 * MS-SSIM + 0.3 * capped edge-energy ratio + 0.2 * PSNR band)', msSsimWeights: MS_SSIM_WEIGHTS, psnrBandDb: [20, 40], lanczosLobes: 3 }, availableAspectClasses: [...new Set(perLevel.map((level) => level.aspectClass))] }, perLevel, median: { maxZoom: rounded(median(perLevel.map((level) => level.maxZoom))), zoom1: rounded(median(perLevel.map((level) => level.zoom1))) }, worstDecile: { maxZoom: rounded(worstDecile(perLevel.map((level) => level.maxZoom))), zoom1: rounded(worstDecile(perLevel.map((level) => level.zoom1))) } };
    await fs.writeFile(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    await fs.writeFile(path.join(output, 'index.html'), reportHtml(report));
    console.log(`wrote ${output}`);
  } finally {
    await browser?.close(); if (server) await new Promise((resolve) => server.close(resolve)); await fs.rm(temp, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
