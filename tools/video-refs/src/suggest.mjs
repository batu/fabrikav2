import fs from 'node:fs';
import path from 'node:path';
import { requireTool, runFile } from './ffmpeg.mjs';
import { isDuplicate, signature } from './phash.mjs';
import { formatTimestamp, selectFrameRate, snapToFrameMidpoint } from './time.mjs';

const SOURCE_PRIORITY = {
  uniform: 0,
  scene: 1,
};

function parsePositiveNumber(value, name) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
  return value;
}

function probeVideo(video) {
  const result = runFile('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=avg_frame_rate,r_frame_rate:format=duration',
    '-of',
    'json',
    video,
  ]);
  const data = JSON.parse(result.stdout);
  const duration = Number(data.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`could not determine video duration: ${video}`);
  }
  const stream = data.streams?.[0];
  if (!stream) throw new Error(`could not determine video stream: ${video}`);
  const fps = selectFrameRate({
    avgFrameRate: stream.avg_frame_rate,
    rFrameRate: stream.r_frame_rate,
  });
  return { duration, fps };
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

function uniqueSortedRecords(records, duration) {
  const byTimestamp = new Map();
  for (const record of records) {
    const t = Number(formatTimestamp(record.t));
    if (!Number.isFinite(t) || t < 0 || t >= duration) continue;
    const key = formatTimestamp(t);
    const existing = byTimestamp.get(key);
    if (!existing || SOURCE_PRIORITY[record.source] > SOURCE_PRIORITY[existing.source]) {
      byTimestamp.set(key, { ...record, t });
    }
  }
  return [...byTimestamp.values()].sort((a, b) => a.t - b.t);
}

export function buildCandidateRecords({ duration, fps, interval, sceneCuts }) {
  const records = [
    ...uniformTimes(duration, interval).map((t) => ({
      source: 'uniform',
      rawT: t,
      t: snapToFrameMidpoint(t, fps),
    })),
    ...sceneCuts.map((t) => {
      const biasedT = t + (2 / fps);
      return {
        source: 'scene',
        rawT: t,
        biasedT,
        t: snapToFrameMidpoint(biasedT, fps),
      };
    }),
  ];
  return uniqueSortedRecords(records, duration);
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

  const { duration, fps } = probeVideo(absVideo);
  const records = buildCandidateRecords({
    duration,
    fps,
    interval: sampleInterval,
    sceneCuts: sceneTimes(absVideo, sceneThreshold),
  });

  const kept = [];
  for (const record of records) {
    const sig = frameSignature(absVideo, record.t);
    const duplicateIndex = kept.findIndex((candidate) => isDuplicate(candidate.signature, sig));
    if (duplicateIndex !== -1) {
      const duplicate = kept[duplicateIndex];
      if (record.source === 'scene' && duplicate.source !== 'scene') {
        kept[duplicateIndex] = { ...record, signature: sig };
      }
      continue;
    }
    kept.push({ ...record, signature: sig });
  }

  kept.sort((a, b) => a.t - b.t);
  for (const candidate of kept) {
    const t = candidate.t;
    const timeName = formatTimestamp(t);
    const file = `frames/cand-${timeName}.jpg`;
    extractThumb(absVideo, t, path.join(absOut, file));
    candidate.t = Number(timeName);
    candidate.file = file;
  }

  const candidates = kept.map(({
    signature: _signature,
    source: _source,
    rawT: _rawT,
    biasedT: _biasedT,
    ...candidate
  }) => candidate);
  const out = {
    video: absVideo,
    duration_s: Number(formatTimestamp(duration)),
    fps: Number(formatTimestamp(fps)),
    candidates,
  };
  const candidatesFile = path.join(absOut, 'candidates.json');
  fs.writeFileSync(candidatesFile, `${JSON.stringify(out, null, 2)}\n`);
  return { ...out, candidatesFile };
}
