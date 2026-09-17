import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCRATCH_CACHES_KEPT = 3;
const SCRATCH_IDLE_MS = 24 * 60 * 60 * 1000;

/** Overridable so a test run prunes a temporary root instead of real multi-GB build caches. */
function scratchCacheRoot() {
  return process.env.FABRIKAV2_NATIVE_SHELL_CACHE_ROOT
    || path.join(os.homedir(), 'Library', 'Caches', 'fabrikav2-native-shell');
}

/**
 * Scratch lanes rebuild many times a day. Compiling into the attempt directory made every
 * run a full clean build and left ~3 GB that Agency must then retain for its seven-day
 * minimum, so the lane outgrew the disk. Scratch builds instead reuse a DerivedData cache
 * keyed by checkout and lane -- concurrent worktrees share the lane name but not the cache --
 * which restores incremental compilation and leaves only metadata in the retained attempt.
 * Release output stays inside the attempt so durable signed artifacts remain self-contained.
 * The checkout is resolved first so two spellings of one source tree cannot claim two caches.
 */
function scratchDerivedDataPath(repoRoot, lane) {
  const checkout = crypto.createHash('sha256').update(repoRoot).digest('hex').slice(0, 16);
  return path.join(scratchCacheRoot(), checkout, lane, 'DerivedData');
}

/**
 * One cache per checkout means a lane grows with the number of worktrees, so keep only the
 * three most recently built per lane. Every lane is swept, not just the one being built,
 * because a lane that is never built again would otherwise keep its caches forever -- the
 * gap Agency's seven-day retention used to cover. A cache outside the top three is removed
 * only once it has been idle for a day, because Agency serialises managed builds per
 * checkout but not across them and a fourth worktree may still be compiling. Each candidate
 * is isolated so one unreadable entry cannot abort the sweep, and pruning never fails a
 * build that already succeeded.
 */
function pruneScratchCaches(keep) {
  const root = scratchCacheRoot();
  let checkouts;
  try {
    checkouts = fs.readdirSync(root);
  } catch {
    return;
  }
  const lanes = new Map();
  for (const checkout of checkouts) {
    const checkoutDir = path.join(root, checkout);
    let names;
    try {
      names = fs.readdirSync(checkoutDir);
    } catch {
      continue;
    }
    for (const lane of names) {
      const derived = path.join(checkoutDir, lane, 'DerivedData');
      try {
        const { mtimeMs } = fs.statSync(derived);
        if (!lanes.has(lane)) lanes.set(lane, []);
        lanes.get(lane).push({ derived, usedAt: mtimeMs });
      } catch {
        // Removed under us by a concurrent build, or not a lane directory.
      }
    }
  }
  const now = Date.now();
  for (const caches of lanes.values()) {
    const keptHere = caches.some((cache) => cache.derived === keep) ? SCRATCH_CACHES_KEPT - 1 : SCRATCH_CACHES_KEPT;
    const prunable = caches.filter((cache) => cache.derived !== keep).sort((a, b) => b.usedAt - a.usedAt);
    for (const { derived, usedAt } of prunable.slice(keptHere)) {
      if (now - usedAt < SCRATCH_IDLE_MS) continue;
      try {
        fs.rmSync(path.dirname(derived), { recursive: true, force: true });
      } catch {
        // Reclaimed by the next build rather than by failing this one.
      }
    }
  }
  for (const checkout of checkouts) {
    try {
      fs.rmdirSync(path.join(root, checkout));
    } catch {
      // Still holds a lane, or is already gone.
    }
  }
}

/** Shared build/artifact resolver. Agency owns allocation, locking and retention. */
export function runIosBuild({ gameDir, configuration, args, run = execFileSync }) {
  const declaredRoot = path.resolve(gameDir, '../..');
  let repoRoot;
  try {
    repoRoot = fs.realpathSync(declaredRoot);
  } catch {
    repoRoot = declaredRoot;
  }
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
    const appPath = path.join(derived, 'Build', 'Products', `${configuration}-iphoneos`, 'App.app');
    if (!durable) {
      // A reused cache keeps the product path alive between runs, so a build that reports
      // success while producing nothing here would otherwise hand back the previous App.app.
      // Existence is the honest check: an incremental no-op build legitimately leaves the
      // bundle's timestamp untouched, so mtime cannot distinguish fresh from stale.
      if (!fs.existsSync(appPath)) {
        throw new Error(`Build reported success but produced no App.app at ${appPath}`);
      }
      const used = new Date();
      try {
        fs.utimesSync(derived, used, used);
      } catch {
        // Retention falls back to whatever timestamp the build left.
      }
      pruneScratchCaches(derived);
    }
    return { stdout, derived, appPath };
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
