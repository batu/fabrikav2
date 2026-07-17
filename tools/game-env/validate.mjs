#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  runDryRun,
  SUPPORTED_MODES,
  validateEnvironment,
  validateTemplate,
} from './src/validate.mjs';
import { getGamePolicy } from './src/policies.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const GAME_NAME = /^[a-z0-9_]+$/;
const VALUE_FLAGS = new Map([
  ['--game', 'game'],
  ['--mode', 'mode'],
]);
const BOOLEAN_FLAGS = new Map([
  ['--dry-run', 'dryRun'],
  ['--warn', 'warn'],
  ['--json', 'json'],
  ['--help', 'help'],
]);

function usageError(message) {
  const error = new Error(message);
  error.exitCode = 2;
  throw error;
}

function parseArgs(argv) {
  const args = { dryRun: false, warn: false, json: false, help: false };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!VALUE_FLAGS.has(flag) && !BOOLEAN_FLAGS.has(flag)) usageError(`unknown flag: ${flag}`);
    if (seen.has(flag)) usageError(`repeated flag: ${flag}`);
    seen.add(flag);
    if (VALUE_FLAGS.has(flag)) {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) usageError(`${flag} requires a value`);
      args[VALUE_FLAGS.get(flag)] = value;
      index += 1;
    } else {
      args[BOOLEAN_FLAGS.get(flag)] = true;
    }
  }
  if (args.dryRun && args.warn) usageError('--dry-run and --warn cannot be combined');
  return args;
}

function inferGameFromCwd() {
  const relative = path.relative(path.join(REPO_ROOT, 'games'), process.cwd());
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  const [game] = relative.split(path.sep);
  return game || null;
}

function resolveGameRoot(game) {
  if (!GAME_NAME.test(game)) usageError('--game must use lowercase letters, digits, or underscores');
  const gameRoot = path.join(REPO_ROOT, 'games', game);
  if (!fs.existsSync(gameRoot)) usageError(`unknown game: ${game}`);
  return gameRoot;
}

function safeResult(result) {
  return {
    ok: result.ok,
    mode: result.mode,
    missingKeys: result.missingKeys,
    invalidKeys: result.invalidKeys,
    emptyOverrideKeys: result.emptyOverrideKeys,
  };
}

function printValidation(result, game, { json, warn }) {
  if (json) {
    process.stdout.write(`${JSON.stringify({ ...safeResult(result), advisory: warn })}\n`);
    return;
  }
  if (result.ok) {
    process.stdout.write(`game-env: ${result.mode} environment is valid for games/${game}.\n`);
    return;
  }
  const label = warn ? 'WARNING' : 'ERROR';
  process.stderr.write(`game-env: ${label} — ${result.mode} environment validation failed.\n`);
  if (result.missingKeys.length) {
    process.stderr.write(`  Missing required keys: ${result.missingKeys.join(', ')}\n`);
  }
  if (result.invalidKeys.length) {
    process.stderr.write(`  Missing or invalid intent keys: ${result.invalidKeys.join(', ')}\n`);
  }
  if (result.emptyOverrideKeys.length) {
    process.stderr.write(`  Empty overrides: ${result.emptyOverrideKeys.join(', ')}\n`);
  }
  process.stderr.write(`  Fix games/${game}/.env.${result.mode}.local; values are never printed.\n`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write('Usage: node tools/game-env/validate.mjs [--game <name>] --mode <ios|android> [--dry-run|--warn] [--json]\n');
    return 0;
  }
  if (!SUPPORTED_MODES.includes(args.mode)) usageError('--mode must be ios or android');
  const game = args.game ?? inferGameFromCwd();
  if (!game) usageError('--game is required outside a games/<name> working directory');
  const gameRoot = resolveGameRoot(game);
  const policy = getGamePolicy(game);

  const template = validateTemplate(path.join(gameRoot, '.env.example'), policy);
  if (!template.ok) throw new Error(`games/${game}/.env.example does not match the canonical 57-key contract`);

  if (args.dryRun) {
    const result = runDryRun({ mode: args.mode, policy });
    if (args.json) process.stdout.write(`${JSON.stringify(result)}\n`);
    else {
      process.stdout.write(`game-env: ${args.mode} dry-run PASS — ${result.assertions.join('; ')}.\n`);
      process.stdout.write('game-env: no local or ambient release configuration was read or validated.\n');
    }
    return 0;
  }

  const result = validateEnvironment({ gameRoot, mode: args.mode, policy });
  printValidation(result, game, args);
  return result.ok || args.warn ? 0 : 1;
}

try {
  process.exit(main());
} catch (error) {
  const exitCode = error && error.exitCode === 2 ? 2 : 1;
  const message = exitCode === 2
    ? error.message
    : 'validation could not complete; check the game env files and template';
  process.stderr.write(`game-env: ${exitCode === 2 ? 'USAGE' : 'ERROR'} — ${message}\n`);
  process.exit(exitCode);
}
