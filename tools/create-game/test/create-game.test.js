import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGame, titleCase } from '../src/create-game.mjs';

// Build a minimal, hermetic fake repo (games/_template only) in a tmp dir so the
// test never scaffolds into the real games/ tree.
function writeTemplate(root) {
  const tpl = join(root, 'games', '_template');
  mkdirSync(join(tpl, 'src'), { recursive: true });
  mkdirSync(join(tpl, 'design'), { recursive: true });
  mkdirSync(join(tpl, 'refs'), { recursive: true });
  mkdirSync(join(tpl, '.work'), { recursive: true });
  mkdirSync(join(tpl, 'node_modules', 'junk'), { recursive: true });

  writeFileSync(
    join(tpl, 'package.json'),
    JSON.stringify({ name: '@fabrikav2/game-template', private: true, description: 'copied by create-game' }, null, 2),
  );
  writeFileSync(join(tpl, 'game.config.ts'), 'export const gameConfig = {\n  id: "template",\n  title: "game.title" satisfies CopyKey,\n} as const;\n');
  writeFileSync(join(tpl, 'design', 'copy.ts'), 'export const copy = {\n  "game.title": "Template Game",\n} as const;\n');
  writeFileSync(join(tpl, 'index.html'), '<title>Template Game</title>\n');
  writeFileSync(join(tpl, 'capacitor.config.ts'), 'const config = {\n  appId: "com.fabrika.template",\n  appName: "Template Game",\n};\n');
  writeFileSync(join(tpl, 'refs', 'manifest.yaml'), 'game: template\nv2:\n  package: com.fabrikav2.template\n');
  writeFileSync(join(tpl, 'README.md'), '# Template Game\n\nSkeleton.\n');
  writeFileSync(
    join(tpl, 'src', 'main.ts'),
    'import { gameConfig } from "../game.config.ts";\nexport function harnessWindowKeyForGame(gameId) {\n  return `__${gameId.toUpperCase()}_HARNESS__`;\n}\nexport const harnessWindowKey = harnessWindowKeyForGame(gameConfig.id);\n',
  );
  writeFileSync(join(tpl, '.work', 'README.md'), '# scratch\n');
  writeFileSync(join(tpl, 'node_modules', 'junk', 'index.js'), 'module.exports = 1;\n');
}

let root;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'create-game-'));
  writeTemplate(root);
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

    expect(readFileSync(join(targetDir, 'README.md'), 'utf8')).toContain('# My Game');
  });

  it('copies real content but skips node_modules', () => {
    const dir = join(root, 'games', 'my_game');
    expect(existsSync(join(dir, 'src', 'main.ts'))).toBe(true);
    expect(existsSync(join(dir, '.work', 'README.md'))).toBe(true);
    expect(existsSync(join(dir, 'node_modules'))).toBe(false);
  });

  it('refuses to overwrite an existing game', () => {
    expect(() => createGame({ name: 'my_game', repoRoot: root })).toThrow(/already exists/);
  });

  it('rejects invalid names and the template name itself', () => {
    expect(() => createGame({ name: 'My Game', repoRoot: root })).toThrow(/invalid game name/);
    expect(() => createGame({ name: '', repoRoot: root })).toThrow(/invalid game name/);
    expect(() => createGame({ name: '_template', repoRoot: root })).toThrow(/template/);
  });
});
