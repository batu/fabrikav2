import fs from 'node:fs';
import path from 'node:path';
import { loadManifest } from '../../refcap-compare/src/manifest.mjs';
import { parseYaml } from '../../refcap-compare/src/yaml.mjs';
import { appendMissingStates, replaceOrInsertRefsBlock } from './manifest-text.mjs';
import { formatTimestamp } from './time.mjs';

function todayStamp() {
  return new Date().toISOString().slice(0, 10);
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function sanitizeToken(value, fallback = 'other') {
  const safe = String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const token = safe || fallback;
  return /^[a-z]/.test(token) ? token : `${fallback}-${token}`;
}

function sanitizePathSegment(value, fallback = 'video') {
  const safe = String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return safe || fallback;
}

function uniqueInOrder(values) {
  return [...new Set(values)];
}

function loadExtracted(extractedFile) {
  const data = JSON.parse(fs.readFileSync(extractedFile, 'utf8'));
  if (!Array.isArray(data)) throw new Error('extracted.json must contain an array of frame records');
  return data;
}

function legacyVideoFromProvenance(value) {
  if (typeof value !== 'string') return null;
  const match = value.match(/\bfrom\s+(.+)$/);
  return match ? match[1].trim() : null;
}

function normalizeProvenance(frame, { video, captured }) {
  const provenance = isPlainObject(frame.provenance) ? frame.provenance : {};
  const resolvedVideo = video || provenance.video || legacyVideoFromProvenance(frame.provenance);
  if (!resolvedVideo) {
    throw new Error(`frame ${frame.file || frame.t} is missing video provenance; pass --video`);
  }
  return {
    source: 'video-extract',
    tool: typeof provenance.tool === 'string' && provenance.tool.trim() !== ''
      ? provenance.tool.trim()
      : 'video-refs extract',
    captured: captured || provenance.captured || todayStamp(),
    video: resolvedVideo,
  };
}

function frameTextValue(frame, kebabKey, camelKey) {
  const value = Object.hasOwn(frame, kebabKey) ? frame[kebabKey] : frame[camelKey];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function normalizeAtRest(frame) {
  const value = Object.hasOwn(frame, 'at-rest') ? frame['at-rest'] : frame.atRest;
  if (value === true) return { 'at-rest': true };

  const explicitFalse = value === false;
  if (value !== undefined && !explicitFalse) {
    throw new Error(`invalid at-rest value for ${frame.file || frame.t}: expected boolean`);
  }

  return {
    'at-rest': false,
    'not-at-rest-reason': frameTextValue(frame, 'not-at-rest-reason', 'notAtRestReason') ||
      (explicitFalse ? 'marked not at rest by video frame review' : 'unjudged video frame'),
    'recapture-note': frameTextValue(frame, 'recapture-note', 'recaptureNote') ||
      'review this extracted video frame before accepting it as an at-rest reference',
  };
}

function variantFromFrame(frame) {
  if (typeof frame.variant === 'string' && frame.variant.trim() !== '') {
    return sanitizePathSegment(frame.variant.trim(), 'variant');
  }
  if (typeof frame.labelContext === 'string' && frame.labelContext.trim() !== '') {
    return sanitizePathSegment(frame.labelContext.trim(), 'variant');
  }
  const t = Number(frame.t);
  if (!Number.isFinite(t) || t < 0) throw new Error(`invalid frame timestamp: ${frame.t}`);
  return `t${formatTimestamp(t).replace(/\./g, '_')}`;
}

function recipeForFrame(frame, { video, extractedFile, gameDir }) {
  const relExtractedDir = toPosix(path.relative(gameDir, path.dirname(extractedFile))) || 'refs/art';
  return [
    `video-refs extract --video ${video}`,
    '--verdict <verdict.json>',
    `--out ${relExtractedDir};`,
    `timestamp ${formatTimestamp(frame.t)}`,
  ].join(' ');
}

function captureRootForVideo(gameDir, video) {
  const basename = path.basename(video, path.extname(video));
  return path.join(gameDir, 'refs', 'captures', 'video-extract', sanitizePathSegment(basename));
}

function normalizeFrame(frame, context) {
  if (!isPlainObject(frame)) throw new Error('each extracted frame must be a mapping');
  if (typeof frame.file !== 'string' || frame.file.trim() === '') {
    throw new Error('each extracted frame requires a file');
  }
  const state = sanitizeToken(frame.state || frame.label || 'other');
  const provenance = normalizeProvenance(frame, context);
  const video = context.video || provenance.video;
  const sourceFile = path.join(path.dirname(context.extractedFile), frame.file);
  if (!fs.existsSync(sourceFile)) throw new Error(`extracted frame file not found: ${sourceFile}`);
  const captureRoot = captureRootForVideo(context.gameDir, video);
  const captureFile = path.basename(frame.file);
  const captureAbs = path.join(captureRoot, captureFile);
  const captureRel = toPosix(path.relative(context.gameDir, captureAbs));
  return {
    state,
    sourceFile,
    captureAbs,
    captureRel,
    entry: {
      'state-variant': `${state}/${variantFromFrame(frame)}`,
      'capture-recipe': recipeForFrame(frame, { ...context, video }),
      ...normalizeAtRest(frame),
      provenance,
    },
  };
}

function disambiguateVariants(frames) {
  const counts = new Map();
  for (const frame of frames) {
    const variant = frame.entry['state-variant'];
    const count = counts.get(variant) || 0;
    counts.set(variant, count + 1);
    if (count > 0) frame.entry['state-variant'] = `${variant}-${count + 1}`;
  }
}

function existingStateNames(manifest) {
  if (!Array.isArray(manifest.states)) return [];
  return manifest.states
    .filter((state) => isPlainObject(state) && typeof state.name === 'string' && state.name.trim() !== '')
    .map((state) => state.name.trim());
}

export function foldExtractedFrames({
  gameDir,
  extractedFile,
  video,
  captured = todayStamp(),
} = {}) {
  if (!gameDir) throw new Error('--game is required');
  const absGameDir = path.resolve(gameDir);
  if (!extractedFile) extractedFile = path.join(absGameDir, 'refs', 'art', 'extracted.json');
  const absExtractedFile = path.resolve(extractedFile);
  if (!fs.existsSync(absExtractedFile)) throw new Error(`extracted manifest not found: ${absExtractedFile}`);
  if (typeof captured !== 'string' || captured.trim() === '') {
    throw new Error('--captured must be a non-empty date string');
  }

  const manifestFile = path.join(absGameDir, 'refs', 'manifest.yaml');
  if (!fs.existsSync(manifestFile)) throw new Error(`manifest not found: ${manifestFile}`);
  const manifestText = fs.readFileSync(manifestFile, 'utf8');
  const manifest = parseYaml(manifestText);
  const extracted = loadExtracted(absExtractedFile);
  const context = {
    gameDir: absGameDir,
    extractedFile: absExtractedFile,
    video,
    captured: captured.trim(),
  };
  const frames = extracted.map((frame) => normalizeFrame(frame, context));
  disambiguateVariants(frames);

  for (const frame of frames) {
    fs.mkdirSync(path.dirname(frame.captureAbs), { recursive: true });
    fs.copyFileSync(frame.sourceFile, frame.captureAbs);
  }

  const refs = isPlainObject(manifest.refs) ? { ...manifest.refs } : {};
  for (const frame of frames) refs[frame.captureRel] = frame.entry;

  const presentStates = new Set(existingStateNames(manifest));
  const missingStates = uniqueInOrder(frames.map((frame) => frame.state).filter((state) => !presentStates.has(state)));
  let updatedText = replaceOrInsertRefsBlock(manifestText, refs);
  updatedText = appendMissingStates(updatedText, missingStates);
  parseYaml(updatedText);
  fs.writeFileSync(manifestFile, updatedText);
  loadManifest(absGameDir);

  return {
    frames: frames.length,
    captures: frames.map((frame) => frame.captureRel).sort(),
    manifestFile,
  };
}
