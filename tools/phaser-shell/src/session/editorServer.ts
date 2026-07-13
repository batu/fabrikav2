// Loopback-only Phaser Editor 5 server lifecycle for the provenance leg
// (P6 §6/§10, KTD-C/KTD-F). Starts the INSTALLED editor server bound to the
// scratch project with auto-open-browser + update checks DISABLED and only the
// allowlisted scratch `editor-plugins` path loaded; connects strictly over
// 127.0.0.1; gates on `GetServerMode` (desktop AND unlocked — fail-closed);
// terminates and PROVES the loopback endpoint is down before any restart.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
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

/** The loopback editor readiness URL for a port. */
function editorUrl(port: number): string {
  return `http://127.0.0.1:${port}/editor/`;
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
      const res = await fetch(editorUrl(opts.port));
      if (res.ok) return proc;
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
    const res = await fetch(`http://127.0.0.1:${port}/editor/api`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'GetServerMode' }),
    });
    if (!res.ok) return { desktop: false, unlocked: false };
    const data = (await res.json()) as Record<string, unknown>;
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
      await fetch(editorUrl(port));
    } catch {
      return true; // connection refused → endpoint down
    }
    await delay(250);
  }
  return false;
}
