#!/usr/bin/env node
// Conductor-facing hard landing gate (card GG0XXzgA).
//
// Runs project quality, merge visual-evidence enforcement, and optionally the
// landed-before-cleanup guard as direct child processes. No shell pipeline is
// involved, so each child exit code is honored.
//
//   npm run land-gate
//   npm run land-gate -- --branch trello-<shortid>-<slug>
//   npm run land-gate -- --shortid <shortid> --onto HEAD
//
// Set LAND_GATE_PROJECT_DIR to gate another checkout. If --branch/--shortid is
// omitted, the landed-gate step is skipped because it cannot be inferred safely.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLandGateArgs, runLandGate } from './src/land-gate.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

try {
  const args = parseLandGateArgs(process.argv.slice(2));
  const projectDir = process.env.LAND_GATE_PROJECT_DIR || process.cwd();
  const result = runLandGate({ projectDir, scriptDir: __dirname, args });
  process.exit(result.ok ? 0 : result.code || 1);
} catch (err) {
  process.stderr.write(`land-gate: ERROR — ${err && err.message}\n`);
  process.exit(1);
}
