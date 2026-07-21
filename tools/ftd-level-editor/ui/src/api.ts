import { fixtureFetch } from './fixture-api.ts';

export interface EditorStatus {
  service: 'ftd-level-editor';
  providerMode: 'fail-closed' | 'scripted' | 'live';
  workerMode: 'manual' | 'single-owner';
  stores: string[];
}

interface BootstrapResponse {
  launchCredential: string;
}

const runtimeFetch: typeof fetch = (...args) => globalThis.fetch(...args);
const editorFetch: typeof fetch = import.meta.env.MODE === 'fixture' ? fixtureFetch : runtimeFetch;

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(`Editor request failed (${response.status})`);
  }
  return (await response.json()) as T;
}

export async function loadEditorStatus(): Promise<EditorStatus> {
  const bootstrap = await readJson<BootstrapResponse>(
    await editorFetch('/bootstrap', { credentials: 'same-origin' }),
  );
  return readJson<EditorStatus>(
    await editorFetch('/api/status', {
      credentials: 'same-origin',
      headers: { 'X-FTD-Launch-Credential': bootstrap.launchCredential },
    }),
  );
}
