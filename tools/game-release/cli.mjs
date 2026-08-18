#!/usr/bin/env node
import fs from 'node:fs';

import { buildReleaseManifest } from './src/manifest.mjs';
import { executeIosRelease } from './src/ios-release.mjs';

function output(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

let command = 'manifest';
try {
  if (process.argv.length !== 2) throw new Error('arguments are not accepted; pass one JSON object on stdin');
  const raw = fs.readFileSync(0, 'utf8');
  const request = JSON.parse(raw);
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('request must be an object');
  command = request.command || 'manifest';
  if (request.platform !== 'ios') throw new Error('platform must be ios');
  output(command === 'ios-release'
    ? executeIosRelease(request, request.dependencies)
    : buildReleaseManifest(request));
} catch (error) {
  output({ ok: false, error: command === 'ios-release' ? 'iOS release execution failed' : 'release manifest validation failed' });
  process.exitCode = 1;
}
