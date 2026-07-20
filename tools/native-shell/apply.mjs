#!/usr/bin/env node
import { applyNativeShell } from './src/native-shell.mjs';
import { parseArgs } from './src/cli.mjs';

try {
  const options = parseArgs(process.argv.slice(2));
  const result = applyNativeShell(options);
  console.log(`Applied native shell for ${options.game}: ${result.changed.length ? result.changed.join(', ') : 'no changes'} (${result.skAdNetworkCount} SKAdNetwork IDs; Firebase plist ${result.googleServicePresent ? 'wired' : 'absent/allowed'})`);
} catch (error) {
  console.error(`native-shell apply failed: ${error.message}`);
  process.exitCode = 1;
}
