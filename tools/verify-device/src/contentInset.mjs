import fs from 'node:fs';
import path from 'node:path';
import { decodePng, encodePng } from '../../refcap-compare/src/png.mjs';

export function resolveContentInsetTop({ args = {}, manifest = {} } = {}) {
  return resolveContentInsets({ args, manifest }).top;
}

export function resolveContentInsets({ args = {}, manifest = {}, platform = 'ios' } = {}) {
  const vd = manifest.verifyDevice || {};
  return {
    top: resolveOneInset({
      argsValue: args.contentInsetTop,
      cliLabel: '--content-inset-top',
      manifestValue: platformValue(vd, platform, 'ContentInsetTop', 'contentInsetTop'),
      manifestLabel: platformLabel(vd, platform, 'ContentInsetTop', 'contentInsetTop'),
    }),
    bottom: resolveOneInset({
      argsValue: args.contentInsetBottom,
      cliLabel: '--content-inset-bottom',
      manifestValue: platformValue(vd, platform, 'ContentInsetBottom', 'contentInsetBottom'),
      manifestLabel: platformLabel(vd, platform, 'ContentInsetBottom', 'contentInsetBottom'),
    }),
  };
}

export function resolveJudgedContentInsetTop({ args = {}, manifest = {}, lane = 'device' } = {}) {
  return resolveJudgedContentInsets({ args, manifest, lane }).top;
}

export function resolveJudgedContentInsets({ args = {}, manifest = {}, lane = 'device', platform = 'ios' } = {}) {
  if (lane === 'browser' && args.contentInsetTop === undefined && args.contentInsetBottom === undefined) {
    return { top: 0, bottom: 0 };
  }
  return resolveContentInsets({ args, manifest, platform });
}

function resolveOneInset({ argsValue, cliLabel, manifestValue, manifestLabel }) {
  if (argsValue !== undefined) return normalizeContentInsetTop(argsValue, cliLabel);
  return manifestValue === undefined ? 0 : normalizeContentInsetTop(manifestValue, manifestLabel);
}

function platformValue(verifyDevice, platform, suffix, fallbackKey) {
  const platformKey = platform === 'android'
    ? `android${suffix}`
    : platform === 'ios'
      ? `ios${suffix}`
      : null;
  if (platformKey && verifyDevice[platformKey] !== undefined) return verifyDevice[platformKey];
  return verifyDevice[fallbackKey];
}

function platformLabel(verifyDevice, platform, suffix, fallbackKey) {
  const platformKey = platform === 'android'
    ? `android${suffix}`
    : platform === 'ios'
      ? `ios${suffix}`
      : null;
  if (platformKey && verifyDevice[platformKey] !== undefined) return `verifyDevice.${platformKey}`;
  return `verifyDevice.${fallbackKey}`;
}

export function normalizeContentInsetTop(value, label = 'content inset top') {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`${label} must be a non-negative integer pixel value, got: ${value}`);
  }
  return n;
}

export function cropPngTop(buffer, topPx) {
  return cropPngVertical(buffer, { top: topPx, bottom: 0 });
}

export function cropPngVertical(buffer, { top = 0, bottom = 0 } = {}) {
  const topInset = normalizeContentInsetTop(top, 'content inset top');
  const bottomInset = normalizeContentInsetTop(bottom, 'content inset bottom');
  const img = decodePng(buffer);
  if (topInset === 0 && bottomInset === 0) {
    return { buffer, width: img.width, height: img.height, cropped: false };
  }
  if (topInset + bottomInset >= img.height) {
    throw new Error(
      `content insets top ${topInset}px + bottom ${bottomInset}px must be smaller than image height ${img.height}px`
    );
  }
  const nextHeight = img.height - topInset - bottomInset;
  const rowBytes = img.width * 4;
  const data = new Uint8Array(rowBytes * nextHeight);
  const start = rowBytes * topInset;
  const end = start + rowBytes * nextHeight;
  data.set(img.data.subarray(start, end));
  return {
    buffer: encodePng(img.width, nextHeight, data),
    width: img.width,
    height: nextHeight,
    cropped: true,
  };
}

export function prepareJudgedCaptures({ captures, outDir, contentInsetTop, contentInsetBottom = 0, contentInsets }) {
  const top = normalizeContentInsetTop(contentInsets?.top ?? contentInsetTop ?? 0, 'content inset top');
  const bottom = normalizeContentInsetTop(contentInsets?.bottom ?? contentInsetBottom, 'content inset bottom');
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
    const judged = top === 0 && bottom === 0 ? buffer : cropPngVertical(buffer, { top, bottom }).buffer;
    fs.writeFileSync(judgedPath, judged);
    rawCaptures[state] = rawPath;
    judgedCaptures[state] = judgedPath;
  }

  return {
    rawCaptures,
    judgedCaptures,
    artifacts: {
      contentInsetTop: top,
      contentInsetBottom: bottom,
      rawDir,
      judgedDir,
      cropped: top > 0 || bottom > 0,
    },
  };
}
