import type { GameHarness, HarnessSaveProfile } from '../harness/index.ts';
import {
  defaultDriveStatePredicates,
  INSITU_TOUR_STATES,
  type DriveSnapshot,
  type DriveState,
} from './driveTo.ts';
import { publishTourMarker } from './tourMarker.ts';
import { driveTourStateWithTimeout } from './tourDriveTimeout.ts';

export interface InsituTourHarness<State extends string = DriveState> {
  driveTo?: (state: State) => Promise<boolean>;
  snapshot(): unknown;
  resetSave?: GameHarness['resetSave'];
  seedSave?: GameHarness['seedSave'];
}

export type TourHarness<State extends string = DriveState> = InsituTourHarness<State>;

export interface InsituTourOptions<State extends string = DriveState> {
  readonly states?: readonly State[];
  readonly dwellMs?: number;
  readonly markSettleRecheckMs?: number;
  readonly driveTimeoutMs?: number;
  readonly saveProfile?: HarnessSaveProfile | null;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly snapshotMatchesState?: (state: State, snapshot: unknown) => boolean;
  readonly script?: string | null;
  readonly logger?: (message: string) => void;
}

const ALLSTATES_DWELL_MS = 11000;
const MARK_SETTLE_RECHECK_MS = 500;
const TOUR_DRIVE_TIMEOUT_MS = 20_000;

const DEFAULT_SAVE_PROFILE = {
  unlockedLevel: 2,
  coins: 25,
  noAds: false,
  sfx: true,
  music: true,
  haptics: true,
} as const satisfies HarnessSaveProfile;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function maybeRunInsituTour<State extends string = DriveState>(
  harness: InsituTourHarness<State>,
  options: InsituTourOptions<State> = {},
): Promise<void> {
  const script = options.script ?? requestedScript();
  if (script !== 'allstates' || typeof harness.driveTo !== 'function') return;

  const states = options.states ?? (INSITU_TOUR_STATES as unknown as readonly State[]);
  const sleep = options.sleep ?? defaultSleep;
  const dwellMs = options.dwellMs ?? ALLSTATES_DWELL_MS;
  const markSettleRecheckMs = options.markSettleRecheckMs ?? MARK_SETTLE_RECHECK_MS;
  const driveTimeoutMs = options.driveTimeoutMs ?? TOUR_DRIVE_TIMEOUT_MS;
  const saveProfile = options.saveProfile === undefined ? DEFAULT_SAVE_PROFILE : options.saveProfile;
  const matches = options.snapshotMatchesState ?? defaultSnapshotMatchesState;
  const driveTo = harness.driveTo;
  const snapshot = (): unknown => harness.snapshot();
  const log = (message: string): void => {
    options.logger?.(`[insituTour] ${message}`);
    if (options.logger === undefined) console.info(`[insituTour] ${message}`);
  };

  if (saveProfile !== null) {
    await harness.resetSave?.();
    await harness.seedSave?.(saveProfile);
  }

  for (const state of states) {
    // A drive (or the snapshot it polls) can throw — e.g. an engine object not
    // ready on a slow device. One state's exception must publish that state as
    // FAILED and let the tour continue, never silently kill the remaining
    // states: a dead tour reads as "missing" markers with zero diagnostics.
    let ok = false;
    try {
      ok = await driveTourStateWithTimeout(state, (target) => driveTo(target), {
        timeoutMs: driveTimeoutMs,
        onTimeout: (target) => log(`driveTo(${String(target)}) timed out after ${driveTimeoutMs}ms`),
      });
    } catch (error) {
      log(`driveTo(${String(state)}) threw: ${String(error)}`);
    }
    let stable = false;
    if (ok) {
      await sleep(markSettleRecheckMs);
      try {
        stable = matches(state, snapshot());
      } catch (error) {
        log(`snapshot after ${String(state)} threw: ${String(error)}`);
      }
    }

    const safeSnapshot = (): Record<string, unknown> => {
      try {
        return toRecord(snapshot());
      } catch {
        return {};
      }
    };
    publishTourMarker(stable ? state : `${state}-FAILED`, {
      publishMetrics: stable,
      log,
      snapshot: safeSnapshot,
    });
    await sleep(dwellMs);

    if (stable) {
      let stillMatches = false;
      try {
        stillMatches = matches(state, snapshot());
      } catch (error) {
        log(`snapshot after ${String(state)} dwell threw: ${String(error)}`);
      }
      publishTourMarker(stillMatches ? `${state}-DONE` : `${state}-FAILED`, {
        publishMetrics: false,
        log,
        snapshot: safeSnapshot,
      });
    }
  }

  publishTourMarker('done', {
    publishMetrics: false,
    log,
    snapshot: () => {
      try {
        return toRecord(snapshot());
      } catch {
        return {};
      }
    },
  });
}

function requestedScript(): string | null {
  const env = ((import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {});
  if (env.VITE_INSITU_TOUR) return env.VITE_INSITU_TOUR;
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('insituTour');
}

function defaultSnapshotMatchesState<State extends string>(state: State, raw: unknown): boolean {
  if (!isDefaultDriveState(state)) return false;
  return defaultDriveStatePredicates[state](toRecord(raw) as DriveSnapshot);
}

function isDefaultDriveState(state: string): state is DriveState {
  return (INSITU_TOUR_STATES as readonly string[]).includes(state);
}

function toRecord(raw: unknown): Record<string, unknown> {
  return raw !== null && typeof raw === 'object' ? raw as Record<string, unknown> : {};
}
