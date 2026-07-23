import { fixtureFetch } from './fixture-api.ts';
import type { PublishingSnapshot } from './features/publishing/model.ts';

export interface EditorStatus {
  service: 'ftd-level-editor';
  providerMode: 'fail-closed' | 'scripted' | 'live';
  workerMode: 'manual' | 'single-owner';
  stores: string[];
}

interface BootstrapResponse {
  launchCredential: string;
}

export interface EditorBootstrap {
  launchCredential: string;
  status: EditorStatus;
  publishing: PublishingSnapshot | null;
  fetchImpl: typeof fetch;
}

const runtimeFetch: typeof fetch = (...args) => globalThis.fetch(...args);
const editorFetch: typeof fetch = import.meta.env.MODE === 'fixture' ? fixtureFetch : runtimeFetch;
const editorPath = (path: string): string => (
  globalThis.location?.pathname.startsWith('/tools/ftd-editor/')
    ? `/tools/ftd-editor${path}`
    : path
);

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(`Editor request failed (${response.status})`);
  }
  return (await response.json()) as T;
}

export async function loadEditorBootstrap(): Promise<EditorBootstrap> {
  const bootstrap = await readJson<BootstrapResponse>(
    await editorFetch(editorPath('/bootstrap'), { credentials: 'same-origin' }),
  );
  const headers = { 'X-FTD-Launch-Credential': bootstrap.launchCredential };
  const status = await readJson<EditorStatus>(
    await editorFetch(editorPath('/api/status'), { credentials: 'same-origin', headers }),
  );
  const publishing = status.stores.includes('publishing')
    ? await readJson<PublishingSnapshot>(
        await editorFetch(editorPath('/api/publishing'), { credentials: 'same-origin', headers }),
      )
    : null;
  return {
    launchCredential: bootstrap.launchCredential,
    status,
    publishing,
    fetchImpl: editorFetch,
  };
}
