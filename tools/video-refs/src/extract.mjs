import fs from 'node:fs';
import path from 'node:path';
import { requireTool, runFile } from './ffmpeg.mjs';
import { formatTimestamp } from './time.mjs';

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

export function extractFrames({ video, verdictFile, outDir }) {
  requireTool('ffmpeg');
  if (!video) throw new Error('--video is required');
  if (!verdictFile) throw new Error('--verdict is required');
  if (!outDir) throw new Error('--out is required');

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
      provenance: `video-refs extract from ${path.basename(absVideo)}`,
      'at-rest': true,
    });
  }

  const manifestFile = path.join(absOut, 'extracted.json');
  fs.writeFileSync(manifestFile, `${JSON.stringify(extracted, null, 2)}\n`);
  return { frames: extracted, manifestFile };
}
