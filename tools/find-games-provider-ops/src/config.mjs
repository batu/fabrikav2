import fs from 'node:fs';

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function validateRuntimeConfig(config) {
  if (config.schema_version !== 1) throw new Error('runtime config schema_version must equal 1');
  if (config.credentials === undefined) config.credentials = {};
  if (!isObject(config.credentials)) throw new Error('runtime config credentials must be an object');
  for (const [provider, credentials] of Object.entries(config.credentials)) {
    if (!isObject(credentials)) throw new Error(`credentials.${provider} must be an object`);
    for (const [id, locator] of Object.entries(credentials)) {
      if (!isObject(locator) || Object.keys(locator).length !== 1 || !(locator.env || locator.path_env)) {
        throw new Error(`credentials.${provider}.${id} must contain exactly one env or path_env locator`);
      }
      const name = locator.env ?? locator.path_env;
      if (!/^[A-Z][A-Z0-9_]*$/.test(name)) throw new Error(`credentials.${provider}.${id} locator must name an environment variable`);
    }
  }
  return config;
}

export function hydrateProviders(config, runtime) {
  const configuredProviderIds = new Set((config.providers ?? []).map(({ id }) => id));
  for (const runtimeProvider of Object.keys(runtime.credentials ?? {})) {
    if (!configuredProviderIds.has(runtimeProvider)) throw new Error(`unknown runtime provider: ${runtimeProvider}`);
  }
  const providerIds = new Set();
  if (!Array.isArray(config.providers) || config.providers.length === 0) throw new Error('providers must be a non-empty array');
  return config.providers.map((provider) => {
    if (providerIds.has(provider.id)) throw new Error(`duplicate provider id: ${provider.id}`);
    providerIds.add(provider.id);
    if (!provider.tab?.label || !Array.isArray(provider.tab.hosts)) throw new Error(`provider ${provider.id} requires tab label and hosts`);
    const configuredCredentialIds = new Set((provider.credentials ?? []).map(({ id }) => id));
    for (const runtimeCredential of Object.keys(runtime.credentials?.[provider.id] ?? {})) {
      if (!configuredCredentialIds.has(runtimeCredential)) throw new Error(`unknown runtime credential: ${provider.id}.${runtimeCredential}`);
    }
    const credentials = (provider.credentials ?? []).map((credential) => {
      const override = runtime.credentials?.[provider.id]?.[credential.id];
      const locator = override ?? credential.locator;
      if (!locator) throw new Error(`provider ${provider.id} credential ${credential.id} has no locator`);
      if (provider.id === 'appsflyer' && credential.id === 'reporting_token' && !locator.path_env) {
        throw new Error('AppsFlyer reporting_token requires path_env');
      }
      return { id: credential.id, kind: credential.kind, ...locator };
    });
    return { ...provider, credentials };
  });
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
