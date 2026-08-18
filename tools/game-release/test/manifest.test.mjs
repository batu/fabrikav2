import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

import { buildReleaseManifest } from '../src/manifest.mjs';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'game-release-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  fs.mkdirSync(path.join(root, 'games/find_the_dog/native-resources/ios'), { recursive: true });
  fs.writeFileSync(path.join(root, 'games/find_the_dog/native-resources/ios/shell-manifest.json'), JSON.stringify({
    game: 'find_the_dog', capacitorAppId: 'com.basegamelab.find_the_dog.dev',
    ios: { bundleId: 'com.baseardahan.hiddenobj' },
  }));
  fs.writeFileSync(path.join(root, 'tracked'), 'x');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: root });
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  return { root, revision };
}

const validEnvironment = () => ({ ok: true, mode: 'ios', missingKeys: [], invalidKeys: [], emptyOverrideKeys: [] });
const validNative = () => ({ issues: [], generatedPresent: false, skAdNetworkCount: 0 });

describe('release manifest authority', () => {
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
});
