#!/usr/bin/env node
import { runNpmLockRegen } from './src/lockfile-merge-driver.mjs';

try {
  const [, , _ancestorPath, currentPath, _otherPath, packagePath] = process.argv;
  if (!currentPath || !packagePath) {
    throw new Error('usage: npm-lock-merge-driver.mjs %O %A %B %P');
  }
  runNpmLockRegen({ currentPath, packagePath });
} catch (err) {
  process.stderr.write(`npm-lock-regen: ERROR: ${err && err.message}\n`);
  process.exit(1);
}
