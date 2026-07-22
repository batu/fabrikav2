// Inject the Apple signing team into the generated iOS project.
//
// The generated `ios/` tree is a build artifact and is never committed (see
// native-resources/README.md); this committed script re-applies the one signing
// edit v1 sugar3d made by hand — `DEVELOPMENT_TEAM = 42L77JAX72;` after every
// `CODE_SIGN_STYLE = Automatic;` in project.pbxproj — so a fresh `cap add ios`
// produces a signable project deterministically. Idempotent: a second run over
// an already-injected file is a byte-for-byte no-op.
//
// The team id is an Xcode build-setting constant, not a secret — it is already
// committed in v1's pbxproj, the pixelsmith README, and the find_the_dog/sugar3d
// recipes. verify-device passes the same id as an xcodebuild setting; this
// pbxproj edit additionally covers plain-Xcode and Pixelsmith builds that do not
// go through verify-device.

/* global process */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const DEVELOPMENT_TEAM = '42L77JAX72';
export const DEFAULT_PBXPROJ_PATH = 'ios/App/App.xcodeproj/project.pbxproj';

/**
 * Insert `DEVELOPMENT_TEAM = <team>;` immediately after every
 * `CODE_SIGN_STYLE = Automatic;` line that is not already followed by a
 * DEVELOPMENT_TEAM line, matching the leading indentation of the sign-style
 * line. Pure and idempotent.
 *
 * @param {string} source raw project.pbxproj contents
 * @param {string} team Apple development team id
 * @returns {{ text: string, occurrences: number, injected: number }}
 */
export function injectDevelopmentTeam(source, team = DEVELOPMENT_TEAM) {
  let occurrences = 0;
  let injected = 0;
  const lines = source.split('\n');
  const out = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    out.push(line);
    const match = /^([ \t]*)CODE_SIGN_STYLE = Automatic;[ \t]*$/.exec(line);
    if (match === null) continue;
    occurrences += 1;
    const indent = match[1];
    const next = lines[i + 1] ?? '';
    if (/^[ \t]*DEVELOPMENT_TEAM = /.test(next)) continue;
    out.push(`${indent}DEVELOPMENT_TEAM = ${team};`);
    injected += 1;
  }

  return { text: out.join('\n'), occurrences, injected };
}

function main(argv) {
  const path = argv[2] ?? DEFAULT_PBXPROJ_PATH;
  let source;
  try {
    source = readFileSync(path, 'utf8');
  } catch (err) {
    console.error(`[ios-inject-team] cannot read ${path}: ${err.message}`);
    console.error('[ios-inject-team] run `npx cap add ios` (or `cap sync ios`) first.');
    process.exit(1);
    return;
  }

  const { text, occurrences, injected } = injectDevelopmentTeam(source, DEVELOPMENT_TEAM);
  if (occurrences === 0) {
    console.error(`[ios-inject-team] no "CODE_SIGN_STYLE = Automatic;" found in ${path}`);
    console.error('[ios-inject-team] the generated project looks wrong; aborting.');
    process.exit(1);
    return;
  }

  if (injected === 0) {
    console.info(`[ios-inject-team] ${path}: all ${occurrences} target(s) already carry DEVELOPMENT_TEAM; no change.`);
    return;
  }

  writeFileSync(path, text);
  console.info(`[ios-inject-team] ${path}: injected DEVELOPMENT_TEAM=${DEVELOPMENT_TEAM} into ${injected} of ${occurrences} target(s).`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv);
}
