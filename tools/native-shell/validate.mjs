#!/usr/bin/env node
import { parseArgs } from './src/cli.mjs';
import { validateGeneratedShell } from './src/native-shell.mjs';

try {
  const options = parseArgs(process.argv.slice(2));
  const result = validateGeneratedShell(options);
  if (result.issues.length) throw new Error(result.issues.join('\n- '));
  const generated = result.generatedPresent ? 'generated project validated' : 'generated project absent; committed recipe validated';
  console.log(`Validated native shell for ${options.game}: ${generated}; ${result.skAdNetworkCount} SKAdNetwork IDs; Firebase plist ${options.allowMissingFirebase ? 'may be absent' : 'required'}`);
} catch (error) {
  console.error(`native-shell validation failed: ${error.message.startsWith('- ') ? '' : '- '}${error.message}`);
  process.exitCode = 1;
}
