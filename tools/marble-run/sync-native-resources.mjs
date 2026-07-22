// Overlay the committed native-resources onto the generated native projects.
//
// The generated `ios/` and `android/` trees are build artifacts and are never
// committed (see native-resources/README.md). `npx cap add/sync` scaffolds them
// with Capacitor's PLACEHOLDER app icon and does NOT copy the ported Marble Run
// icon/splash overlays — so the installed app shipped a placeholder icon
// (MRV2-20 item 7). This committed, idempotent script re-applies the overlay
// after every add/sync so a fresh checkout always produces the branded app:
//
//   iOS:     native-resources/ios/App/App/Assets.xcassets/** -> ios/App/App/Assets.xcassets/**
//   Android: native-resources/android-res/app/src/main/res/** -> android/app/src/main/res/**
//
// Idempotent: a byte-identical target is skipped, so re-runs are no-ops. Runs
// after `ios-inject-team.mjs` in the npm `*:sync` / `*:add` scripts.

/* global process */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Overlay source tree -> generated project subtree, per platform. Paths are
 *  relative to the marble_run game directory (cwd of the npm scripts). */
export const OVERLAYS = {
  ios: {
    from: 'native-resources/ios/App/App/Assets.xcassets',
    to: 'ios/App/App/Assets.xcassets',
    generatedRoot: 'ios',
  },
  android: {
    from: 'native-resources/android-res/app/src/main/res',
    to: 'android/app/src/main/res',
    generatedRoot: 'android',
  },
};

function walkFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

/**
 * Copy every file under `fromDir` into `toDir`, preserving relative layout.
 * Skips byte-identical targets. Returns the list of changed relative paths.
 * Pure w.r.t. inputs; the only side effects are the file writes it reports.
 *
 * @param {string} fromDir overlay source directory (must exist)
 * @param {string} toDir generated target directory
 * @returns {string[]} relative paths written (empty when already in sync)
 */
export function copyOverlay(fromDir, toDir) {
  const changed = [];
  for (const source of walkFiles(fromDir)) {
    const relative = path.relative(fromDir, source);
    const target = path.join(toDir, relative);
    const content = readFileSync(source);
    const current = existsSync(target) ? readFileSync(target) : null;
    if (current?.equals(content)) continue;
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
    changed.push(relative.split(path.sep).join('/'));
  }
  return changed;
}

function main(argv) {
  const platform = argv[2];
  const overlay = OVERLAYS[platform];
  if (!overlay) {
    console.error(`[sync-native-resources] usage: sync-native-resources.mjs <ios|android>`);
    process.exit(1);
    return;
  }
  if (!existsSync(overlay.from) || !statSync(overlay.from).isDirectory()) {
    console.error(`[sync-native-resources] overlay source missing: ${overlay.from}`);
    process.exit(1);
    return;
  }
  if (!existsSync(overlay.generatedRoot)) {
    console.error(`[sync-native-resources] generated ${platform} project not found (${overlay.generatedRoot}/).`);
    console.error(`[sync-native-resources] run \`npx cap add ${platform}\` (or \`cap sync ${platform}\`) first.`);
    process.exit(1);
    return;
  }
  const changed = copyOverlay(overlay.from, overlay.to);
  if (changed.length === 0) {
    console.info(`[sync-native-resources] ${platform}: overlay already in sync (${overlay.to}); no change.`);
    return;
  }
  console.info(`[sync-native-resources] ${platform}: overlaid ${changed.length} file(s) into ${overlay.to}:`);
  for (const rel of changed) console.info(`  ${rel}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv);
}
