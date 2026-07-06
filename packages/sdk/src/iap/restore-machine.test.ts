import { describe, expect, it } from 'vitest';
import {
  canStartRestore,
  restoreResultToState,
  restoreStateForSnapshot,
  type RestoreSnapshot,
  type RestoreState,
} from './restore-machine.ts';
import type { IapServiceState } from './service.ts';

function snap(state: IapServiceState, nativeOperationInProgress = false): RestoreSnapshot {
  return { state, nativeOperationInProgress };
}

describe('restoreStateForSnapshot — snapshot → display state', () => {
  const cases: { name: string; snapshot: RestoreSnapshot; current: RestoreState; active: boolean; expected: RestoreState }[] = [
    { name: 'active user restore → pending', snapshot: snap('ready'), current: 'idle', active: true, expected: 'pending' },
    { name: 'ready → idle', snapshot: snap('ready'), current: 'idle', active: false, expected: 'idle' },
    { name: 'native op in progress → busy', snapshot: snap('ready', true), current: 'idle', active: false, expected: 'busy' },
    { name: 'service idle → initializing', snapshot: snap('idle'), current: 'idle', active: false, expected: 'initializing' },
    { name: 'service initializing → initializing', snapshot: snap('initializing'), current: 'idle', active: false, expected: 'initializing' },
    { name: 'unsupported-platform → unavailable', snapshot: snap('unsupported-platform'), current: 'idle', active: false, expected: 'unavailable' },
    { name: 'missing-api-key → unavailable', snapshot: snap('missing-api-key'), current: 'idle', active: false, expected: 'unavailable' },
    { name: 'load-failed → unavailable', snapshot: snap('load-failed'), current: 'idle', active: false, expected: 'unavailable' },
  ];

  for (const { name, snapshot, current, active, expected } of cases) {
    it(name, () => {
      expect(restoreStateForSnapshot(snapshot, current, active)).toBe(expected);
    });
  }

  it('sticky terminals do not revert to idle on a later ready snapshot', () => {
    for (const terminal of ['restored', 'empty', 'failed'] as const) {
      expect(restoreStateForSnapshot(snap('ready'), terminal, false)).toBe(terminal);
    }
  });
});

describe('restoreResultToState — completed restore → display state', () => {
  it('restored + recovered an entitlement → restored', () => {
    expect(restoreResultToState({ status: 'restored', grantedEntitlement: true, nativeOperationInProgress: false })).toBe('restored');
  });
  it('restored + recovered nothing → empty', () => {
    expect(restoreResultToState({ status: 'restored', grantedEntitlement: false, nativeOperationInProgress: false })).toBe('empty');
  });
  it('failed while a native restore is still settling → busy (late-settle path)', () => {
    expect(restoreResultToState({ status: 'failed', grantedEntitlement: false, nativeOperationInProgress: true })).toBe('busy');
  });
  it('failed with no native op → failed', () => {
    expect(restoreResultToState({ status: 'failed', grantedEntitlement: false, nativeOperationInProgress: false })).toBe('failed');
  });
  it('unavailable maps to busy while settling, else unavailable', () => {
    expect(restoreResultToState({ status: 'unavailable', grantedEntitlement: false, nativeOperationInProgress: true })).toBe('busy');
    expect(restoreResultToState({ status: 'unavailable', grantedEntitlement: false, nativeOperationInProgress: false })).toBe('unavailable');
  });
});

describe('canStartRestore — guards', () => {
  it('allows a restore from idle when no native op is running', () => {
    expect(canStartRestore(snap('ready'), 'idle')).toBe(true);
  });
  it('rejects while a native operation is in progress', () => {
    expect(canStartRestore(snap('ready', true), 'idle')).toBe(false);
  });
  it('rejects from each blocked state', () => {
    for (const blocked of ['pending', 'restored', 'initializing', 'busy', 'unavailable'] as const) {
      expect(canStartRestore(snap('ready'), blocked)).toBe(false);
    }
  });
  it('allows a fresh attempt from the empty / failed terminals', () => {
    expect(canStartRestore(snap('ready'), 'empty')).toBe(true);
    expect(canStartRestore(snap('ready'), 'failed')).toBe(true);
  });
});
