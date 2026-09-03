#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { hydrateProviders, readJson, validateRuntimeConfig } from './src/config.mjs';
import { buildHealthSnapshot, inspectCredential, probeAppStoreConnect, probeMeta } from './src/health.mjs';

const toolRoot = path.dirname(fileURLToPath(import.meta.url));

async function main(argv) {
  const [command, ...args] = argv;
  if (command !== 'health') throw new Error('usage: cli.mjs health [--live] [--tabs-file FILE] [--probe-file FILE]');
  const options = parseArgs(args);
  const staticConfig = readJson(options.config ?? path.join(toolRoot, 'config', 'providers.json'));
  if (staticConfig.schema_version !== 1) throw new Error('provider config schema_version must equal 1');
  const runtimePath = options.runtimeConfig ?? path.join(os.homedir(), '.config', 'base-game-lab', 'find-games-provider-ops.json');
  const runtime = fs.existsSync(runtimePath) ? validateRuntimeConfig(readJson(runtimePath)) : validateRuntimeConfig({ schema_version: 1, credentials: {} });
  const providers = hydrateProviders(staticConfig, runtime);
  const tabs = options.tabsFile ? readJson(options.tabsFile) : inspectChromeTabs();
  const probes = options.probeFile ? readJson(options.probeFile) : (options.live ? await runLiveProbes(providers) : {});
  const observedAt = options.observedAt ?? new Date().toISOString();
  const snapshot = buildHealthSnapshot({
    observedAt,
    games: staticConfig.games,
    providers,
    tabs,
    browserContract: {
      expectedWindowCount: staticConfig.browser.expected_window_count,
      expectedTabCount: staticConfig.browser.expected_tab_count,
    },
    env: process.env,
    probes,
  });
  process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--live') options.live = true;
    else if (arg === '--config') options.config = requiredValue(args, ++index, arg);
    else if (arg === '--runtime-config') options.runtimeConfig = requiredValue(args, ++index, arg);
    else if (arg === '--tabs-file') options.tabsFile = requiredValue(args, ++index, arg);
    else if (arg === '--probe-file') options.probeFile = requiredValue(args, ++index, arg);
    else if (arg === '--observed-at') options.observedAt = requiredValue(args, ++index, arg);
    else throw new Error(`unknown option: ${arg}`);
  }
  return options;
}

function requiredValue(args, index, flag) {
  if (!args[index]) throw new Error(`${flag} requires a value`);
  return args[index];
}

export function inspectChromeTabs() {
  if (process.platform !== 'darwin') throw new Error('live Chrome tab inspection is available only on macOS; use --tabs-file elsewhere');
  const script = `
    const chrome = Application('Google Chrome');
    const rows = [];
    chrome.windows().forEach((window, windowIndex) => {
      window.tabs().forEach((tab, tabIndex) => rows.push({
        window: windowIndex + 1,
        index: tabIndex + 1,
        title: tab.title(),
        url: tab.url()
      }));
    });
    JSON.stringify(rows);
  `;
  const result = spawnSync('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Chrome tab inventory unavailable or automation permission denied');
  return JSON.parse(result.stdout);
}

async function runLiveProbes(providers) {
  const probes = {};
  for (const provider of providers) {
    const credentialStates = provider.credentials.map((credential) => inspectCredential(credential, process.env));
    if (!provider.api || credentialStates.some(({ kind, status }) => kind === 'reporting_api' && status !== 'available')) continue;
    if (provider.api === 'meta') {
      probes[provider.id] = await probeMeta({
        accountId: provider.ad_account_id,
        accessToken: credentialValue(provider, 'reporting_token'),
      });
    } else if (provider.api === 'app_store_connect') {
      probes[provider.id] = await probeAppStoreConnect({
        issuerId: credentialValue(provider, 'issuer_id'),
        keyId: credentialValue(provider, 'key_id'),
        privateKey: fs.readFileSync(credentialPath(provider, 'private_key'), 'utf8'),
      });
    }
  }
  return probes;
}

function credentialValue(provider, id) {
  const credential = provider.credentials.find((entry) => entry.id === id);
  return process.env[credential.env];
}

function credentialPath(provider, id) {
  const credential = provider.credentials.find((entry) => entry.id === id);
  return process.env[credential.path_env];
}

main(process.argv.slice(2)).catch(() => {
  process.stderr.write('find-games-provider-ops: configuration, browser inspection, or probe setup failed\n');
  process.exitCode = 2;
});
