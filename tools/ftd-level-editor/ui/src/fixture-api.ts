const LAUNCH_CREDENTIAL = 'fixture-launch-credential';
const CREDENTIAL_HEADER = 'X-FTD-Launch-Credential';
const PROTECTED_PREFIXES = ['/api', '/assets', '/downloads'] as const;

const RESPONSES = new Map<string, unknown>([
  ['GET /bootstrap', { launchCredential: LAUNCH_CREDENTIAL }],
  [
    'GET /api/status',
    {
      service: 'ftd-level-editor',
      providerMode: 'fail-closed',
      workerMode: 'manual',
      stores: [],
    },
  ],
  [
    'GET /api/publishing',
    {
      remoteEnabled: false,
      selectedRemoteRevision: null,
      rollbackEligibleCandidateIds: ['seq-2026-07-19-retained'],
      selected: {
        candidateId: 'seq-2026-07-20-retained',
        sequenceVersion: 'seq-2026-07-20',
        levelIds: ['starter-level', 'market-level'],
        catalogRevision: 'catalog-000052',
        changelog: 'Current retained sequence',
        actor: 'human:batu',
        sourceRevision: 'remote-52',
        digest: '52b5c1e6ec663ed21cf2d35530e56eb778705f50b84c8a42aeb69ee241f5ca82',
      },
      candidates: [
        {
          candidateId: 'seq-2026-07-19-retained',
          sequenceVersion: 'seq-2026-07-19',
          levelIds: ['starter-level'],
          catalogRevision: 'catalog-000051',
          changelog: 'Prior rollback-safe sequence',
          actor: 'human:batu',
          sourceRevision: 'remote-51',
          digest: '51b5c1e6ec663ed21cf2d35530e56eb778705f50b84c8a42aeb69ee241f5ca81',
        },
        {
          candidateId: 'seq-2026-07-20-retained',
          sequenceVersion: 'seq-2026-07-20',
          levelIds: ['starter-level', 'market-level'],
          catalogRevision: 'catalog-000052',
          changelog: 'Current retained sequence',
          actor: 'human:batu',
          sourceRevision: 'remote-52',
          digest: '52b5c1e6ec663ed21cf2d35530e56eb778705f50b84c8a42aeb69ee241f5ca82',
        },
      ],
      sagas: [],
    },
  ],
]);

function requestPath(input: RequestInfo | URL): string {
  if (typeof input !== 'string') {
    if (input instanceof URL || input instanceof Request) {
      throw new Error('Fixture requests must use same-origin paths');
    }
  }
  if (!input.startsWith('/') || input.startsWith('//')) {
    throw new Error('Fixture requests must use same-origin paths');
  }
  const parsed = new URL(input, 'http://fixture.invalid');
  return `${parsed.pathname}${parsed.search}`;
}

function isProtected(path: string): boolean {
  return PROTECTED_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export async function fixtureFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const path = requestPath(input);
  const method = (init.method ?? 'GET').toUpperCase();
  const key = `${method} ${path}`;
  if (!RESPONSES.has(key)) {
    const label = isProtected(path) ? 'protected fixture' : 'fixture';
    throw new Error(`Unmatched ${label} request: ${key}`);
  }
  if (isProtected(path)) {
    const headers = new Headers(init.headers);
    if (headers.get(CREDENTIAL_HEADER) !== LAUNCH_CREDENTIAL) {
      throw new Error('Fixture launch credential required');
    }
  }
  return new Response(JSON.stringify(RESPONSES.get(key)), {
    status: 200,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json',
    },
  });
}
