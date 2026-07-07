import fs from 'node:fs';
import path from 'node:path';
import { decodePng, encodePng } from '../../refcap-compare/src/png.mjs';

export function resolveContentInsetTop({ args = {}, manifest = {} } = {}) {
  if (args.contentInsetTop !== undefined) return normalizeContentInsetTop(args.contentInsetTop, '--content-inset-top');
  const configured = manifest.verifyDevice?.contentInsetTop;
  return configured === undefined ? 0 : normalizeContentInsetTop(configured, 'verifyDevice.contentInsetTop');
}

export function resolveJudgedContentInsetTop({ args = {}, manifest = {}, lane = 'device' } = {}) {
  if (lane === 'browser' && args.contentInsetTop === undefined) return 0;
  return resolveContentInsetTop({ args, manifest });
}

export function normalizeContentInsetTop(value, label = 'content inset top') {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`${label} must be a non-negative integer pixel value, got: ${value}`);
  }
  return n;
}

export function cropPngTop(buffer, topPx) {
  const inset = normalizeContentInsetTop(topPx);
  const img = decodePng(buffer);
  if (inset === 0) {
    return { buffer, width: img.width, height: img.height, cropped: false };
  }
  if (inset >= img.height) {
    throw new Error(`content inset top ${inset}px must be smaller than image height ${img.height}px`);
  }
  const nextHeight = img.height - inset;
  const rowBytes = img.width * 4;
  const data = new Uint8Array(rowBytes * nextHeight);
  data.set(img.data.subarray(rowBytes * inset));
  return {
    buffer: encodePng(img.width, nextHeight, data),
    width: img.width,
    height: nextHeight,
    cropped: true,
  };
}

export function prepareJudgedCaptures({ captures, outDir, contentInsetTop }) {
  const inset = normalizeContentInsetTop(contentInsetTop);
  const rawDir = path.join(outDir, 'raw-captures');
  const judgedDir = path.join(outDir, 'judged-captures');
  fs.rmSync(rawDir, { recursive: true, force: true });
  fs.rmSync(judgedDir, { recursive: true, force: true });
  fs.mkdirSync(rawDir, { recursive: true });
  fs.mkdirSync(judgedDir, { recursive: true });

  const rawCaptures = {};
  const judgedCaptures = {};
  for (const [state, source] of Object.entries(captures || {})) {
    if (!source || !fs.existsSync(source)) continue;
    const rawPath = path.join(rawDir, `${state}.png`);
    const judgedPath = path.join(judgedDir, `${state}.png`);
    const buffer = fs.readFileSync(source);
    fs.writeFileSync(rawPath, buffer);
    const judged = inset === 0 ? buffer : cropPngTop(buffer, inset).buffer;
    fs.writeFileSync(judgedPath, judged);
    rawCaptures[state] = rawPath;
    judgedCaptures[state] = judgedPath;
  }

  return {
    rawCaptures,
    judgedCaptures,
    artifacts: {
      contentInsetTop: inset,
      rawDir,
      judgedDir,
      cropped: inset > 0,
    },
  };
}
