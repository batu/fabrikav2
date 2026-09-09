import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGame } from '../src/create-game.mjs';
import { validateGeneratedShell } from '../../native-shell/src/native-shell.mjs';
import { loadManifest } from '../../refcap-compare/src/manifest.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const TEMPLATE = join(REPO, 'games', 'shell_template');
const NAME = 'native_probe_2';
const APP_ID = 'com.basegamelab.nativeprobe2.dev';
// Real source inputs, including the scripts and native recipe absent from the
// original minimal shell fixture. No generated project or provider is needed.
const INPUTS = [
  'package.json', 'game.config.ts', 'capacitor.config.ts', 'index.html',
  'design/copy.ts', 'refs/manifest.yaml', 'native-resources',
];

function snapshotFiles(directory, relative = '') {
  return Object.fromEntries(readdirSync(join(directory, relative), { withFileTypes: true }).flatMap((entry) => {
    const name = join(relative, entry.name);
    return entry.isDirectory()
      ? Object.entries(snapshotFiles(directory, name))
      : [[name, readFileSync(join(directory, name)).toString('base64')]];
  }));
}

let root;
let targetDir;
let sourceBytes;
let generatedPackage;
let originalPackage;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'create-game-native-'));
  const fixtureTemplate = join(root, 'games', 'shell_template');
  for (const input of INPUTS) {
    mkdirSync(dirname(join(fixtureTemplate, input)), { recursive: true });
    cpSync(join(TEMPLATE, input), join(fixtureTemplate, input), { recursive: true });
  }
  sourceBytes = snapshotFiles(fixtureTemplate);
  originalPackage = JSON.parse(readFileSync(join(fixtureTemplate, 'package.json'), 'utf8'));
  ({ targetDir } = createGame({ name: NAME, repoRoot: root, from: 'shell_template' }));
  generatedPackage = JSON.parse(readFileSync(join(targetDir, 'package.json'), 'utf8'));
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('full-shell native identity using committed template inputs', () => {
  it('routes every generated native script to the new game', () => {
    expect(generatedPackage.name).toBe(`@fabrikav2/${NAME}`);
    for (const script of ['ios:add', 'ios:sync']) {
      const selections = [...generatedPackage.scripts[script].matchAll(/--game(?:=|\s+)([a-z0-9_]+)/g)];
      expect(selections).toHaveLength(2);
      expect(selections.map((match) => match[1])).toEqual([NAME, NAME]);
      expect(generatedPackage.scripts[script]).toContain('npx cap sync ios');
    }
    for (const [script, command] of Object.entries(originalPackage.scripts)) {
      if (!['ios:add', 'ios:sync'].includes(script)) expect(generatedPackage.scripts[script]).toBe(command);
    }
  });

  it('preserves native recipe validation and reusable bridge and provider inputs', () => {
    const recipe = JSON.parse(readFileSync(join(targetDir, 'native-resources/ios/shell-manifest.json'), 'utf8'));
    const originalRecipe = JSON.parse(readFileSync(join(TEMPLATE, 'native-resources/ios/shell-manifest.json'), 'utf8'));
    expect(recipe).toEqual({
      ...originalRecipe,
      game: NAME,
      capacitorAppId: APP_ID,
      ios: { ...originalRecipe.ios, bundleId: APP_ID, displayName: 'Native Probe 2' },
    });
    expect(readFileSync(join(targetDir, 'capacitor.config.ts'), 'utf8')).toContain(`appId: "${APP_ID}"`);
    expect(readFileSync(join(targetDir, 'native-resources/ios/App/Info.plist'), 'utf8')).toContain('<string>Native Probe 2</string>');
    expect(readFileSync(join(targetDir, 'native-resources/ios/App/ShellTemplateBridgeViewController.swift')))
      .toEqual(readFileSync(join(TEMPLATE, 'native-resources/ios/App/ShellTemplateBridgeViewController.swift')));
    // The source template currently has unrelated AppsFlyer validation issues.
    // Stamping must introduce no new issues, and must reach recipe validation
    // instead of throwing on a mismatched game or Capacitor identity.
    const sourceValidation = validateGeneratedShell({ repoRoot: root, game: 'shell_template' });
    expect(sourceValidation.generatedPresent).toBe(false);
    expect(validateGeneratedShell({ repoRoot: root, game: NAME })).toEqual(sourceValidation);
  });

  it('aligns the reference capture target with Capacitor without changing the reference lane', () => {
    const original = loadManifest(TEMPLATE);
    const generated = loadManifest(targetDir);
    expect(generated.game).toBe(NAME);
    expect(generated.v2.package).toBe(APP_ID);
    expect(generated.reference).toEqual(original.reference);
    expect(generated.states).toEqual(original.states);
  });

  it('leaves all copied template inputs and original repository bytes untouched', () => {
    expect(snapshotFiles(join(root, 'games', 'shell_template'))).toEqual(sourceBytes);
    for (const [relative, bytes] of Object.entries(sourceBytes)) {
      expect(readFileSync(join(TEMPLATE, relative)).toString('base64')).toBe(bytes);
    }
  });
});
