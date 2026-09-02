#!/usr/bin/env node
import fs from 'node:fs';

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
  if (command === 'ios-release') {
    const { executeIosRelease } = await import('./src/ios-release.mjs');
    output(executeIosRelease(request, request.dependencies));
  } else {
    const { buildReleaseManifest, readReleaseIdentity } = await import('./src/manifest.mjs');
    output(command === 'identity' ? readReleaseIdentity(request) : buildReleaseManifest(request));
  }
} catch (error) {
  output({ ok: false, error: command === 'ios-release' ? 'iOS release execution failed'
    : command === 'identity' ? 'release identity validation failed' : 'release manifest validation failed' });
  process.exitCode = 1;
}
