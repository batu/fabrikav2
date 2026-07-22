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
  publishing: PublishingSnapshot;
  fetchImpl: typeof fetch;
}

const runtimeFetch: typeof fetch = (...args) => globalThis.fetch(...args);
const editorFetch: typeof fetch = import.meta.env.MODE === 'fixture' ? fixtureFetch : runtimeFetch;

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(`Editor request failed (${response.status})`);
  }
  return (await response.json()) as T;
}

export async function loadEditorBootstrap(): Promise<EditorBootstrap> {
  const bootstrap = await readJson<BootstrapResponse>(
    await editorFetch('/bootstrap', { credentials: 'same-origin' }),
  );
  const headers = { 'X-FTD-Launch-Credential': bootstrap.launchCredential };
  const [status, publishing] = await Promise.all([
    readJson<EditorStatus>(await editorFetch('/api/status', { credentials: 'same-origin', headers })),
    readJson<PublishingSnapshot>(await editorFetch('/api/publishing', { credentials: 'same-origin', headers })),
  ]);
  return {
    launchCredential: bootstrap.launchCredential,
    status,
    publishing,
    fetchImpl: editorFetch,
  };
}
