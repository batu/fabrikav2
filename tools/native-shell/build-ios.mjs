#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runIosBuild } from './src/build-output.mjs';

const argv = process.argv.slice(2);
const separator = argv.indexOf('--');
if (separator !== 4 || argv[0] !== '--game' || argv[2] !== '--configuration'
  || !/^[a-z0-9_]+$/.test(argv[1]) || !['Debug', 'Release'].includes(argv[3])) {
  throw new Error('usage: build-ios.mjs --game GAME --configuration Debug|Release -- XCODE_ARGS');
}
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const built = runIosBuild({ gameDir: path.join(repo, 'games', argv[1]), configuration: argv[3], args: argv.slice(separator + 1),
  run: (file, args) => execFileSync(file, args, { stdio: ['ignore', 2, 'inherit'] }),
});
process.stdout.write(`${built.appPath}\n`);
