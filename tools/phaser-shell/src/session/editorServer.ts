// Loopback-only Phaser Editor 5 server lifecycle for the provenance leg
// (P6 §6/§10, KTD-C/KTD-F). Starts the INSTALLED editor server bound to the
// scratch project with auto-open-browser + update checks DISABLED and only the
// allowlisted scratch `editor-plugins` path loaded; connects strictly over
// 127.0.0.1; gates on `GetServerMode` (desktop AND unlocked — fail-closed);
// terminates and PROVES the loopback endpoint is down before any restart.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import process from 'node:process';
import type { ServerMode } from './evidence.ts';

/** Default install path of the licensed Phaser Editor 5 server (overridable). */
export const DEFAULT_SERVER_BIN =
  '/Applications/Phaser Editor 5.app/Contents/Resources/app/server/PhaserEditor';

/** Resolve the server binary: explicit arg → env → default install path. */
export function resolveServerBin(override?: string): string {
  return override ?? process.env.PHASER_EDITOR_SERVER ?? DEFAULT_SERVER_BIN;
}

export class ServerBlocked extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ServerBlocked';
  }
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface LoopbackResponse {
  statusCode: number;
  body: Buffer;
}

/**
 * Request the fixed loopback Editor endpoint without Node's bundled fetch.
 * Node 26's Undici transport can throw an uncaught `setTypeOfService EINVAL`
 * while opening a macOS loopback socket, outside the awaiting caller's catch.
 * The basic HTTP client reports readiness failures through this promise instead.
 */
function requestEditor(
  port: number,
  pathname: string,
  method: 'GET' | 'POST' = 'GET',
  body?: string,
): Promise<LoopbackResponse> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path: pathname,
        method,
        headers: body === undefined
          ? undefined
          : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
        timeout: 1_000,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let byteLength = 0;
        response.on('data', (chunk: Buffer | string) => {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          byteLength += bytes.length;
          if (byteLength > 1_048_576) {
            response.destroy(new Error('Editor loopback response exceeded 1 MiB'));
            return;
          }
          chunks.push(bytes);
        });
        response.once('error', reject);
        response.once('end', () => resolve({
          statusCode: response.statusCode ?? 0,
          body: Buffer.concat(chunks),
        }));
      },
    );
    request.once('error', reject);
    request.once('timeout', () => request.destroy(new Error('Editor loopback request timed out')));
    request.end(body);
  });
}

export interface StartOptions {
  projectDir: string;
  port: number;
  pluginsDir: string;
  serverBin: string;
}

/**
 * Spawn the editor server loopback-only with browser/updates disabled and only
 * the allowlisted scratch plugins loaded, then wait until the loopback endpoint
 * answers. Blocks if the binary is absent or the server never becomes ready.
 */
export async function startEditorServer(opts: StartOptions): Promise<ChildProcess> {
  if (!existsSync(opts.serverBin)) {
    throw new ServerBlocked('server-not-found', 'the licensed Phaser Editor 5 server binary was not found');
  }
  const proc = spawn(
    opts.serverBin,
    [
      '-project', opts.projectDir,
      '-port', String(opts.port),
      '-disable-open-browser',
      '-disable-check-for-updates',
      '-plugins', opts.pluginsDir,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  for (let i = 0; i < 60; i++) {
    if (proc.exitCode !== null) {
      throw new ServerBlocked('server-exited', 'the editor server exited before becoming ready');
    }
    try {
      const response = await requestEditor(opts.port, '/editor/');
      if (response.statusCode >= 200 && response.statusCode < 300) return proc;
    } catch {
      /* not up yet */
    }
    await delay(250);
  }
  proc.kill('SIGKILL');
  throw new ServerBlocked('server-not-ready', 'the editor server did not become ready on the loopback endpoint');
}

/**
 * Query the server mode over loopback. Fail-closed: any transport/shape error
 * yields `{ desktop: false, unlocked: false }` so the caller blocks rather than
 * proceeding on an unlicensed or web-mode server. (The exact `GetServerMode`
 * wire shape is confirmed at the vendor-gated live shakedown; parsing accepts
 * the documented field plus common aliases.)
 */
export async function getServerMode(port: number): Promise<ServerMode> {
  try {
    // Phaser Editor 5 mounts its JSON API under the editor base path. `/api`
    // redirects to `/editor` and would silently downgrade this gate to false.
    const response = await requestEditor(
      port,
      '/editor/api',
      'POST',
      JSON.stringify({ method: 'GetServerMode' }),
    );
    if (response.statusCode < 200 || response.statusCode >= 300) return { desktop: false, unlocked: false };
    const data = JSON.parse(response.body.toString('utf8')) as Record<string, unknown>;
    const desktop = data.desktop === true || data.desktopMode === true || data.isDesktop === true;
    const unlocked = data.unlocked === true || data.licensed === true || data.activated === true;
    return { desktop, unlocked };
  } catch {
    return { desktop: false, unlocked: false };
  }
}

/**
 * Terminate the server and PROVE the loopback endpoint is down (connection
 * refused). Escalates to SIGKILL if a graceful stop does not take the endpoint
 * offline. Returns true only when the endpoint is verifiably down.
 */
export async function stopEditorServer(proc: ChildProcess, port: number): Promise<boolean> {
  proc.kill('SIGTERM');
  if (await proveEndpointDown(port, 20)) return true;
  proc.kill('SIGKILL');
  return proveEndpointDown(port, 20);
}

/** Poll the loopback endpoint until it refuses a connection, up to `attempts`. */
async function proveEndpointDown(port: number, attempts = 20): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    try {
      await requestEditor(port, '/editor/');
    } catch {
      return true; // connection refused → endpoint down
    }
    await delay(250);
  }
  return false;
}
