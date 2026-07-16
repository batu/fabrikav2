import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGame, titleCase } from '../src/create-game.mjs';
import { loadManifest } from '../../refcap-compare/src/manifest.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// Build a minimal, hermetic fake repo (games/_template only) in a tmp dir so the
// test never scaffolds into the real games/ tree.
function writeTemplate(root) {
  const tpl = join(root, 'games', '_template');
  mkdirSync(join(tpl, 'src'), { recursive: true });
  mkdirSync(join(tpl, 'design'), { recursive: true });
  mkdirSync(join(tpl, 'docs'), { recursive: true });
  mkdirSync(join(tpl, 'refs'), { recursive: true });
  mkdirSync(join(tpl, 'native-resources', 'ios', 'App'), { recursive: true });
  mkdirSync(join(tpl, 'native-resources', 'android', 'app', 'src', 'main', 'res', 'values'), { recursive: true });
  mkdirSync(join(tpl, '.work'), { recursive: true });
  mkdirSync(join(tpl, 'node_modules', 'junk'), { recursive: true });

  writeFileSync(
    join(tpl, 'package.json'),
    JSON.stringify(
      {
        name: '@fabrikav2/game-template',
        private: true,
        description: 'copied by create-game',
        scripts: {
          typecheck: 'tsc --noEmit',
          'test:unit': 'vitest run',
          lint: 'eslint .',
        },
        devDependencies: {
          '@fabrikav2/kernel': '*',
          '@fabrikav2/testkit': '*',
        },
      },
      null,
      2,
    ),
  );
  writeFileSync(join(tpl, 'game.config.ts'), 'export const gameConfig = {\n  id: "template",\n  title: "game.title" satisfies CopyKey,\n} as const;\n');
  writeFileSync(join(tpl, 'design', 'copy.ts'), 'export const copy = {\n  "game.title": "Template Game",\n} as const;\n');
  writeFileSync(join(tpl, 'index.html'), '<title>Template Game</title>\n');
  writeFileSync(
    join(tpl, 'capacitor.config.ts'),
    'const config = {\n  appId: "com.fabrika.template",\n  appName: "Template Game",\n  ios: {\n    contentInset: "never",\n  },\n};\n',
  );
  writeFileSync(
    join(tpl, 'native-resources', 'ios', 'App', 'Info.plist'),
    '<key>CFBundleDisplayName</key>\n<string>Template Game</string>\n',
  );
  writeFileSync(
    join(tpl, 'native-resources', 'android', 'app', 'src', 'main', 'res', 'values', 'strings.xml'),
    '<resources><string name="app_name">Template Game</string><string name="package_name">com.fabrika.template</string></resources>\n',
  );
  writeFileSync(join(tpl, 'refs', 'manifest.yaml'), 'game: template\nv2:\n  package: com.fabrikav2.template\n');
  writeFileSync(join(tpl, 'README.md'), '# Template Game\n\nSkeleton.\n');
  writeFileSync(
    join(tpl, 'docs', 'brief.md'),
    '# <Game> - design brief\n\n> Replace this file when you scaffold a game.\n',
  );
  writeFileSync(
    join(tpl, 'src', 'main.ts'),
    'import { gameConfig } from "../game.config.ts";\nexport function harnessWindowKeyForGame(gameId) {\n  return `__${gameId.toUpperCase()}_HARNESS__`;\n}\nexport const harnessWindowKey = harnessWindowKeyForGame(gameConfig.id);\n',
  );
  writeFileSync(join(tpl, '.work', 'README.md'), '# scratch\n');
  writeFileSync(join(tpl, 'node_modules', 'junk', 'index.js'), 'module.exports = 1;\n');
}

// Minimal fake shell_template mirroring the identity anchors the shell-stamp
// path rewrites (Test Game title, com.basegamelab ids, pinned smoke test).
function writeShellTemplate(root) {
  const tpl = join(root, 'games', 'shell_template');
  mkdirSync(join(tpl, 'design'), { recursive: true });
  mkdirSync(join(tpl, 'tests', 'unit'), { recursive: true });
  mkdirSync(join(tpl, 'native-resources', 'ios', 'App', 'App'), { recursive: true });
  mkdirSync(join(tpl, 'ios', 'App'), { recursive: true }); // cap-generated: must be skipped
  mkdirSync(join(tpl, 'evidence'), { recursive: true });
  writeFileSync(join(tpl, 'evidence', 'old-proof.txt'), 'test game evidence\n');
  writeFileSync(join(tpl, 'ios', 'App', 'generated.txt'), 'generated\n');
  writeFileSync(
    join(tpl, 'package.json'),
    JSON.stringify({ name: '@fabrikav2/shell_template', private: true, scripts: {}, devDependencies: {} }, null, 2),
  );
  writeFileSync(join(tpl, 'game.config.ts'), 'export const gameConfig = { id: "shell_template", title: "game.title" };\n');
  writeFileSync(join(tpl, 'design', 'copy.ts'), 'export const copy = { "game.title": "Test Game" };\n');
  writeFileSync(join(tpl, 'index.html'), '<html><head><title>Test Game</title></head></html>\n');
  writeFileSync(
    join(tpl, 'capacitor.config.ts'),
    'const config = { appId: "com.basegamelab.shell_template.dev", appName: "Shell Template" };\nexport default config;\n',
  );
  writeFileSync(
    join(tpl, 'native-resources', 'ios', 'App', 'App', 'Info.plist'),
    '<plist><string>Shell Template</string><string>com.basegamelab.shell_template.dev</string></plist>\n',
  );
  writeFileSync(
    join(tpl, 'tests', 'unit', 'smoke.test.ts'),
    'describe("shell_template config", () => { expect(gameConfig.id).toBe("shell_template"); });\n',
  );
}

let root;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'create-game-'));
  writeTemplate(root);
  writeShellTemplate(root);
});
afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('titleCase', () => {
  it('splits on - and _ and capitalizes', () => {
    expect(titleCase('marble_run')).toBe('Marble Run');
    expect(titleCase('block-blast')).toBe('Block Blast');
  });
});

describe('createGame', () => {
  it('scaffolds a new game with the name substituted everywhere', () => {
    const { targetDir, packageName, title } = createGame({ name: 'my_game', repoRoot: root });
    expect(packageName).toBe('@fabrikav2/my_game');
    expect(title).toBe('My Game');

    const pkg = JSON.parse(readFileSync(join(targetDir, 'package.json'), 'utf8'));
    expect(pkg.name).toBe('@fabrikav2/my_game');
    expect(pkg.description).toBeUndefined(); // template-only note dropped
    expect(pkg.scripts).toEqual({
      typecheck: 'tsc --noEmit',
      'test:unit': 'vitest run',
      lint: 'eslint .',
    });
    expect(pkg.scripts).not.toHaveProperty('test:e2e');
    expect(pkg.scripts).not.toHaveProperty('e2e');
    expect(pkg.devDependencies).toEqual({
      '@fabrikav2/kernel': '*',
      '@fabrikav2/ui': '*',
      '@fabrikav2/sdk': '*',
      '@fabrikav2/testkit': '*',
    });

    expect(readFileSync(join(targetDir, 'game.config.ts'), 'utf8')).toContain('id: "my_game"');
    // title stays a copy KEY in the config; the human title is substituted into copy.ts.
    expect(readFileSync(join(targetDir, 'game.config.ts'), 'utf8')).toContain('title: "game.title"');
    expect(readFileSync(join(targetDir, 'design', 'copy.ts'), 'utf8')).toContain('"game.title": "My Game"');
    expect(readFileSync(join(targetDir, 'index.html'), 'utf8')).toContain('<title>My Game</title>');

    const manifest = readFileSync(join(targetDir, 'refs', 'manifest.yaml'), 'utf8');
    expect(manifest).toContain('game: my_game');
    expect(manifest).toContain('package: com.fabrikav2.my_game');

    const configGame = readFileSync(join(targetDir, 'game.config.ts'), 'utf8').match(/id: "([^"]+)"/)?.[1];
    const manifestGame = manifest.match(/^game: ([^\n]+)$/m)?.[1];
    const derivedConfigKey = `__${configGame?.toUpperCase()}_HARNESS__`;
    const derivedManifestKey = `__${manifestGame?.toUpperCase()}_HARNESS__`;
    expect(derivedConfigKey).toBe('__MY_GAME_HARNESS__');
    expect(derivedConfigKey).toBe(derivedManifestKey);

    const main = readFileSync(join(targetDir, 'src', 'main.ts'), 'utf8');
    expect(main).toContain('gameId.toUpperCase()');

    const cap = readFileSync(join(targetDir, 'capacitor.config.ts'), 'utf8');
    expect(cap).toContain('appId: "com.fabrika.mygame"');
    expect(cap).toContain('appName: "My Game"');
    expect(cap).toContain('contentInset: "never"');

    const iosPlist = readFileSync(join(targetDir, 'native-resources', 'ios', 'App', 'Info.plist'), 'utf8');
    expect(iosPlist).toContain('<string>My Game</string>');
    expect(iosPlist).not.toContain('Template Game');

    const androidStrings = readFileSync(
      join(targetDir, 'native-resources', 'android', 'app', 'src', 'main', 'res', 'values', 'strings.xml'),
      'utf8',
    );
    expect(androidStrings).toContain('My Game');
    expect(androidStrings).toContain('com.fabrika.mygame');
    expect(androidStrings).not.toContain('Template Game');

    const readme = readFileSync(join(targetDir, 'README.md'), 'utf8');
    expect(readme).toContain('# My Game');
    expect(readme).toContain('`my_game`');
    expect(readme).toContain('@fabrikav2/ui');
    expect(readme).toContain('@fabrikav2/sdk');
    expect(readme).toContain('native-resources/');
    expect(readme).toContain('DEVELOPMENT_TEAM=<team id>');
    expect(readme).not.toContain('Template Game');
    expect(readme).not.toContain('Canonical v2 game skeleton');

    const brief = readFileSync(join(targetDir, 'docs', 'brief.md'), 'utf8');
    expect(brief).toContain('# My Game - design brief');
    expect(brief).toContain('Game id: `my_game`');
    expect(brief).not.toContain('<Game>');
    expect(brief).not.toContain('Replace this file when you scaffold a game');
  });

  it('copies real content but skips node_modules', () => {
    const dir = join(root, 'games', 'my_game');
    expect(existsSync(join(dir, 'src', 'main.ts'))).toBe(true);
    expect(existsSync(join(dir, '.work', 'README.md'))).toBe(true);
    expect(existsSync(join(dir, 'node_modules'))).toBe(false);
  });

  it('stamps a game from shell_template with shell identity rewritten', () => {
    const { targetDir, packageName, title } = createGame({ name: 'wool_probe', repoRoot: root, from: 'shell_template' });
    expect(packageName).toBe('@fabrikav2/wool_probe');
    expect(title).toBe('Wool Probe');
    expect(readFileSync(join(targetDir, 'game.config.ts'), 'utf8')).toContain('id: "wool_probe"');
    expect(readFileSync(join(targetDir, 'design', 'copy.ts'), 'utf8')).toContain('"game.title": "Wool Probe"');
    expect(readFileSync(join(targetDir, 'index.html'), 'utf8')).toContain('<title>Wool Probe</title>');
    const cap = readFileSync(join(targetDir, 'capacitor.config.ts'), 'utf8');
    expect(cap).toContain('appId: "com.basegamelab.woolprobe.dev"');
    expect(cap).toContain('appName: "Wool Probe"');
    const plist = readFileSync(join(targetDir, 'native-resources', 'ios', 'App', 'App', 'Info.plist'), 'utf8');
    expect(plist).toContain('<string>Wool Probe</string>');
    expect(plist).toContain('com.basegamelab.woolprobe.dev');
    expect(readFileSync(join(targetDir, 'tests', 'unit', 'smoke.test.ts'), 'utf8')).toContain('toBe("wool_probe")');
    // cap-generated ios/ and the source game's evidence/ must not travel;
    // native-resources/ios (the committed recipe) must.
    expect(existsSync(join(targetDir, 'ios'))).toBe(false);
    expect(existsSync(join(targetDir, 'evidence', 'old-proof.txt'))).toBe(false);
    expect(existsSync(join(targetDir, 'evidence'))).toBe(true);
    expect(existsSync(join(targetDir, 'native-resources', 'ios', 'App', 'App', 'Info.plist'))).toBe(true);
  });

  it('rejects an unknown template', () => {
    expect(() => createGame({ name: 'whatever', repoRoot: root, from: 'nope' })).toThrow(/unknown template/);
  });

  it('refuses to overwrite an existing game', () => {
    expect(() => createGame({ name: 'my_game', repoRoot: root })).toThrow(/already exists/);
  });

  it('rejects invalid names and the template name itself', () => {
    expect(() => createGame({ name: 'My Game', repoRoot: root })).toThrow(/invalid game name/);
    expect(() => createGame({ name: '', repoRoot: root })).toThrow(/invalid game name/);
    expect(() => createGame({ name: '_template', repoRoot: root })).toThrow(/template/);
  });

  it('refuses to resurrect a slug that is archived under archive/games', () => {
    // A deprecated game's tree is preserved under archive/games/<name>. Scaffolding
    // an active workspace with the same slug would silently resurrect it.
    mkdirSync(join(root, 'archive', 'games', 'cameleon'), { recursive: true });
    expect(() => createGame({ name: 'cameleon', repoRoot: root })).toThrow(/archived/);
    expect(existsSync(join(root, 'games', 'cameleon'))).toBe(false);
  });
});

describe('template manifest', () => {
  it('validates the scaffold default states with the production manifest reader', () => {
    const manifest = loadManifest(join(REPO, 'games', '_template'));

    expect(manifest.states.map((state) => state.name)).toEqual(
      ['menu', 'level', 'settings', 'pause', 'win', 'fail'],
    );
  });
});

describe('archive deprecation guardrail (repo-wide config)', () => {
  it('root knip config ignores archive/** so archived games are not scanned', () => {
    // Companion guardrail to createGame's archived-slug rejection: knip must not
    // enumerate the preserved archive/ tree (unlisted deps, unresolved imports,
    // unused exports) or the deprecation regresses at the repo-wide config layer.
    const knip = JSON.parse(readFileSync(join(REPO, 'knip.json'), 'utf8'));
    expect(knip.ignore).toContain('archive/**');
  });
});
