/**
 * Firebase Remote Config transport.
 *
 * Uses the public client fetch endpoint
 * (`firebaseremoteconfig.googleapis.com/v1/projects/{project}/namespaces/firebase:fetch`)
 * with the project's web API key + app id rather than the native plugin, so:
 *   - no extra Capacitor dependency or pod,
 *   - Android works without the `google-services.json` the publisher has not
 *     supplied (the plugin route would need it),
 *   - the same code path runs in the browser dev server and on both devices.
 *
 * Dry-run against the real `mable-run` project on 2026-07-24 returned
 * `{"state":"NO_TEMPLATE"}` — the endpoint authenticates with these credentials;
 * no template has been published in the console yet, which the caller treats as
 * "keep the compiled defaults".
 *
 * Response entries are always strings; coercion to the schema's declared types
 * happens here so the service only ever holds typed values.
 */
import {
  REMOTE_CONFIG_DEFINITIONS,
  type RemoteConfigValues,
  type RemoteConfigValueKey,
} from './remoteConfigSchema';

export type RemoteConfigFetchOutcome =
  | { status: 'updated'; values: Partial<RemoteConfigValues> }
  | { status: 'no-template' }
  | { status: 'not-configured'; reason: string }
  | { status: 'failed'; reason: string };

export interface RemoteConfigFetchCredentials {
  projectId: string;
  apiKey: string;
  appId: string;
  appInstanceId: string;
}

interface FetchResponseBody {
  state?: string;
  entries?: Record<string, string>;
}

const FETCH_TIMEOUT_MS = 8_000;

export function readFetchCredentials(env: Record<string, string | undefined>): RemoteConfigFetchCredentials | null {
  const projectId = env.VITE_FIREBASE_PROJECT_ID?.trim() ?? '';
  const apiKey = env.VITE_FIREBASE_API_KEY?.trim() ?? '';
  const appId = env.VITE_FIREBASE_APP_ID?.trim() ?? '';
  if (projectId === '' || apiKey === '' || appId === '') return null;
  return { projectId, apiKey, appId, appInstanceId: readAppInstanceId() };
}

/**
 * Stable per-install id. The endpoint requires one (it is the Firebase
 * installation id in the native SDKs); a persisted random id keeps percentage
 * rollouts and A/B conditions stable for a given install.
 */
function readAppInstanceId(): string {
  const storageKey = 'marble_run_rc_instance_id';
  const generated = (): string => `mr-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return generated();
  const existing = window.localStorage.getItem(storageKey);
  if (existing !== null && existing !== '') return existing;
  const created = generated();
  window.localStorage.setItem(storageKey, created);
  return created;
}

export async function fetchRemoteConfig(
  credentials: RemoteConfigFetchCredentials,
): Promise<RemoteConfigFetchOutcome> {
  const url = `https://firebaseremoteconfig.googleapis.com/v1/projects/${encodeURIComponent(credentials.projectId)}/namespaces/firebase:fetch?key=${encodeURIComponent(credentials.apiKey)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: credentials.appId, app_instance_id: credentials.appInstanceId }),
      signal: controller.signal,
    });
    if (!response.ok) {
      return { status: 'failed', reason: `HTTP ${response.status}` };
    }
    const body = (await response.json()) as FetchResponseBody;
    if (body.state === 'NO_TEMPLATE') return { status: 'no-template' };
    return { status: 'updated', values: coerceEntries(body.entries ?? {}) };
  } catch (error) {
    return { status: 'failed', reason: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Map remote string entries onto typed schema values. Unknown remote keys and
 * unparseable values are dropped so a console typo degrades to the compiled
 * default instead of poisoning a value.
 */
export function coerceEntries(entries: Record<string, string>): Partial<RemoteConfigValues> {
  const values: Partial<RemoteConfigValues> = {};
  for (const definition of REMOTE_CONFIG_DEFINITIONS) {
    const raw = entries[definition.remoteKey];
    if (raw === undefined) continue;
    const key = definition.key as RemoteConfigValueKey;
    if (definition.type === 'boolean') {
      if (raw !== 'true' && raw !== 'false') continue;
      (values as Record<string, unknown>)[key] = raw === 'true';
    } else if (definition.type === 'number') {
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) continue;
      (values as Record<string, unknown>)[key] = parsed;
    } else {
      (values as Record<string, unknown>)[key] = raw;
    }
  }
  return values;
}
