import { describe, expect, it } from 'vitest';
import {
  COMEBACK_DELAY_DAYS,
  COMEBACK_REMINDER_ID,
  NotificationService,
  REMINDER_HOUR_LOCAL,
  STREAK_REMINDER_ID,
  planReminders,
  reminderTime,
  streakAtRiskTime,
  type NotificationPermission,
  type NotificationProvider,
  type ReminderInputs,
  type ScheduledReminder,
} from '../../src/notifications/NotificationService';
import type { LifecycleHooks } from '../../src/platform/gameLifecycle';

class FakeProvider implements NotificationProvider {
  permission: NotificationPermission = 'prompt';
  requestResult: NotificationPermission = 'granted';
  requestCalls = 0;
  cancelCalls = 0;
  scheduled: ScheduledReminder[][] = [];
  /** When set, schedule() defers until the test releases it (race testing). */
  scheduleGate: Promise<void> | null = null;

  checkPermission(): Promise<NotificationPermission> {
    return Promise.resolve(this.permission);
  }

  requestPermission(): Promise<NotificationPermission> {
    this.requestCalls += 1;
    this.permission = this.requestResult;
    return Promise.resolve(this.requestResult);
  }

  async schedule(reminders: readonly ScheduledReminder[]): Promise<void> {
    if (this.scheduleGate !== null) await this.scheduleGate;
    this.scheduled.push([...reminders]);
  }

  cancelReminders(): Promise<void> {
    this.cancelCalls += 1;
    return Promise.resolve();
  }
}

function fakeStorage(): Pick<Storage, 'getItem' | 'setItem'> & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

const NOON = new Date(2026, 6, 21, 12, 0, 0);

interface Harness {
  service: NotificationService;
  provider: FakeProvider;
  storage: ReturnType<typeof fakeStorage>;
  hooks: () => LifecycleHooks;
  flush: () => Promise<void>;
}

function makeHarness(overrides: {
  now?: Date;
  inputs?: ReminderInputs;
  notificationsOn?: boolean;
  permissionPromptLaunch?: number;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
} = {}): Harness {
  const provider = new FakeProvider();
  const storage = fakeStorage();
  let registered: LifecycleHooks | null = null;
  const service = new NotificationService({
    provider,
    now: () => overrides.now ?? NOON,
    storage: overrides.storage ?? storage,
    registerHooks: (_id, hooks) => {
      registered = hooks;
      return () => undefined;
    },
    reminderInputs: () => overrides.inputs ?? { streakDays: 0, totalLevelsCompleted: 0, playedToday: false },
    notificationsOn: () => overrides.notificationsOn ?? true,
    permissionPromptLaunch: overrides.permissionPromptLaunch,
  });
  return {
    service,
    provider,
    storage,
    hooks: () => {
      if (registered === null) throw new Error('install() has not registered lifecycle hooks');
      return registered;
    },
    // Suspend/resume handlers are fire-and-forget; drain their microtasks.
    flush: async () => {
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
    },
  };
}

describe('reminderTime / streakAtRiskTime', () => {
  it('reminderTime lands on the reminder hour at least the requested days ahead', () => {
    const at = reminderTime(NOON, 1);
    expect(at.getHours()).toBe(REMINDER_HOUR_LOCAL);
    expect(at.getDate()).toBe(22);
  });

  it('reminderTime never schedules in the past', () => {
    const late = new Date(2026, 6, 21, 23, 30, 0);
    expect(reminderTime(late, 0).getTime()).toBeGreaterThan(late.getTime());
  });

  it('streakAtRiskTime targets this evening when before the reminder hour', () => {
    const at = streakAtRiskTime(NOON)!;
    expect(at.getDate()).toBe(21);
    expect(at.getHours()).toBe(REMINDER_HOUR_LOCAL);
  });

  it('streakAtRiskTime fires soon when past the reminder hour but before midnight', () => {
    const evening = new Date(2026, 6, 21, 20, 0, 0);
    const at = streakAtRiskTime(evening)!;
    expect(at.getDate()).toBe(21);
    expect(at.getTime()).toBeGreaterThan(evening.getTime());
  });

  it('streakAtRiskTime skips when too close to midnight to deliver today', () => {
    const nearMidnight = new Date(2026, 6, 21, 23, 30, 0);
    expect(streakAtRiskTime(nearMidnight)).toBeNull();
  });
});

describe('planReminders', () => {
  it('reminds tomorrow evening when the player already played today', () => {
    const plan = planReminders(NOON, { streakDays: 4, totalLevelsCompleted: 10, playedToday: true });
    expect(plan.map((r) => r.id)).toEqual([STREAK_REMINDER_ID, COMEBACK_REMINDER_ID]);
    expect(plan[0].at.getDate()).toBe(22);
    expect(plan[0].body).toContain('4-day streak');
    expect(plan[1].at.getDate()).toBe(21 + COMEBACK_DELAY_DAYS);
  });

  it('reminds TODAY when the streak is at risk (last play was yesterday)', () => {
    const plan = planReminders(NOON, { streakDays: 4, totalLevelsCompleted: 10, playedToday: false });
    expect(plan[0].id).toBe(STREAK_REMINDER_ID);
    expect(plan[0].at.getDate()).toBe(21);
    expect(plan[0].at.getHours()).toBe(REMINDER_HOUR_LOCAL);
  });

  it('omits the streak reminder when at risk but too late to deliver today', () => {
    const nearMidnight = new Date(2026, 6, 21, 23, 30, 0);
    const plan = planReminders(nearMidnight, { streakDays: 4, totalLevelsCompleted: 10, playedToday: false });
    expect(plan.map((r) => r.id)).toEqual([COMEBACK_REMINDER_ID]);
  });

  it('plans only the comeback reminder with no streak', () => {
    const plan = planReminders(NOON, { streakDays: 0, totalLevelsCompleted: 0, playedToday: false });
    expect(plan.map((r) => r.id)).toEqual([COMEBACK_REMINDER_ID]);
  });
});

describe('NotificationService suspend/resume scheduling', () => {
  it('schedules planned reminders on suspend when permission is granted', async () => {
    const h = makeHarness({ inputs: { streakDays: 2, totalLevelsCompleted: 5, playedToday: true } });
    h.provider.permission = 'granted';
    h.service.install();
    await h.flush();
    h.hooks().onSuspend?.();
    await h.flush();
    expect(h.provider.scheduled).toHaveLength(1);
    expect(h.provider.scheduled[0].map((r) => r.id)).toEqual([STREAK_REMINDER_ID, COMEBACK_REMINDER_ID]);
  });

  it('schedules nothing on suspend without OS permission', async () => {
    const h = makeHarness();
    h.provider.permission = 'denied';
    h.service.install();
    await h.flush();
    h.hooks().onSuspend?.();
    await h.flush();
    expect(h.provider.scheduled).toHaveLength(0);
  });

  it('schedules nothing on suspend when the reminders setting is off', async () => {
    const h = makeHarness({ notificationsOn: false });
    h.provider.permission = 'granted';
    h.service.install();
    await h.flush();
    h.hooks().onSuspend?.();
    await h.flush();
    expect(h.provider.scheduled).toHaveLength(0);
  });

  it('clears stale reminders at install (boot with permission already granted)', async () => {
    const h = makeHarness();
    h.provider.permission = 'granted';
    h.service.install();
    await h.flush();
    expect(h.provider.cancelCalls).toBe(1);
  });

  it('cancels pending reminders on resume', async () => {
    const h = makeHarness();
    h.provider.permission = 'granted';
    h.service.install();
    await h.flush();
    const before = h.provider.cancelCalls;
    h.hooks().onResume?.(0);
    await h.flush();
    expect(h.provider.cancelCalls).toBe(before + 1);
  });

  it('re-cancels when a resume lands while a suspend schedule is in flight', async () => {
    const h = makeHarness({ inputs: { streakDays: 1, totalLevelsCompleted: 3, playedToday: true } });
    h.provider.permission = 'granted';
    h.service.install();
    await h.flush();
    let release: () => void = () => undefined;
    h.provider.scheduleGate = new Promise((resolve) => { release = resolve; });
    h.hooks().onSuspend?.();
    await Promise.resolve();
    h.hooks().onResume?.(0); // player flicks back in before schedule() commits
    await h.flush();
    const cancelsBeforeRelease = h.provider.cancelCalls;
    release();
    await h.flush();
    // The stale-generation schedule must wipe what it just scheduled.
    expect(h.provider.scheduled).toHaveLength(1);
    expect(h.provider.cancelCalls).toBe(cancelsBeforeRelease + 1);
  });
});

describe('NotificationService permission prompting', () => {
  it('does not prompt on the first app open', async () => {
    const h = makeHarness();
    await h.service.maybePromptOnLaunch();
    expect(h.provider.requestCalls).toBe(0);
  });

  it('prompts exactly once, on the second app open', async () => {
    const h = makeHarness();
    await h.service.maybePromptOnLaunch();
    await h.service.maybePromptOnLaunch();
    await h.service.maybePromptOnLaunch();
    expect(h.provider.requestCalls).toBe(1);
  });

  it('honors a configured permissionPromptLaunch', async () => {
    const h = makeHarness({ permissionPromptLaunch: 3 });
    await h.service.maybePromptOnLaunch();
    await h.service.maybePromptOnLaunch();
    expect(h.provider.requestCalls).toBe(0);
    await h.service.maybePromptOnLaunch();
    expect(h.provider.requestCalls).toBe(1);
  });

  it('does not auto-prompt when the reminders setting is off', async () => {
    const h = makeHarness({ notificationsOn: false });
    await h.service.maybePromptOnLaunch();
    await h.service.maybePromptOnLaunch();
    expect(h.provider.requestCalls).toBe(0);
  });

  it('skips the prompt when permission is already resolved (denied)', async () => {
    const h = makeHarness();
    h.provider.permission = 'denied';
    await h.service.maybePromptOnLaunch();
    await h.service.maybePromptOnLaunch();
    expect(h.provider.requestCalls).toBe(0);
  });

  it('leaves the one-shot un-consumed when the permission request fails', async () => {
    const h = makeHarness();
    h.provider.requestPermission = () => Promise.reject(new Error('bridge lost'));
    await h.service.maybePromptOnLaunch();
    await h.service.maybePromptOnLaunch(); // launch 2 — request throws
    expect(h.storage.data.has('ftd_notification_permission_asked')).toBe(false);
  });

  it('survives a throwing storage without breaking the prompt flow', async () => {
    const throwing: Pick<Storage, 'getItem' | 'setItem'> = {
      getItem: () => { throw new Error('private mode'); },
      setItem: () => { throw new Error('quota'); },
    };
    const h = makeHarness({ storage: throwing });
    await expect(h.service.maybePromptOnLaunch()).resolves.toBeUndefined();
  });

  it('setEnabled(true) requests permission when never granted', async () => {
    const h = makeHarness();
    h.provider.permission = 'prompt';
    await h.service.setEnabled(true);
    expect(h.provider.requestCalls).toBe(1);
  });

  it('setEnabled(false) cancels pending reminders without prompting', async () => {
    const h = makeHarness();
    await h.service.setEnabled(false);
    expect(h.provider.cancelCalls).toBe(1);
    expect(h.provider.requestCalls).toBe(0);
  });
});
