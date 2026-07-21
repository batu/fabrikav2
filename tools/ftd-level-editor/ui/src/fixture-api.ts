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
