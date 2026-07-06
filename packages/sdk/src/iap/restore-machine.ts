/**
 * Restore state machine — CONTRACT ONLY, extracted as pure transitions from v1
 * `games/find_the_dog/src/ui/HUD.ts` (lines 964–1147, research 07 R28–R43).
 *
 * In v1 this logic was tangled with the DOM (`#shop-restore-btn`,
 * `dataset.restoreState`), `showToast`, `updateHUD`, and `adService.hideBanner`.
 * The extractable core is pure: transitions over a small snapshot value. The SDK
 * ships the STATE ALGEBRA; the later ui-package card ships the clock and the
 * pixels — it consumes this via the documented interface and supplies the copy.
 *
 * Deliberately NOT carried:
 *  - `restoreStatusText` — user-facing copy is the ui-package's concern (UI
 *    guardrail #2 corollary). The SDK exports the `RestoreState` union + this
 *    state→meaning table in comments; the UI maps state → copy.
 *  - the 250ms late-result poll — a timer/DOM concern; the UI drives it and calls
 *    `IapService.consumeCompletedRestoreResult()`.
 */
import type { IapRestoreStatus, IapServiceState } from './service.ts';

/**
 * The restore control's state, verbatim from v1 (research 07 verified this exact
 * set). State → meaning (the contract the ui-package maps to copy):
 *   idle          — ready; a restore can be started.
 *   initializing  — the store is still loading.
 *   busy          — a native store operation is in progress.
 *   unavailable   — restore is not available on this build/platform.
 *   pending       — a restore the user started is in flight.
 *   restored      — a restore completed and recovered an entitlement (terminal).
 *   empty         — a restore completed but found nothing to recover (terminal).
 *   failed        — a restore failed (terminal).
 */
export type RestoreState =
  | 'idle'
  | 'initializing'
  | 'busy'
  | 'unavailable'
  | 'pending'
  | 'restored'
  | 'empty'
  | 'failed';

/** The minimal service view the machine reads — a subset of `IapSnapshot`. */
export interface RestoreSnapshot {
  state: IapServiceState;
  nativeOperationInProgress: boolean;
}

const STICKY_TERMINALS: ReadonlySet<RestoreState> = new Set<RestoreState>(['restored', 'empty', 'failed']);

const START_BLOCKED_STATES: ReadonlySet<RestoreState> = new Set<RestoreState>([
  'pending',
  'restored',
  'initializing',
  'busy',
  'unavailable',
]);

/**
 * Derive the display state from a service snapshot. Carried from v1
 * `restoreUiStateForIapSnapshot`:
 *   - an active user-started restore → `pending`;
 *   - a sticky terminal (`restored`/`empty`/`failed`) stays put — a later `ready`
 *     snapshot does NOT revert it to `idle`;
 *   - a native op in progress → `busy`;
 *   - service `ready` → `idle`; `idle`/`initializing` → `initializing`;
 *   - otherwise → `unavailable`.
 */
export function restoreStateForSnapshot(
  snapshot: RestoreSnapshot,
  current: RestoreState,
  hasActiveRestore: boolean,
): RestoreState {
  if (hasActiveRestore) return 'pending';
  if (STICKY_TERMINALS.has(current)) return current;
  if (snapshot.nativeOperationInProgress) return 'busy';
  if (snapshot.state === 'ready') return 'idle';
  if (snapshot.state === 'idle' || snapshot.state === 'initializing') return 'initializing';
  return 'unavailable';
}

/**
 * Map a completed restore result to a display state — v1 `applyRestoreResult` MINUS
 * its side effects (toast/HUD/hideBanner are caller callbacks, not SDK code).
 * `grantedEntitlement` is the boolean from `restoreEntitlements` (did restore
 * recover anything?): a successful restore that recovered an entitlement →
 * `restored`; a successful restore that recovered nothing → `empty`. A non-success
 * result maps to `busy` while a native restore is still settling (late-settle
 * path), else `unavailable`/`failed`.
 */
export function restoreResultToState(input: {
  status: IapRestoreStatus;
  grantedEntitlement: boolean;
  nativeOperationInProgress: boolean;
}): RestoreState {
  if (input.status === 'unavailable') {
    return input.nativeOperationInProgress ? 'busy' : 'unavailable';
  }
  if (input.status !== 'restored') {
    return input.nativeOperationInProgress ? 'busy' : 'failed';
  }
  return input.grantedEntitlement ? 'restored' : 'empty';
}

/**
 * Whether a restore may be started now — v1's guards in `restorePurchasesFromShop`:
 * reject when a native operation is in progress or the current state is one where a
 * new restore makes no sense (already pending/terminal/loading/busy/unavailable).
 */
export function canStartRestore(snapshot: RestoreSnapshot, current: RestoreState): boolean {
  if (snapshot.nativeOperationInProgress) return false;
  return !START_BLOCKED_STATES.has(current);
}
