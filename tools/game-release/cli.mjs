#!/usr/bin/env node
import fs from 'node:fs';

import { buildReleaseManifest } from './src/manifest.mjs';

function output(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

try {
  if (process.argv.length !== 2) throw new Error('arguments are not accepted; pass one JSON object on stdin');
  const raw = fs.readFileSync(0, 'utf8');
  const request = JSON.parse(raw);
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('request must be an object');
  if (request.platform !== 'ios') throw new Error('platform must be ios');
  output(buildReleaseManifest(request));
} catch (error) {
  output({ ok: false, error: 'release manifest validation failed' });
  process.exitCode = 1;
}
