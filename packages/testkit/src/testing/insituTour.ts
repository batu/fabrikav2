import type { GameHarness, HarnessSaveProfile } from '../harness/index.ts';
import {
  defaultDriveStatePredicates,
  INSITU_TOUR_STATES,
  type DriveSnapshot,
  type DriveState,
} from './driveTo.ts';
import { publishTourMarker } from './tourMarker.ts';

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
  readonly saveProfile?: HarnessSaveProfile | null;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly snapshotMatchesState?: (state: State, snapshot: unknown) => boolean;
  readonly script?: string | null;
  readonly logger?: (message: string) => void;
}

const ALLSTATES_DWELL_MS = 11000;
const MARK_SETTLE_RECHECK_MS = 500;

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
  const saveProfile = options.saveProfile === undefined ? DEFAULT_SAVE_PROFILE : options.saveProfile;
  const matches = options.snapshotMatchesState ?? defaultSnapshotMatchesState;
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
    const ok = await harness.driveTo(state);
    let stable = false;
    if (ok) {
      await sleep(markSettleRecheckMs);
      stable = matches(state, snapshot());
    }

    publishTourMarker(stable ? state : `${state}-FAILED`, {
      publishMetrics: stable,
      log,
      snapshot: () => toRecord(snapshot()),
    });
    await sleep(dwellMs);

    if (stable) {
      publishTourMarker(matches(state, snapshot()) ? `${state}-DONE` : `${state}-FAILED`, {
        publishMetrics: false,
        log,
        snapshot: () => toRecord(snapshot()),
      });
    }
  }

  publishTourMarker('done', {
    publishMetrics: false,
    log,
    snapshot: () => toRecord(snapshot()),
  });
}

function requestedScript(): string | null {
  const env = ((import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {});
  if (env.VITE_INSITU_TOUR !== undefined) return env.VITE_INSITU_TOUR;
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
