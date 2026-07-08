#!/usr/bin/env node
import { configureLockfileMergeDriver } from './src/lockfile-merge-driver.mjs';

try {
  configureLockfileMergeDriver();
} catch (err) {
  process.stderr.write(`setup-lockfile-merge-driver: ERROR: ${err && err.message}\n`);
  process.exit(1);
}
