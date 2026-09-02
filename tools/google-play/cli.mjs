#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyCrashlyticsGradle, copyOverlay, inspectBundleManifest, materializeFirebaseConfig, normalizeSha256, resolveReleaseIdentity, validateGeneratedAndroidProject, validateRecipe } from './src/release.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((part) => part.split('=', 2)));
const command = process.argv[2]?.includes('=') ? null : process.argv[2];
const game = args['--game'] ?? process.argv.find((part) => part.startsWith('--game='))?.split('=')[1];
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const games = {
  find_the_dog: { packageId: 'com.basegamelab.findthedog' },
  find_the_bird: { packageId: 'com.basegamelab.findthebird' },
};

try {
  if (!command || !games[game]) throw new Error('usage: cli.mjs <apply|validate-source|validate|inspect-aab> --game=<find_the_dog|find_the_bird> [--aab=path]');
  const expected = resolveReleaseIdentity(process.env, games[game]);
  const gameDir = path.join(root, 'games', game);
  const androidDir = path.join(gameDir, 'android');
  const overlay = path.join(gameDir, 'native-resources', 'android');
  if (command === 'apply') {
    if (!fs.existsSync(androidDir)) throw new Error(`generated Android project is absent; run npm run android:add -w @fabrikav2/${game}`);
    copyOverlay(path.join(overlay, 'app'), path.join(androidDir, 'app'));
    const appGradle = path.join(androidDir, 'app', 'build.gradle');
    const applyLine = "apply from: 'find-game-providers.gradle'";
    const gradle = fs.readFileSync(appGradle, 'utf8');
    if (!gradle.includes(applyLine)) fs.appendFileSync(appGradle, `\n${applyLine}\n`);
    const firebase = process.env.FIREBASE_ANDROID_CONFIG_PATH;
    if (firebase) materializeFirebaseConfig(firebase, path.join(androidDir, 'app', 'google-services.json'), expected.packageId);
    if (process.env.VITE_FIREBASE_CRASHLYTICS_ENABLED === 'true') applyCrashlyticsGradle(androidDir);
    console.log(`Applied ${game} Android overlay`);
  } else if (command === 'validate-source' || command === 'validate') {
    const inspectedRoot = command === 'validate-source' ? overlay : path.join(androidDir, 'app');
    const files = new Set(fs.existsSync(inspectedRoot) ? fs.readdirSync(inspectedRoot, { recursive: true }).map(String) : []);
    const sourceIssues = [];
    if (command === 'validate-source' && process.env.FIREBASE_ANDROID_CONFIG_PATH) {
      try {
        materializeFirebaseConfig(process.env.FIREBASE_ANDROID_CONFIG_PATH, process.env.FIREBASE_ANDROID_CONFIG_PATH, expected.packageId);
        files.add('google-services.json');
      } catch (error) {
        sourceIssues.push(error.message);
      }
    }
    const issues = validateRecipe({ ...expected, env: process.env, files });
    issues.push(...sourceIssues);
    const capacitor = fs.readFileSync(path.join(gameDir, 'capacitor.config.ts'), 'utf8');
    if (!capacitor.includes(`appId: "${expected.packageId}"`)) issues.push(`Capacitor appId must equal ${expected.packageId}`);
    if (command === 'validate') {
      issues.push(...validateGeneratedAndroidProject({
        androidDir,
        packageId: expected.packageId,
        crashlyticsEnabled: process.env.VITE_FIREBASE_CRASHLYTICS_ENABLED === 'true',
      }));
    }
    if (command === 'validate' && process.env.VITE_FIREBASE_CRASHLYTICS_ENABLED === 'true') {
      const firebaseFile = path.join(androidDir, 'app', 'google-services.json');
      try { materializeFirebaseConfig(firebaseFile, firebaseFile, expected.packageId); } catch (error) { issues.push(error.message); }
    }
    if (issues.length) throw new Error(issues.join('\n'));
    console.log(command === 'validate-source'
      ? `Validated ${game} Android source recipe`
      : `Validated ${game} generated Android project`);
  } else if (command === 'inspect-aab') {
    const aab = args['--aab'] ?? process.argv.find((part) => part.startsWith('--aab='))?.split('=')[1];
    const bundletool = process.env.BUNDLETOOL_JAR;
    if (!aab || !bundletool) throw new Error('inspect-aab requires --aab=<exact path> and BUNDLETOOL_JAR');
    execFileSync('jarsigner', ['-verify', '-strict', aab], { stdio: 'pipe' });
    const expectedCert = normalizeSha256(process.env.PLAY_UPLOAD_CERT_SHA256);
    const certificate = execFileSync('keytool', ['-printcert', '-jarfile', aab], { encoding: 'utf8' });
    const actualCert = normalizeSha256(/SHA256:\s*([A-Fa-f0-9:]+)/.exec(certificate)?.[1]);
    if (actualCert !== expectedCert) throw new Error('AAB signer SHA-256 does not match PLAY_UPLOAD_CERT_SHA256');
    const xml = execFileSync('java', ['-jar', bundletool, 'dump', 'manifest', '--bundle', aab], { encoding: 'utf8' });
    inspectBundleManifest(xml, expected);
    console.log(`Inspected exact signed AAB: ${path.resolve(aab)}`);
  } else throw new Error(`unknown command: ${command}`);
} catch (error) {
  console.error(`google-play ${command ?? 'command'} failed: ${error.message}`);
  process.exitCode = 1;
}
