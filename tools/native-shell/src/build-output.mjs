import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Scratch lanes rebuild many times a day. Compiling into the attempt directory made every
 * run a full clean build and left ~3 GB that Agency must then retain for its seven-day
 * minimum, so the lane outgrew the disk. Scratch builds instead reuse a DerivedData cache
 * keyed by checkout and lane -- concurrent worktrees share the lane name but not the cache --
 * which restores incremental compilation and leaves only metadata in the retained attempt.
 * Release output stays inside the attempt so durable signed artifacts remain self-contained.
 */
function scratchDerivedDataPath(repoRoot, lane) {
  const checkout = crypto.createHash('sha256').update(repoRoot).digest('hex').slice(0, 16);
  return path.join(os.homedir(), 'Library', 'Caches', 'fabrikav2-native-shell', checkout, lane, 'DerivedData');
}

/** Shared build/artifact resolver. Agency owns allocation, locking and retention. */
export function runIosBuild({ gameDir, configuration, args, run = execFileSync }) {
  const repoRoot = path.resolve(gameDir, '../..');
  const lane = `${path.basename(gameDir)}-ios-${configuration.toLowerCase()}`;
  const durable = configuration === 'Release';
  const derivedDataArgument = durable
    ? '{agency-output}/DerivedData'
    : scratchDerivedDataPath(repoRoot, lane);
  const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'native-output-result-')));
  const resultFile = path.join(temporary, 'result.json');
  try {
    const stdout = run('agency', [
      'workspace', 'run-output', '--repo', repoRoot,
      '--lane', lane,
      '--kind', durable ? 'durable' : 'scratch',
      '--result-file', resultFile, '--', 'xcodebuild', ...args,
      '-derivedDataPath', derivedDataArgument,
    ]);
    const { output_dir: outputDir } = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
    if (!path.isAbsolute(outputDir)) throw new Error('Agency returned a non-absolute output directory');
    const derived = durable ? path.join(outputDir, 'DerivedData') : derivedDataArgument;
    return {
      stdout,
      derived,
      appPath: path.join(derived, 'Build', 'Products', `${configuration}-iphoneos`, 'App.app'),
    };
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
