#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildView } from './src/build-view.mjs';
import { extractFrames } from './src/extract.mjs';
import { suggestFrames } from './src/suggest.mjs';

const HELP = `video-refs - reference video frame tooling

Usage:
  node tools/video-refs/run.mjs suggest --video <path> --out <dir> [--interval 2] [--scene 0.3]
  node tools/video-refs/run.mjs build-view --candidates <candidates.json> --video-src <string> --out <file.html>
  node tools/video-refs/run.mjs extract --video <path> --verdict <verdict.json> --out <dir>
`;

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      flags.help = true;
    } else if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const value = argv[++i];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`missing value for --${key}`);
      }
      flags[key] = value;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return flags;
}

function requireFlag(flags, key) {
  if (!flags[key]) throw new Error(`--${key} is required`);
  return flags[key];
}

export function main(argv = process.argv.slice(2)) {
  const [verb, ...rest] = argv;
  if (!verb || verb === '--help' || verb === '-h') {
    process.stdout.write(HELP);
    return 0;
  }

  const flags = parseFlags(rest);
  if (flags.help) {
    process.stdout.write(HELP);
    return 0;
  }

  if (verb === 'suggest') {
    const result = suggestFrames({
      video: requireFlag(flags, 'video'),
      outDir: requireFlag(flags, 'out'),
      interval: flags.interval === undefined ? 2 : Number(flags.interval),
      scene: flags.scene === undefined ? 0.3 : Number(flags.scene),
    });
    process.stdout.write(
      `video-refs suggest: ${result.candidates.length} candidates -> ${result.candidatesFile}\n`
    );
    return 0;
  }

  if (verb === 'build-view') {
    const result = buildView({
      candidatesFile: requireFlag(flags, 'candidates'),
      videoSrc: requireFlag(flags, 'video-src'),
      outFile: requireFlag(flags, 'out'),
    });
    process.stdout.write(`video-refs build-view: ${result.markers.length} markers -> ${result.outFile}\n`);
    return 0;
  }

  if (verb === 'extract') {
    const result = extractFrames({
      video: requireFlag(flags, 'video'),
      verdictFile: requireFlag(flags, 'verdict'),
      outDir: requireFlag(flags, 'out'),
    });
    process.stdout.write(`video-refs extract: ${result.frames.length} frames -> ${result.manifestFile}\n`);
    return 0;
  }

  throw new Error(`unknown verb: ${verb}`);
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
  try {
    process.exit(main());
  } catch (err) {
    process.stderr.write(`video-refs: ${err.message}\n`);
    process.exit(1);
  }
}
