import fs from 'node:fs';
import path from 'node:path';
import { requireTool, runFile } from './ffmpeg.mjs';
import { isDuplicate, signature } from './phash.mjs';
import { formatTimestamp } from './time.mjs';

function parsePositiveNumber(value, name) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
  return value;
}

function probeDuration(video) {
  const result = runFile('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'json',
    video,
  ]);
  const data = JSON.parse(result.stdout);
  const duration = Number(data.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`could not determine video duration: ${video}`);
  }
  return duration;
}

function sceneTimes(video, scene) {
  const result = runFile('ffmpeg', [
    '-hide_banner',
    '-i',
    video,
    '-vf',
    `select=gt(scene\\,${scene}),showinfo`,
    '-f',
    'null',
    '-',
  ]);
  const stderr = result.stderr || '';
  return [...stderr.matchAll(/pts_time:([0-9.]+)/g)].map((match) => Number(match[1]));
}

function uniformTimes(duration, interval) {
  const times = [];
  for (let t = 0; t < duration; t += interval) {
    times.push(t);
  }
  return times.length ? times : [0];
}

function uniqueSortedTimes(times, duration) {
  const seen = new Set();
  const out = [];
  for (const raw of times) {
    const t = Number(formatTimestamp(raw));
    if (!Number.isFinite(t) || t < 0 || t >= duration) continue;
    const key = formatTimestamp(t);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out.sort((a, b) => a - b);
}

function frameSignature(video, t) {
  const result = runFile('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-ss',
    formatTimestamp(t),
    '-i',
    video,
    '-frames:v',
    '1',
    '-vf',
    'scale=32:32,format=gray',
    '-f',
    'rawvideo',
    '-',
  ], { encoding: 'buffer' });
  return signature(result.stdout);
}

function extractThumb(video, t, outFile) {
  runFile('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-ss',
    formatTimestamp(t),
    '-i',
    video,
    '-frames:v',
    '1',
    '-vf',
    'scale=480:-2',
    '-q:v',
    '3',
    outFile,
  ]);
}

export function suggestFrames({ video, outDir, interval = 2, scene = 0.3 }) {
  requireTool('ffmpeg');
  requireTool('ffprobe');
  const sampleInterval = parsePositiveNumber(interval, '--interval');
  const sceneThreshold = parsePositiveNumber(scene, '--scene');

  const absVideo = path.resolve(video);
  if (!fs.existsSync(absVideo)) throw new Error(`video not found: ${absVideo}`);
  const absOut = path.resolve(outDir);
  const framesDir = path.join(absOut, 'frames');
  fs.mkdirSync(framesDir, { recursive: true });

  const duration = probeDuration(absVideo);
  const rawTimes = uniqueSortedTimes([
    ...uniformTimes(duration, sampleInterval),
    ...sceneTimes(absVideo, sceneThreshold),
  ], duration);

  const kept = [];
  for (const t of rawTimes) {
    const sig = frameSignature(absVideo, t);
    if (kept.some((candidate) => isDuplicate(candidate.signature, sig))) continue;

    const timeName = formatTimestamp(t);
    const file = `frames/cand-${timeName}.jpg`;
    extractThumb(absVideo, t, path.join(absOut, file));
    kept.push({
      t: Number(timeName),
      file,
      signature: sig,
    });
  }

  const candidates = kept.map(({ signature: _signature, ...candidate }) => candidate);
  const out = {
    video: absVideo,
    duration_s: Number(formatTimestamp(duration)),
    candidates,
  };
  const candidatesFile = path.join(absOut, 'candidates.json');
  fs.writeFileSync(candidatesFile, `${JSON.stringify(out, null, 2)}\n`);
  return { ...out, candidatesFile };
}
