import fs from 'node:fs';
import path from 'node:path';
import { requireTool, runFile } from './ffmpeg.mjs';
import { formatTimestamp } from './time.mjs';

const HUMAN_FLAGGED_NOT_AT_REST_REASON = 'human-flagged mid-motion';

function sanitizeLabel(label) {
  const safe = String(label || 'other')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return safe || 'other';
}

function loadFrames(verdictFile) {
  const data = JSON.parse(fs.readFileSync(path.resolve(verdictFile), 'utf8'));
  const frames = Array.isArray(data.frames) ? data.frames : data.payload?.frames;
  if (!Array.isArray(frames)) {
    throw new Error('verdict must contain frames or payload.frames');
  }
  return frames;
}

function todayStamp() {
  return new Date().toISOString().slice(0, 10);
}

function hasOwn(object, key) {
  return Object.hasOwn(object, key);
}

function frameAtRestValue(frame) {
  if (hasOwn(frame, 'at-rest')) return frame['at-rest'];
  if (hasOwn(frame, 'atRest')) return frame.atRest;
  return undefined;
}

function frameTextValue(frame, kebabKey, camelKey) {
  const value = hasOwn(frame, kebabKey) ? frame[kebabKey] : frame[camelKey];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function atRestFields(frame) {
  const value = frameAtRestValue(frame);
  if (value === true) return { 'at-rest': true };

  const explicitFalse = value === false;
  if (value !== undefined && !explicitFalse) {
    throw new Error(`invalid at-rest value for frame at ${frame.t}: expected boolean`);
  }

  return {
    'at-rest': false,
    'not-at-rest-reason': frameTextValue(frame, 'not-at-rest-reason', 'notAtRestReason') ||
      (explicitFalse ? HUMAN_FLAGGED_NOT_AT_REST_REASON : 'unjudged video frame'),
    'recapture-note': frameTextValue(frame, 'recapture-note', 'recaptureNote') ||
      'review this extracted video frame before accepting it as an at-rest reference',
  };
}

function uniquePngPath(outDir, label, t) {
  const stem = `${sanitizeLabel(label)}-${formatTimestamp(t)}`;
  let candidate = path.join(outDir, `${stem}.png`);
  let suffix = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(outDir, `${stem}-${suffix}.png`);
    suffix++;
  }
  return candidate;
}

export function extractFrames({ video, verdictFile, outDir, captured = todayStamp() }) {
  requireTool('ffmpeg');
  if (!video) throw new Error('--video is required');
  if (!verdictFile) throw new Error('--verdict is required');
  if (!outDir) throw new Error('--out is required');
  if (typeof captured !== 'string' || captured.trim() === '') {
    throw new Error('--captured must be a non-empty date string');
  }

  const absVideo = path.resolve(video);
  if (!fs.existsSync(absVideo)) throw new Error(`video not found: ${absVideo}`);
  const absOut = path.resolve(outDir);
  fs.mkdirSync(absOut, { recursive: true });

  const frames = loadFrames(verdictFile);
  const extracted = [];
  for (const frame of frames) {
    const t = Number(frame.t);
    if (!Number.isFinite(t) || t < 0) throw new Error(`invalid frame timestamp: ${frame.t}`);
    const label = frame.label || frame.state || 'other';
    const outPath = uniquePngPath(absOut, label, t);
    runFile('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-ss',
      formatTimestamp(t),
      '-i',
      absVideo,
      '-frames:v',
      '1',
      outPath,
    ]);
    extracted.push({
      state: label,
      t: Number(formatTimestamp(t)),
      file: path.basename(outPath),
      source: frame.source || 'agent',
      provenance: {
        source: 'video-extract',
        tool: 'video-refs extract',
        captured: captured.trim(),
        video,
      },
      ...atRestFields(frame),
    });
  }

  const manifestFile = path.join(absOut, 'extracted.json');
  fs.writeFileSync(manifestFile, `${JSON.stringify(extracted, null, 2)}\n`);
  return { frames: extracted, manifestFile };
}
