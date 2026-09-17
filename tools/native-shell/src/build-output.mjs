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
const SCRATCH_CACHE_ROOT = path.join(os.homedir(), 'Library', 'Caches', 'fabrikav2-native-shell');
const SCRATCH_CACHES_KEPT = 3;
const SCRATCH_IDLE_MS = 24 * 60 * 60 * 1000;

function scratchDerivedDataPath(repoRoot, lane) {
  const checkout = crypto.createHash('sha256').update(repoRoot).digest('hex').slice(0, 16);
  return path.join(SCRATCH_CACHE_ROOT, checkout, lane, 'DerivedData');
}

/**
 * One cache per checkout means a lane grows with the number of worktrees, so keep only the
 * three most recently built. A cache outside that set is removed only once it has been idle
 * for a day, because Agency serialises managed builds per checkout but not across them and a
 * fourth worktree may still be compiling. Pruning never fails a build that already succeeded.
 */
function pruneScratchCaches(lane, keep) {
  try {
    const caches = fs.readdirSync(SCRATCH_CACHE_ROOT)
      .map((checkout) => path.join(SCRATCH_CACHE_ROOT, checkout, lane, 'DerivedData'))
      .filter((candidate) => candidate !== keep && fs.existsSync(candidate))
      .map((candidate) => ({ candidate, usedAt: fs.statSync(candidate).mtimeMs }))
      .sort((a, b) => b.usedAt - a.usedAt);
    const now = Date.now();
    for (const { candidate, usedAt } of caches.slice(SCRATCH_CACHES_KEPT - 1)) {
      if (now - usedAt < SCRATCH_IDLE_MS) continue;
      fs.rmSync(path.dirname(candidate), { recursive: true, force: true });
    }
  } catch {
    // A cache we could not read or remove is reclaimed by the next build, never by failing this one.
  }
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
    if (!durable) pruneScratchCaches(lane, derived);
    return {
      stdout,
      derived,
      appPath: path.join(derived, 'Build', 'Products', `${configuration}-iphoneos`, 'App.app'),
    };
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
