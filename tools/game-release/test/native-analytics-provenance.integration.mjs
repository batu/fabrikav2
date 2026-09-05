import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';
import { build, loadConfigFromFile } from 'vite';

const root = fileURLToPath(new URL('../../../', import.meta.url));
// Optional baseline replay compiles the old sink/allowlist without editing the
// checkout. This is regression evidence, not a production build switch.
const baseline = process.env.PROVENANCE_SOURCE_REF;

for (const game of ['find_the_bird', 'find_the_dog']) {
  test(`${game}: production compile preserves source identity across late native overrides`, async () => {
    const gameRoot = path.join(root, 'games', game);
    const version = JSON.parse(readFileSync(path.join(gameRoot, 'package.json'), 'utf8')).version;
    const previous = process.env.npm_package_version;
    process.env.npm_package_version = version;
    let compiled;
    try {
      const loaded = await loadConfigFromFile({ command: 'build', mode: 'ios', isProduction: true }, path.join(gameRoot, 'vite.config.ts'));
      assert.ok(loaded);
      compiled = await build({
        ...loaded.config,
        configFile: false,
        root: gameRoot,
        mode: 'ios',
        logLevel: 'error',
        plugins: [
          ...(loaded.config.plugins ?? []),
          {
            name: 'provenance-integration-entry',
            resolveId(id) { if (id === 'provenance-entry' || id === path.join(gameRoot, 'provenance-entry')) return '\0provenance-entry'; },
            load(id) {
              if (id === '\0provenance-entry') return `
                export { createGameAnalyticsSink } from ${JSON.stringify(path.join(gameRoot, 'src/analytics/GameAnalyticsSink.ts'))};
                export { createAnalytics } from ${JSON.stringify(path.join(root, 'packages/sdk/src/analytics/Analytics.ts'))};
                export const info = __BUILD_INFO__;
                export const production = import.meta.env.PROD;
              `;
              if (baseline && /\/(GameAnalyticsSink|CanonicalAnalyticsEvents)\.ts$/.test(id)) {
                return execFileSync('git', ['show', `${baseline}:${path.relative(root, id)}`], { cwd: root, encoding: 'utf8' });
              }
            },
          },
        ],
        // Compile the real analytics chain with the real iOS production config.
        // In-memory output omits unrelated level-asset copying (writeBundle),
        // while retaining Vite's defines, minification, and build-info emission.
        build: {
          ...loaded.config.build,
          write: false,
          lib: { entry: 'provenance-entry', name: 'Provenance', formats: ['iife'] },
          rollupOptions: { external: ['gameanalytics'], output: { inlineDynamicImports: true } },
        },
      });
    } finally {
      if (previous === undefined) delete process.env.npm_package_version;
      else process.env.npm_package_version = previous;
    }
    const output = Array.isArray(compiled) ? compiled[0].output : compiled.output;
    const code = output.find((item) => item.type === 'chunk').code;
    const info = JSON.parse(output.find((item) => item.fileName === 'build-info.json').source);
    assert.equal(info.version, version);

    // Xcode archive overrides happen AFTER this one web compile. Exercise two
    // native Info.plist fixtures against identical compiled bytes. The fixtures
    // model MARKETING_VERSION/CURRENT_PROJECT_VERSION, not claimed store builds.
    const nativePlugin = readFileSync(path.join(root, 'node_modules/@capacitor/app/ios/Sources/AppPlugin/AppPlugin.swift'), 'utf8');
    assert.match(nativePlugin, /"build": info\["CFBundleVersion"\]/);
    assert.match(nativePlugin, /"version": info\["CFBundleShortVersionString"\]/);
    for (const override of [{ version: '1.2.1', build: '35' }, { version: '1.2.2', build: '36' }]) {
      const nativePlist = {
        CFBundleShortVersionString: override.version,
        CFBundleVersion: override.build,
      };
      const calls = [];
      const nativeCalls = [];
      const context = {
        console, setTimeout, clearTimeout,
        webkit: { messageHandlers: { bridge: {} } },
        Capacitor: {
          PluginHeaders: [{ name: 'App', methods: [{ name: 'getInfo', rtype: 'promise' }] }],
          nativePromise: async (plugin, method) => {
            nativeCalls.push(`${plugin}.${method}`);
            return { version: nativePlist.CFBundleShortVersionString, build: nativePlist.CFBundleVersion };
          },
        },
      };
      context.window = context;
      vm.runInNewContext(code, context);
      const api = context.Provenance;
      assert.equal(api.production, true);
      const sdk = {
        GameAnalytics: Object.fromEntries([
          'setEnabledInfoLog', 'setEnabledVerboseLog', 'configureAvailableResourceCurrencies',
          'configureAvailableResourceItemTypes', 'setEnabledManualSessionHandling', 'initialize',
          'startSession', 'endSession', 'addProgressionEvent', 'addDesignEvent', 'addResourceEvent', 'addAdEvent',
        ].map((name) => [name, (...args) => calls.push({ name, args })])),
        EGAProgressionStatus: { Start: 1 }, EGAResourceFlowType: { Source: 1 },
        EGAAdAction: { Show: 1 }, EGAAdType: { Interstitial: 1 },
      };
      const sink = api.createGameAnalyticsSink({ gameKey: 'g'.repeat(32), secretKey: 's'.repeat(40), verboseLogging: false }, { loader: async () => sdk });
      const sourceStamp = `${info.version}+${info.sha}${info.dirty ? '-dirty' : ''}`;
      const analytics = api.createAnalytics({ env: 'production', sessionId: 'local-only', sinks: [sink], globalParams: {
        game, platform: 'ios', environment: 'production', app_version: info.version, build: sourceStamp,
      } });
      analytics.track('session_start', { first_open: false });
      await analytics.flush();
      analytics.track('level_start', { level_id: 'l1' });
      const design = calls.find((call) => call.name === 'addDesignEvent').args[2];
      const progression = calls.find((call) => call.name === 'addProgressionEvent').args[5];
      for (const fields of [design, progression]) {
        assert.equal(fields.native_app_version, override.version);
        assert.equal(fields.native_build_number, override.build);
        assert.equal(fields.build, sourceStamp);
        assert.equal(fields.app_version, version);
        assert.equal(fields.environment, 'production');
      }
      assert.deepEqual(nativeCalls, ['App.getInfo']);
      console.log(JSON.stringify({ game, production: api.production, sourceStamp, ...override, nativeFields: design }));
    }
  });
}
