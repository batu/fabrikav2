import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

import { buildReleaseManifest, readReleaseIdentity } from '../src/manifest.mjs';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'game-release-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  fs.mkdirSync(path.join(root, 'games/find_the_dog/native-resources/ios'), { recursive: true });
  fs.writeFileSync(path.join(root, 'games/find_the_dog/native-resources/ios/shell-manifest.json'), JSON.stringify({
    schemaVersion: 1, game: 'find_the_dog', capacitorAppId: 'com.basegamelab.find_the_dog.dev',
    ios: { bundleId: 'com.baseardahan.hiddenobj', displayName: 'Find the Dog' },
  }));
  fs.writeFileSync(path.join(root, 'tracked'), 'x');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: root });
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  return { root, revision };
}

const validEnvironment = () => ({ ok: true, mode: 'ios', missingKeys: [], invalidKeys: [], emptyOverrideKeys: [] });
const validNative = () => ({ issues: [], generatedPresent: false, skAdNetworkCount: 0 });
const identityGraph = [
  'tools/game-release/cli.mjs', 'tools/game-release/src/manifest.mjs',
  'tools/game-env/src/env.mjs', 'tools/game-env/src/policies.mjs', 'tools/game-env/src/policies/find-the-dog.mjs', 'tools/game-env/src/validate.mjs',
  'tools/native-shell/src/native-shell.mjs', 'games/find_the_dog/native-resources/ios/shell-manifest.json',
];

describe('release manifest authority', () => {
  it('reads clean production identity without environment or generated-shell preflight', () => {
    const { root, revision } = fixture();
    const result = readReleaseIdentity({ repoRoot: root, game: 'find_the_dog', expectedSourceRevision: revision, platform: 'ios' });
    expect(result).toEqual({
      ok: true, game: 'find_the_dog', name: 'Find the Dog', platform: 'ios', bundleId: 'com.baseardahan.hiddenobj', sourceRevision: revision,
      nativeRecipe: { schemaVersion: 1, sha256: expect.stringMatching(/^[a-f0-9]{64}$/) },
    });
    expect(result).not.toHaveProperty('environment');
    expect(result).not.toHaveProperty('nativeShell');
  });

  it('uses production shell identity and returns metadata without environment values', () => {
    const { root, revision } = fixture();
    const result = buildReleaseManifest({ repoRoot: root, game: 'find_the_dog', expectedSourceRevision: revision }, {
      validateEnvironment: validEnvironment, validateGeneratedShell: validNative,
    });
    expect(result).toEqual({
      ok: true, game: 'find_the_dog', platform: 'ios', bundleId: 'com.baseardahan.hiddenobj',
      sourceRevision: revision,
      environment: { ok: true, mode: 'ios', missingKeys: [], invalidKeys: [], emptyOverrideKeys: [] },
      nativeShell: { ok: true, generatedPresent: false, skAdNetworkCount: 0 },
    });
    expect(JSON.stringify(result)).not.toContain('com.basegamelab.find_the_dog.dev');
  });

  it('rejects stale revision, dirty worktree, development identity, and validator failure', () => {
    const stale = fixture();
    expect(() => buildReleaseManifest({ repoRoot: stale.root, game: 'find_the_dog', expectedSourceRevision: '0'.repeat(40) }, {
      validateEnvironment: validEnvironment, validateGeneratedShell: validNative,
    })).toThrow(/source revision/);

    const dirty = fixture();
    fs.writeFileSync(path.join(dirty.root, 'tracked'), 'dirty');
    expect(() => readReleaseIdentity({ repoRoot: dirty.root, game: 'find_the_dog', expectedSourceRevision: dirty.revision })).toThrow(/dirty/);
    expect(() => buildReleaseManifest({ repoRoot: dirty.root, game: 'find_the_dog', expectedSourceRevision: dirty.revision }, {
      validateEnvironment: validEnvironment, validateGeneratedShell: validNative,
    })).toThrow(/dirty/);

    const development = fixture();
    const shell = path.join(development.root, 'games/find_the_dog/native-resources/ios/shell-manifest.json');
    const data = JSON.parse(fs.readFileSync(shell));
    data.ios.bundleId = data.capacitorAppId;
    fs.writeFileSync(shell, JSON.stringify(data));
    execFileSync('git', ['add', '.'], { cwd: development.root });
    execFileSync('git', ['commit', '-qm', 'dev id'], { cwd: development.root });
    const devRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: development.root, encoding: 'utf8' }).trim();
    expect(() => buildReleaseManifest({ repoRoot: development.root, game: 'find_the_dog', expectedSourceRevision: devRevision }, {
      validateEnvironment: validEnvironment, validateGeneratedShell: validNative,
    })).toThrow(/development identity/);

    const invalid = fixture();
    expect(() => buildReleaseManifest({ repoRoot: invalid.root, game: 'find_the_dog', expectedSourceRevision: invalid.revision }, {
      validateEnvironment: () => ({ ok: false, mode: 'ios', missingKeys: ['VITE_FIREBASE_API_KEY'], invalidKeys: [], emptyOverrideKeys: [] }),
      validateGeneratedShell: validNative,
    })).toThrow(/environment validation failed/);
  });

  it('exposes a JSON-only stdin/stdout CLI contract and redacts failures', () => {
    const { root, revision } = fixture();
    const cli = path.resolve(import.meta.dirname, '..', 'cli.mjs');
    // The production validators intentionally fail for the minimal fixture,
    // but the transport still returns one generic JSON object and no secrets.
    let stdout = '';
    try {
      stdout = execFileSync('node', [cli], {
        input: JSON.stringify({
          repoRoot: root, game: 'find_the_dog', platform: 'ios',
          expectedSourceRevision: revision, secret: 'fixture-secret-value',
        }),
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      stdout = error.stdout;
    }
    expect(JSON.parse(stdout)).toEqual({ ok: false, error: 'release manifest validation failed' });
    expect(stdout).not.toContain('fixture-secret-value');
  });

  it('exposes identity discovery over the CLI before environment materialization', () => {
    const { root, revision } = fixture();
    const cli = path.resolve(import.meta.dirname, '..', 'cli.mjs');
    const stdout = execFileSync('node', [cli], { input: JSON.stringify({ command: 'identity', repoRoot: root, game: 'find_the_dog', platform: 'ios', expectedSourceRevision: revision }), encoding: 'utf8' });
    expect(JSON.parse(stdout)).toMatchObject({ ok: true, game: 'find_the_dog', name: 'Find the Dog', bundleId: 'com.baseardahan.hiddenobj', sourceRevision: revision });
  });

  it('uses the pinned absolute Node even when PATH contains a forged node', () => {
    const { root, revision } = fixture(); const fake = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-node-')); const marker = path.join(fake, 'executed');
    const fakeNode = path.join(fake, 'node'); fs.writeFileSync(fakeNode, `#!/bin/sh\ntouch '${marker}'\nprintf '%s\\n' '{"ok":true}'\n`); fs.chmodSync(fakeNode, 0o755);
    const executable = path.resolve(import.meta.dirname, '..', 'identity-executor.mjs');
    const stdout = execFileSync(executable, [], {
      input: JSON.stringify({ command: 'identity', repoRoot: root, game: 'find_the_dog', platform: 'ios', expectedSourceRevision: revision }),
      encoding: 'utf8', env: { ...process.env, PATH: `${fake}:${process.env.PATH}` },
    });
    expect(fs.existsSync(marker)).toBe(false);
    expect(JSON.parse(stdout)).toMatchObject({ ok: true, sourceRevision: revision, bundleId: 'com.baseardahan.hiddenobj' });
  });

  it.each(identityGraph)('rejects identity runtime drift in %s before parsing stdin', (relative) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'identity-runtime-'));
    for (const file of ['tools/game-release/identity-executor.mjs', ...identityGraph]) {
      const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(path.resolve(file), target);
    }
    const executable = path.join(root, 'tools/game-release/identity-executor.mjs'); fs.chmodSync(executable, 0o755);
    fs.appendFileSync(path.join(root, relative), '\n// integrity mutation\n');
    const result = spawnSync(executable, [], { input: '{malformed-json', encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual({ ok: false, error: 'release identity integrity failed' });
  });
});
