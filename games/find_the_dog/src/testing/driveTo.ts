export const DRIVE_STATES = ['menu', 'level', 'settings', 'pause', 'win', 'fail'] as const;
export type DriveState = (typeof DRIVE_STATES)[number];

export interface DriveSnapshot {
  scene?: string;
  activeScene?: string;
  status?: string;
  inputReady?: boolean;
  settingsOpen?: boolean;
  levelComplete?: boolean;
  lives?: number;
}

export interface DriveToDeps {
  gotoMenu: () => void | Promise<void>;
  startLevel: () => void | Promise<void>;
  openSettings: () => void | Promise<void>;
  pause: () => void | Promise<void>;
  autoWin: () => Promise<boolean>;
  autoFail: () => Promise<boolean>;
  snapshot: () => DriveSnapshot;
}

export interface DriveToOptions {
  pollMs?: number;
  maxPolls?: number;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_POLL_MS = 50;
const DEFAULT_MAX_POLLS = 40;

export function isDriveState(value: string): value is DriveState {
  return (DRIVE_STATES as readonly string[]).includes(value);
}

export async function driveTo(
  deps: DriveToDeps,
  state: string,
  options: DriveToOptions = {},
): Promise<boolean> {
  if (!isDriveState(state)) return false;
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const maxPolls = options.maxPolls ?? DEFAULT_MAX_POLLS;
  const sleep = options.sleep ?? ((ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms)));

  if (state === 'menu') {
    await deps.gotoMenu();
    return confirm(deps, state, maxPolls, pollMs, sleep);
  }

  if (state === 'settings') {
    await deps.gotoMenu();
    await deps.openSettings();
    return confirm(deps, state, maxPolls, pollMs, sleep);
  }

  await deps.startLevel();
  const ready = await confirm(deps, 'level', maxPolls, pollMs, sleep);
  if (!ready) return false;

  if (state === 'level') return true;
  if (state === 'pause') {
    await deps.pause();
    return confirm(deps, state, maxPolls, pollMs, sleep);
  }
  const terminalReached = state === 'win' ? await deps.autoWin() : await deps.autoFail();
  if (!terminalReached) return false;
  return confirm(deps, state, maxPolls, pollMs, sleep);
}

async function confirm(
  deps: DriveToDeps,
  state: DriveState,
  maxPolls: number,
  pollMs: number,
  sleep: (ms: number) => Promise<void>,
): Promise<boolean> {
  for (let i = 0; i < maxPolls; i += 1) {
    if (matches(deps.snapshot(), state)) return true;
    await sleep(pollMs);
  }
  return false;
}

function matches(snapshot: DriveSnapshot, state: DriveState): boolean {
  const scene = snapshot.scene ?? snapshot.activeScene ?? '';
  const ready = snapshot.inputReady !== false;
  if (state === 'menu') return scene === 'menu' || scene === 'HomeScene';
  if (state === 'settings') return snapshot.settingsOpen === true;
  if (state === 'level') return ready && (scene === 'playing' || scene === 'GameScene') && snapshot.levelComplete !== true;
  if (state === 'pause') return scene === 'paused' || snapshot.status === 'paused';
  if (state === 'win') return scene === 'complete' || snapshot.status === 'complete' || snapshot.levelComplete === true;
  return scene === 'failed' || snapshot.status === 'failed' || snapshot.lives === 0;
}
