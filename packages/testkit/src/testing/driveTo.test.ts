import { describe, expect, it } from 'vitest';
import { driveTo, isDriveState, type DriveSnapshot, type DriveToDeps } from './driveTo.ts';

function makeDeps(overrides: Partial<DriveToDeps> = {}): DriveToDeps & { calls: string[] } {
  let scene = 'menu';
  const calls: string[] = [];
  return {
    calls,
    gotoMenu: () => {
      calls.push('gotoMenu');
      scene = 'menu';
    },
    startLevel: (id) => {
      calls.push(`startLevel:${id}`);
      scene = 'playing';
    },
    openSettings: () => {
      calls.push('openSettings');
      scene = 'settings';
    },
    pause: () => {
      calls.push('pause');
      scene = 'paused';
    },
    autoWin: async () => {
      calls.push('autoWin');
      scene = 'complete';
      return true;
    },
    autoFail: async () => {
      calls.push('autoFail');
      scene = 'failed';
      return true;
    },
    snapshot: (): DriveSnapshot => ({ scene, settingsOpen: scene === 'settings' }),
    ...overrides,
  };
}

describe('isDriveState', () => {
  it('uses the default drive states when no per-game list is supplied', () => {
    expect(isDriveState('menu')).toBe(true);
    expect(isDriveState('boot')).toBe(false);
  });

  it('uses the supplied per-game state list as the effective list', () => {
    expect(isDriveState('shop', ['menu', 'shop'])).toBe(true);
    expect(isDriveState('fail', ['menu', 'shop'])).toBe(false);
  });
});

describe('driveTo custom states', () => {
  it('drives a declared custom state through gotoState and a confirming predicate', async () => {
    let scene = 'menu';
    const calls: string[] = [];
    const deps = makeDeps({
      states: ['menu', 'shop'],
      gotoMenu: () => {
        calls.push('gotoMenu');
        scene = 'menu';
      },
      gotoState: (state) => {
        calls.push(`gotoState:${state}`);
        scene = state;
      },
      snapshot: () => ({ scene }),
    });

    const reached = await driveTo(deps, 'shop', {
      pollMs: 0,
      maxPolls: 1,
      predicates: {
        shop: (snapshot) => snapshot.scene === 'shop',
      },
    });

    expect(reached).toBe(true);
    expect(calls).toEqual(['gotoMenu', 'gotoState:shop']);
  });

  it('refuses an undeclared default state when the per-game list excludes it', async () => {
    const deps = makeDeps({ states: ['menu', 'shop'] });

    await expect(driveTo(deps, 'fail', { pollMs: 0, maxPolls: 1 })).resolves.toBe(false);
    expect(deps.calls).toEqual([]);
  });

  it('does not claim a declared custom state without a generic hook and predicate', async () => {
    const withoutHook = makeDeps({ states: ['menu', 'shop'] });
    await expect(driveTo(withoutHook, 'shop', {
      pollMs: 0,
      maxPolls: 1,
      predicates: { shop: (snapshot) => snapshot.scene === 'shop' },
    })).resolves.toBe(false);

    const withoutPredicate = makeDeps({
      states: ['menu', 'shop'],
      gotoState: () => {
        throw new Error('should not navigate without a confirming predicate');
      },
    });
    await expect(driveTo(withoutPredicate, 'shop', { pollMs: 0, maxPolls: 1 })).resolves.toBe(false);
  });
});
