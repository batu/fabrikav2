export const DRIVE_STATES = ['menu', 'level', 'win', 'fail', 'settings', 'pause'] as const;
export const INSITU_TOUR_STATES = ['menu', 'level', 'settings', 'pause', 'win', 'fail'] as const;

export type DriveState = (typeof DRIVE_STATES)[number];

export interface DriveSnapshot {
  readonly scene?: string;
  readonly activeScene?: string;
  readonly status?: string;
  readonly inputReady?: boolean;
  readonly levelDataReady?: boolean;
  readonly settingsOpen?: boolean;
  readonly levelComplete?: boolean;
  readonly lifecycleSuspended?: boolean;
  readonly lives?: number;
  readonly [key: string]: unknown;
}

export interface DriveToDeps {
  gotoMenu(): void | Promise<void>;
  startLevel(id: number): void | Promise<void>;
  openSettings(): void | Promise<void>;
  pause(): void | Promise<void>;
  autoWin(): Promise<boolean>;
  autoFail(): Promise<boolean>;
  snapshot(): DriveSnapshot;
}

export type DriveStatePredicate = (snapshot: DriveSnapshot) => boolean;
export type DriveStatePredicates = Record<DriveState, DriveStatePredicate>;

export interface DriveToOptions {
  readonly pollMs?: number;
  readonly maxPolls?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly predicates?: Partial<DriveStatePredicates>;
  readonly playingReady?: DriveStatePredicate;
  readonly levelIds?: Partial<Record<Extract<DriveState, 'level' | 'win' | 'fail' | 'pause'>, number>>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const defaultDriveStatePredicates: DriveStatePredicates = {
  menu: (snap) => snap.scene === 'menu',
  level: (snap) =>
    snap.scene === 'playing'
    && snap.inputReady !== false
    && snap.levelComplete !== true
    && snap.lifecycleSuspended !== true
    && snap.status !== 'paused'
    && snap.status !== 'complete'
    && snap.status !== 'failed'
    && snap.lives !== 0,
  win: (snap) => snap.scene === 'complete',
  fail: (snap) => snap.scene === 'failed',
  settings: (snap) => snap.settingsOpen === true,
  pause: (snap) => snap.scene === 'paused',
};

export const defaultPlayingReady: DriveStatePredicate = (snap) =>
  defaultDriveStatePredicates.level(snap);

export function isDriveState(state: string): state is DriveState {
  return (DRIVE_STATES as readonly string[]).includes(state);
}

export async function driveTo(
  deps: DriveToDeps,
  state: string,
  opts: DriveToOptions = {},
): Promise<boolean> {
  if (!isDriveState(state)) return false;

  const pollMs = opts.pollMs ?? 50;
  const maxPolls = opts.maxPolls ?? 60;
  const sleep = opts.sleep ?? defaultSleep;
  const predicates = { ...defaultDriveStatePredicates, ...opts.predicates };
  const playingReady = opts.playingReady ?? defaultPlayingReady;
  const settle = (predicate: DriveStatePredicate): Promise<boolean> =>
    confirm(deps, predicate, pollMs, maxPolls, sleep);

  await deps.gotoMenu();
  const atMenu = await settle(predicates.menu);
  if (!atMenu) return false;

  switch (state) {
    case 'menu':
      return true;

    case 'settings':
      await deps.openSettings();
      return settle(predicates.settings);

    case 'level':
      await deps.startLevel(opts.levelIds?.level ?? 1);
      return settle(predicates.level);

    case 'win': {
      await deps.startLevel(opts.levelIds?.win ?? 1);
      if (!(await settle(playingReady))) return false;
      if (!(await deps.autoWin())) return false;
      return settle(predicates.win);
    }

    case 'fail': {
      await deps.startLevel(opts.levelIds?.fail ?? 1);
      if (!(await settle(playingReady))) return false;
      if (!(await deps.autoFail())) return false;
      return settle(predicates.fail);
    }

    case 'pause':
      await deps.startLevel(opts.levelIds?.pause ?? 1);
      if (!(await settle(playingReady))) return false;
      await deps.pause();
      return settle(predicates.pause);
  }
}

async function confirm(
  deps: DriveToDeps,
  predicate: DriveStatePredicate,
  pollMs: number,
  maxPolls: number,
  sleep: (ms: number) => Promise<void>,
): Promise<boolean> {
  for (let i = 0; i < maxPolls; i += 1) {
    if (predicate(deps.snapshot())) return true;
    if (pollMs > 0) await sleep(pollMs);
  }
  return predicate(deps.snapshot());
}
